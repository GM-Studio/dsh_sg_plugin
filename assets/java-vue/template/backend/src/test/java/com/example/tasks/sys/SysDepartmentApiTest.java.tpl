package com.example.tasks.sys;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.tasks.sys.entity.SysDepartment;
import com.example.tasks.sys.repository.SysDepartmentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** 部门管理接口测试：分页过滤、增删改、编码唯一性冲突以及登录/CSRF 边界。 */
@SpringBootTest(
        properties = {"spring.datasource.url=jdbc:h2:mem:sys-department-api;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysDepartmentApiTest {
    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();

    @Autowired private MockMvc mvc;
    @Autowired private SysDepartmentRepository departments;
    @Autowired private ObjectMapper mapper;

    /** 使用随机口令启动本地账号，测试不依赖真实环境变量。 */
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        registry.add("APP_VIEWER_PASSWORD", () -> VIEWER_PASSWORD);
    }

    @BeforeEach
    void reset() {
        departments.deleteAll();
    }

    /** 组装部门请求体，parentCode 用于覆盖可空的上级部门字段。 */
    private String json(String code, String name, String parentCode, boolean enabled)
            throws Exception {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("name", name);
        data.put("parentCode", parentCode);
        data.put("enabled", enabled);
        return mapper.writeValueAsString(data);
    }

    @Test
    void departmentsListPaginationFilteringAndCrud() throws Exception {
        String created =
                mvc.perform(
                                post("/api/sys/departments")
                                        .with(user("admin").roles("ADMIN"))
                                        .with(csrf())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(json("hq", " Headquarters ", "root", true)))
                        .andExpect(status().isCreated())
                        .andExpect(header().exists("Location"))
                        .andExpect(jsonPath("$.data.name").value("Headquarters"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long id = mapper.readTree(created).path("data").path("id").asLong();
        mvc.perform(
                        post("/api/sys/departments")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("hq", "Duplicate", "root", true)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_DEPARTMENT_CODE_CONFLICT"));
        departments.saveAndFlush(new SysDepartment("rd", "Research", "hq", true));
        mvc.perform(get("/api/sys/departments").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.page").value(1));
        mvc.perform(get("/api/sys/departments?pageSize=1&page=2").with(user("viewer")))
                .andExpect(jsonPath("$.data.records[0].code").value("rd"));
        mvc.perform(get("/api/sys/departments?code=HQ").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/departments?name=RESEARCH").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/departments?code=%25").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/api/sys/departments/options").with(user("viewer")))
                .andExpect(jsonPath("$.data[0].value").value("hq"))
                .andExpect(jsonPath("$.data[0].label").value("Headquarters"));
        mvc.perform(get("/api/sys/departments/" + id).with(user("viewer")))
                .andExpect(jsonPath("$.data.enabled").value(true))
                .andExpect(jsonPath("$.data.parentCode").value("root"));
        mvc.perform(
                        post("/api/sys/departments/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"code\":\"hq\",\"name\":\"Operations\","
                                                + "\"parentCode\":\"root\",\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Operations"))
                .andExpect(jsonPath("$.data.enabled").value(false));
        mvc.perform(
                        post("/api/sys/departments/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"code\":\"rd\",\"name\":\"Operations\","
                                                + "\"parentCode\":\"root\",\"enabled\":true}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_DEPARTMENT_CODE_CONFLICT"));
        mvc.perform(
                        post("/api/sys/departments/delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"id\":" + id + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true))
                .andExpect(jsonPath("$.data.count").value(1));
        assertFalse(departments.existsById(id));
        mvc.perform(get("/api/sys/departments/" + id).with(user("viewer")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SYS_DEPARTMENT_NOT_FOUND"));
        mvc.perform(get("/api/sys/departments?page=0").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/sys/departments?pageSize=101").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/sys/departments")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void departmentsRequireLoginCsrfAndAdminWrites() throws Exception {
        mvc.perform(get("/api/sys/departments"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(
                        post("/api/sys/departments")
                                .with(user("admin").roles("ADMIN"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("audit", "Audit", "root", true)))
                .andExpect(status().isForbidden());
        mvc.perform(
                        post("/api/sys/departments")
                                .with(user("viewer").roles("VIEWER"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("audit", "Audit", "root", true)))
                .andExpect(status().isForbidden());
        MvcResult tokenResult =
                mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) tokenResult.getRequest().getSession();
        String previousId = session.getId();
        String token =
                mapper.readTree(tokenResult.getResponse().getContentAsString())
                        .path("data")
                        .path("token")
                        .asText();
        mvc.perform(
                        post("/api/auth/login")
                                .session(session)
                                .header("X-CSRF-TOKEN", token)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"username\":\"admin\",\"password\":\""
                                                + ADMIN_PASSWORD
                                                + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.role").value("ADMIN"));
        assertNotEquals(previousId, session.getId());
        mvc.perform(get("/api/sys/departments").session(session)).andExpect(status().isOk());
        mvc.perform(
                        post("/api/sys/departments")
                                .session(session)
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("audit", "Audit", "root", true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.code").value("audit"));
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        assertTrue(session.isInvalid());
        mvc.perform(get("/api/sys/departments")).andExpect(status().isUnauthorized());
    }
}
