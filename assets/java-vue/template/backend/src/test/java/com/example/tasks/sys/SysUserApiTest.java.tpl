package com.acme.orders.sys;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

import com.acme.orders.sys.entity.SysUser;
import com.acme.orders.sys.repository.SysUserRepository;
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

/** 用户管理接口测试：过滤查询、增删改、用户名冲突、批量删除回滚与权限边界。 */
@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:sys-user-api;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysUserApiTest {
    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();

    @Autowired private MockMvc mvc;
    @Autowired private SysUserRepository users;
    @Autowired private ObjectMapper mapper;

    /** 使用随机口令启动本地账号，测试不依赖真实环境变量。 */
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        registry.add("APP_VIEWER_PASSWORD", () -> VIEWER_PASSWORD);
    }

    @BeforeEach
    void reset() {
        users.deleteAll();
    }

    /** 组装用户请求体，displayName 用于覆盖可空字段。 */
    private String json(String username, String displayName, String roleCode, boolean enabled)
            throws Exception {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("username", username);
        data.put("displayName", displayName);
        data.put("roleCode", roleCode);
        data.put("enabled", enabled);
        return mapper.writeValueAsString(data);
    }

    /** 以便捷方式调用创建接口并返回新用户主键。 */
    private long create(String username, String displayName, String roleCode, boolean enabled)
            throws Exception {
        String created =
                mvc.perform(
                                post("/api/sys/users")
                                        .with(user("admin").roles("ADMIN"))
                                        .with(csrf())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(json(username, displayName, roleCode, enabled)))
                        .andExpect(status().isCreated())
                        .andExpect(header().exists("Location"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return mapper.readTree(created).path("data").path("id").asLong();
    }

    @Test
    void usersListFiltersAndCrudRejectsDuplicateUsername() throws Exception {
        long id = create("alice", " Alice ", "admin", true);
        mvc.perform(
                        post("/api/sys/users")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("alice", "Duplicate", "viewer", true)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_USER_NAME_CONFLICT"));
        users.saveAndFlush(new SysUser("bob", "Bob", "viewer", false));
        mvc.perform(get("/api/sys/users").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.records[0].username").value("alice"));
        mvc.perform(get("/api/sys/users?pageSize=1&page=2").with(user("viewer")))
                .andExpect(jsonPath("$.data.records[0].username").value("bob"));
        mvc.perform(get("/api/sys/users?username=ALI").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/users?roleCode=viewer&enabled=false").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/users?enabled=true").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/users/" + id).with(user("viewer")))
                .andExpect(jsonPath("$.data.displayName").value("Alice"))
                .andExpect(jsonPath("$.data.roleCode").value("admin"));
        mvc.perform(
                        post("/api/sys/users/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"username\":\"alice\",\"displayName\":\"Alicia\","
                                                + "\"roleCode\":\"viewer\",\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.displayName").value("Alicia"))
                .andExpect(jsonPath("$.data.roleCode").value("viewer"))
                .andExpect(jsonPath("$.data.enabled").value(false));
        mvc.perform(
                        post("/api/sys/users/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"username\":\"bob\",\"roleCode\":\"admin\",\"enabled\":true}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_USER_NAME_CONFLICT"));
        mvc.perform(get("/api/sys/users?page=0").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/sys/users?pageSize=101").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/sys/users")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/sys/users/delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"id\":" + id + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true))
                .andExpect(jsonPath("$.data.count").value(1));
        assertFalse(users.existsById(id));
        mvc.perform(get("/api/sys/users/" + id).with(user("viewer")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SYS_USER_NOT_FOUND"));
    }

    @Test
    void usersBatchDeleteRollsBackAndEnforcesPermissions() throws Exception {
        long first = create("carol", "Carol", "viewer", true);
        long second = create("dave", "Dave", "viewer", true);
        mvc.perform(get("/api/sys/users")).andExpect(status().isUnauthorized());
        mvc.perform(
                        post("/api/sys/users")
                                .with(user("viewer").roles("VIEWER"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("eve", "Eve", "viewer", true)))
                .andExpect(status().isForbidden());
        mvc.perform(
                        post("/api/sys/users")
                                .with(user("admin").roles("ADMIN"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("eve", "Eve", "viewer", true)))
                .andExpect(status().isForbidden());
        mvc.perform(
                        post("/api/sys/users/batch-delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"ids\":[" + first + ",999999]}"))
                .andExpect(status().isNotFound());
        assertTrue(users.existsById(first));
        for (String body :
                new String[] {
                    "{\"ids\":[]}",
                    "{\"ids\":[" + first + "," + first + "]}",
                    "{\"ids\":[-1]}",
                    "{}"
                }) {
            mvc.perform(
                            post("/api/sys/users/batch-delete")
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf())
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(
                        post("/api/sys/users/batch-delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"ids\":[" + first + "," + second + "]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true))
                .andExpect(jsonPath("$.data.count").value(2));
        assertEquals(0, users.count());
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
        mvc.perform(get("/api/sys/users").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        assertTrue(session.isInvalid());
        mvc.perform(get("/api/sys/users")).andExpect(status().isUnauthorized());
    }
}
