package com.example.tasks.sys;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.tasks.sys.repository.SysAuditLogRepository;
import com.example.tasks.sys.service.SysAuditLogService;
import com.example.tasks.sys.vo.SysAuditLogVO;
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

/** 审计日志接口测试：空列表、服务端追写后的过滤与倒序、分页校验以及登录边界。 */
@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:sys-audit-api;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysAuditLogApiTest {
    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();

    @Autowired private MockMvc mvc;
    @Autowired private SysAuditLogRepository auditLogs;
    @Autowired private SysAuditLogService audits;
    @Autowired private ObjectMapper mapper;

    /** 使用随机口令启动本地账号，测试不依赖真实环境变量。 */
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        registry.add("APP_VIEWER_PASSWORD", () -> VIEWER_PASSWORD);
    }

    @BeforeEach
    void reset() {
        auditLogs.deleteAll();
    }

    @Test
    void auditsAreEmptyThenTrimmedFilteredAndOrderedNewestFirst() throws Exception {
        mvc.perform(get("/api/sys/audits").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.records").isEmpty());
        SysAuditLogVO first = audits.record(" Alice ", " LOGIN ", " user:1 ", " signed in ");
        SysAuditLogVO second = audits.record("bob", "ROLE_UPDATE", "role:admin", "granted");
        audits.record("alice", "LOGOUT", null, null);
        assertNotNull(first.getId());
        assertEquals("Alice", first.getActor());
        assertEquals("LOGIN", first.getAction());
        assertEquals("user:1", first.getTarget());
        assertEquals("signed in", first.getDetail());
        assertFalse(first.getCreatedAt().isEmpty());
        mvc.perform(get("/api/sys/audits").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(3))
                .andExpect(jsonPath("$.data.page").value(1))
                .andExpect(jsonPath("$.data.records[0].action").value("LOGOUT"))
                .andExpect(jsonPath("$.data.records[1].id").value(second.getId().intValue()))
                .andExpect(jsonPath("$.data.records[2].id").value(first.getId().intValue()));
        mvc.perform(get("/api/sys/audits?pageSize=1&page=2").with(user("viewer")))
                .andExpect(jsonPath("$.data.records[0].id").value(second.getId().intValue()));
        mvc.perform(get("/api/sys/audits?actor=ALI").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(2));
        mvc.perform(get("/api/sys/audits?action=role").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].target").value("role:admin"));
        mvc.perform(get("/api/sys/audits?actor=%25").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/api/sys/audits?page=0").with(user("viewer")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAGE"));
        mvc.perform(get("/api/sys/audits?pageSize=101").with(user("viewer")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAGE"));
    }

    @Test
    void auditsRequireLoginAndViewerMayRead() throws Exception {
        mvc.perform(get("/api/sys/audits"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        audits.record("alice", "LOGIN", "user:1", "signed in");
        mvc.perform(get("/api/sys/audits").with(user("viewer").roles("VIEWER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].actor").value("alice"));
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
                                        "{\"username\":\"viewer\",\"password\":\""
                                                + VIEWER_PASSWORD
                                                + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.role").value("VIEWER"));
        assertNotEquals(previousId, session.getId());
        mvc.perform(get("/api/sys/audits").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(
                        post("/api/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"username\":\"viewer\",\"password\":\""
                                                + VIEWER_PASSWORD
                                                + "\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        assertTrue(session.isInvalid());
        mvc.perform(get("/api/sys/audits")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/sys/audits").with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk());
    }
}
