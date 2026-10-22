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

import com.example.tasks.sys.entity.SysRole;
import com.example.tasks.sys.repository.SysRoleRepository;
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

/** 角色管理接口测试：分页过滤、增删改、编码唯一性冲突以及登录/CSRF 边界。 */
@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:sys-role-api;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysRoleApiTest {
    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();

    @Autowired private MockMvc mvc;
    @Autowired private SysRoleRepository roles;
    @Autowired private ObjectMapper mapper;

    /** 使用随机口令启动本地账号，测试不依赖真实环境变量。 */
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        registry.add("APP_VIEWER_PASSWORD", () -> VIEWER_PASSWORD);
    }

    @BeforeEach
    void reset() {
        roles.deleteAll();
    }

    /** 组装角色请求体，description 用于覆盖可空字段。 */
    private String json(String code, String name, boolean enabled) throws Exception {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("name", name);
        data.put("description", "managed by role API test");
        data.put("enabled", enabled);
        return mapper.writeValueAsString(data);
    }

    @Test
    void rolesListPaginationFilteringAndCrud() throws Exception {
        String created =
                mvc.perform(
                                post("/api/sys/roles")
                                        .with(user("admin").roles("ADMIN"))
                                        .with(csrf())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(json("admin", " Administrator ", true)))
                        .andExpect(status().isCreated())
                        .andExpect(header().exists("Location"))
                        .andExpect(jsonPath("$.data.name").value("Administrator"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long id = mapper.readTree(created).path("data").path("id").asLong();
        mvc.perform(
                        post("/api/sys/roles")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("admin", "Duplicate", true)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_ROLE_CODE_CONFLICT"));
        roles.saveAndFlush(new SysRole("viewer", "Reporter", null, true));
        mvc.perform(get("/api/sys/roles").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.page").value(1));
        mvc.perform(get("/api/sys/roles?pageSize=1&page=2").with(user("viewer")))
                .andExpect(jsonPath("$.data.records[0].code").value("viewer"));
        mvc.perform(get("/api/sys/roles?code=ADM").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/roles?name=report").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/roles?code=%25").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/api/sys/roles/options").with(user("viewer")))
                .andExpect(jsonPath("$.data[0].value").value("admin"))
                .andExpect(jsonPath("$.data[0].label").value("Administrator"));
        mvc.perform(get("/api/sys/roles/" + id).with(user("viewer")))
                .andExpect(jsonPath("$.data.enabled").value(true));
        mvc.perform(
                        post("/api/sys/roles/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"code\":\"admin\",\"name\":\"Operator\","
                                                + "\"description\":\"renamed\",\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Operator"))
                .andExpect(jsonPath("$.data.enabled").value(false));
        mvc.perform(
                        post("/api/sys/roles/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"code\":\"viewer\",\"name\":\"Operator\",\"enabled\":true}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_ROLE_CODE_CONFLICT"));
        mvc.perform(
                        post("/api/sys/roles/delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"id\":" + id + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true))
                .andExpect(jsonPath("$.data.count").value(1));
        assertFalse(roles.existsById(id));
        mvc.perform(get("/api/sys/roles/" + id).with(user("viewer")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SYS_ROLE_NOT_FOUND"));
        mvc.perform(get("/api/sys/roles?page=0").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/sys/roles?pageSize=101").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/sys/roles")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rolesRequireLoginCsrfAndAdminWrites() throws Exception {
        mvc.perform(get("/api/sys/roles"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(
                        post("/api/sys/roles")
                                .with(user("admin").roles("ADMIN"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("auditor", "Auditor", true)))
                .andExpect(status().isForbidden());
        mvc.perform(
                        post("/api/sys/roles")
                                .with(user("viewer").roles("VIEWER"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("auditor", "Auditor", true)))
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
        mvc.perform(get("/api/sys/roles").session(session)).andExpect(status().isOk());
        mvc.perform(
                        post("/api/sys/roles")
                                .session(session)
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("auditor", "Auditor", true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.code").value("auditor"));
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        assertTrue(session.isInvalid());
        mvc.perform(get("/api/sys/roles")).andExpect(status().isUnauthorized());
    }
}
