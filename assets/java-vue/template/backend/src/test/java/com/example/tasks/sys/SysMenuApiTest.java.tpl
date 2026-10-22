package com.example.tasks.sys;

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

import com.example.tasks.sys.entity.SysMenu;
import com.example.tasks.sys.repository.SysMenuRepository;
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

/** 菜单管理接口测试：分页过滤、下拉排序、增删改、编码唯一性冲突以及登录/CSRF 边界。 */
@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:sys-menu-api;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysMenuApiTest {
    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();

    @Autowired private MockMvc mvc;
    @Autowired private SysMenuRepository menus;
    @Autowired private ObjectMapper mapper;

    /** 使用随机口令启动本地账号，测试不依赖真实环境变量。 */
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        registry.add("APP_VIEWER_PASSWORD", () -> VIEWER_PASSWORD);
    }

    @BeforeEach
    void reset() {
        menus.deleteAll();
    }

    /** 组装菜单请求体，path/icon 用于覆盖可空字段。 */
    private String json(
            String code, String name, String path, String icon, int sortOrder, boolean enabled)
            throws Exception {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("name", name);
        data.put("path", path);
        data.put("icon", icon);
        data.put("sortOrder", sortOrder);
        data.put("enabled", enabled);
        return mapper.writeValueAsString(data);
    }

    @Test
    void menusListPaginationFilteringOptionsAndCrud() throws Exception {
        MvcResult created =
                mvc.perform(
                                post("/api/sys/menus")
                                        .with(user("admin").roles("ADMIN"))
                                        .with(csrf())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                json(
                                                        "dashboard",
                                                        " Dashboard ",
                                                        "/dashboard",
                                                        "home",
                                                        20,
                                                        true)))
                        .andExpect(status().isCreated())
                        .andExpect(header().exists("Location"))
                        .andExpect(jsonPath("$.data.name").value("Dashboard"))
                        .andExpect(jsonPath("$.data.sortOrder").value(20))
                        .andReturn();
        long id =
                mapper.readTree(created.getResponse().getContentAsString())
                        .path("data")
                        .path("id")
                        .asLong();
        assertEquals("/api/sys/menus/" + id, created.getResponse().getHeader("Location"));
        mvc.perform(
                        post("/api/sys/menus")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("dashboard", "Duplicate", "/dup", null, 30, true)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_MENU_CODE_CONFLICT"));
        menus.saveAndFlush(new SysMenu("users", "Users", "/sys/users", "user", 10, true));
        mvc.perform(get("/api/sys/menus").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.page").value(1))
                .andExpect(jsonPath("$.data.records[0].code").value("users"))
                .andExpect(jsonPath("$.data.records[1].code").value("dashboard"));
        mvc.perform(get("/api/sys/menus?pageSize=1&page=2").with(user("viewer")))
                .andExpect(jsonPath("$.data.records[0].code").value("dashboard"));
        mvc.perform(get("/api/sys/menus?code=DASH").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/menus?name=users").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/menus?code=%25").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/api/sys/menus/options").with(user("viewer")))
                .andExpect(jsonPath("$.data[0].value").value("users"))
                .andExpect(jsonPath("$.data[0].label").value("Users"))
                .andExpect(jsonPath("$.data[1].value").value("dashboard"))
                .andExpect(jsonPath("$.data[1].label").value("Dashboard"));
        mvc.perform(get("/api/sys/menus/" + id).with(user("viewer")))
                .andExpect(jsonPath("$.data.enabled").value(true))
                .andExpect(jsonPath("$.data.sortOrder").value(20))
                .andExpect(jsonPath("$.data.path").value("/dashboard"));
        mvc.perform(
                        post("/api/sys/menus/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"code\":\"dashboard\",\"name\":\"Overview\","
                                                + "\"path\":\"/overview\",\"icon\":\"chart\","
                                                + "\"sortOrder\":5,\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Overview"))
                .andExpect(jsonPath("$.data.sortOrder").value(5))
                .andExpect(jsonPath("$.data.enabled").value(false));
        mvc.perform(
                        post("/api/sys/menus/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"code\":\"users\",\"name\":\"Overview\","
                                                + "\"sortOrder\":5,\"enabled\":true}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SYS_MENU_CODE_CONFLICT"));
        mvc.perform(
                        post("/api/sys/menus/delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"id\":" + id + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true))
                .andExpect(jsonPath("$.data.count").value(1));
        assertFalse(menus.existsById(id));
        mvc.perform(get("/api/sys/menus/" + id).with(user("viewer")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SYS_MENU_NOT_FOUND"));
        mvc.perform(get("/api/sys/menus?page=0").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/sys/menus?pageSize=101").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/sys/menus")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/sys/menus")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        json(
                                                "reports",
                                                "Reports",
                                                "/reports",
                                                "chart",
                                                10000,
                                                true)))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/sys/menus")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("reports", "Reports", "/reports", "chart", -1, true)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void menusRequireLoginCsrfAndAdminWrites() throws Exception {
        mvc.perform(get("/api/sys/menus"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(
                        post("/api/sys/menus")
                                .with(user("admin").roles("ADMIN"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("reports", "Reports", "/reports", "chart", 40, true)))
                .andExpect(status().isForbidden());
        mvc.perform(
                        post("/api/sys/menus")
                                .with(user("viewer").roles("VIEWER"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("reports", "Reports", "/reports", "chart", 40, true)))
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
        mvc.perform(get("/api/sys/menus").session(session)).andExpect(status().isOk());
        mvc.perform(
                        post("/api/sys/menus")
                                .session(session)
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json("reports", "Reports", "/reports", "chart", 40, true)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.code").value("reports"))
                .andExpect(jsonPath("$.data.sortOrder").value(40));
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        assertTrue(session.isInvalid());
        mvc.perform(get("/api/sys/menus")).andExpect(status().isUnauthorized());
    }
}
