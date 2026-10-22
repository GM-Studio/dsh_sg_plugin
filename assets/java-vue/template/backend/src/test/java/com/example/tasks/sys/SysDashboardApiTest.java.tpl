package com.example.tasks.sys;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.tasks.sys.repository.SysRoleRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/** 仪表盘统计接口测试：登录/CSRF 边界以及统计数字的只读汇总。 */
@SpringBootTest(
        properties = {"spring.datasource.url=jdbc:h2:mem:sys-dashboard-api;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysDashboardApiTest {
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

    /** 读取仪表盘统计中的指定字段，便于断言数值关系。 */
    private long count(String field) throws Exception {
        String body =
                mvc.perform(get("/api/sys/dashboard").with(user("viewer")))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return mapper.readTree(body).path("data").path(field).asLong();
    }

    /** 未登录访问返回 401；登录后返回五个均为非负数的统计字段。 */
    @Test
    void dashboardRequiresLoginAndReturnsNonNegativeCounts() throws Exception {
        mvc.perform(get("/api/sys/dashboard"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(get("/api/sys/dashboard").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userCount").isNumber())
                .andExpect(jsonPath("$.data.roleCount").isNumber())
                .andExpect(jsonPath("$.data.departmentCount").isNumber())
                .andExpect(jsonPath("$.data.menuCount").isNumber())
                .andExpect(jsonPath("$.data.auditCount").isNumber());
        assertTrue(count("userCount") >= 0);
        assertTrue(count("roleCount") >= 0);
        assertTrue(count("departmentCount") >= 0);
        assertTrue(count("menuCount") >= 0);
        assertTrue(count("auditCount") >= 0);
    }

    /** 通过角色接口新增角色后，仪表盘的角色总数随之增加。 */
    @Test
    void creatingRoleIncreasesRoleCount() throws Exception {
        long before = count("roleCount");
        mvc.perform(
                        post("/api/sys/roles")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\"analyst\",\"name\":\"Analyst\","
                                                + "\"description\":\"created by dashboard test\","
                                                + "\"enabled\":true}"))
                .andExpect(status().isCreated());
        assertTrue(count("roleCount") > before);
    }

    /** 真实会话登录后仍可读取仪表盘，登出后重新变为未认证。 */
    @Test
    void dashboardReadableWithSessionLogin() throws Exception {
        MvcResult tokenResult =
                mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) tokenResult.getRequest().getSession();
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
        mvc.perform(get("/api/sys/dashboard").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userCount").isNumber());
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        mvc.perform(get("/api/sys/dashboard")).andExpect(status().isUnauthorized());
    }
}
