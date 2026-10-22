package com.example.tasks.sys;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.tasks.sys.entity.SysRole;
import com.example.tasks.sys.repository.SysRoleRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** 角色 CSV 导入导出接口测试：模板下载、逐行校验、导入落库与重复拒绝、过滤导出以及登录/CSRF 边界。 */
@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:sys-role-csv-api;DB_CLOSE_DELAY=-1",
            "app.csv.max-rows=3"
        })
@AutoConfigureMockMvc
class SysRoleCsvApiTest {
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

    /** 构造 multipart 文件部件，文件名固定为 roles.csv。 */
    private MockMultipartFile csv(String text) {
        return new MockMultipartFile(
                "file", "roles.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void csvTemplateDownloadIsCsv() throws Exception {
        String template =
                mvc.perform(get("/api/sys/roles/import/template").with(user("viewer")))
                        .andExpect(status().isOk())
                        .andExpect(
                                header().string(
                                                HttpHeaders.CONTENT_DISPOSITION,
                                                containsString("sys-role-template.csv")))
                        .andExpect(content().contentTypeCompatibleWith("text/csv"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(template.contains("code,name,description,enabled"), "模板应包含固定表头");
        assertEquals(0, roles.count());
    }

    @Test
    void csvValidateRejectsMalformedRowWithoutWriting() throws Exception {
        MockMultipartFile bad = csv("code,name,description,enabled\n,No Name,,true\n");
        mvc.perform(
                        multipart("/api/sys/roles/import/validate")
                                .file(bad)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.valid").value(false))
                .andExpect(jsonPath("$.data.count").value(0))
                .andExpect(jsonPath("$.data.errors[0]").isNotEmpty());
        for (String text :
                new String[] {
                    "",
                    "wrong,header\nx,true",
                    "code,name,description,enabled\n",
                    "code,name,description,enabled\nok,Ok,,maybe\n",
                    "code,name,description,enabled\n\"unterminated"
                }) {
            mvc.perform(
                            multipart("/api/sys/roles/import")
                                    .file(csv(text))
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf()))
                    .andExpect(status().isBadRequest());
        }
        assertEquals(0, roles.count(), "校验失败时不得写入任何数据");
    }

    @Test
    void csvImportWritesValidRowsAndRejectsDuplicates() throws Exception {
        MockMultipartFile good =
                csv(
                        "code,name,description,enabled\n"
                                + "\"Comma, quote \"\"ok\"\"\",Operator,Full access,true\n"
                                + "viewer,Reporter,,false\n");
        mvc.perform(
                        multipart("/api/sys/roles/import/validate")
                                .file(good)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.count").value(2));
        assertEquals(0, roles.count(), "validate 不应写库");
        mvc.perform(
                        multipart("/api/sys/roles/import")
                                .file(good)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.count").value(2));
        assertEquals(2, roles.count());
        mvc.perform(get("/api/sys/roles?code=viewer").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].name").value("Reporter"))
                .andExpect(jsonPath("$.data.records[0].enabled").value(false));
        mvc.perform(get("/api/sys/roles?name=OPER").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].description").value("Full access"));

        MockMultipartFile inFileDuplicate =
                csv(
                        "code,name,description,enabled\n"
                                + "fresh,First,,true\n"
                                + "fresh,Second,,true\n");
        mvc.perform(
                        multipart("/api/sys/roles/import/validate")
                                .file(inFileDuplicate)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(false))
                .andExpect(jsonPath("$.data.errors[0]").isNotEmpty());
        mvc.perform(
                        multipart("/api/sys/roles/import")
                                .file(inFileDuplicate)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isBadRequest());
        assertEquals(2, roles.count(), "文件内重复编码时整体回滚");

        MockMultipartFile existing =
                csv("code,name,description,enabled\nviewer,Viewer anew,,true\n");
        mvc.perform(
                        multipart("/api/sys/roles/import/validate")
                                .file(existing)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(false));
        mvc.perform(
                        multipart("/api/sys/roles/import")
                                .file(existing)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isBadRequest());
        assertEquals(2, roles.count(), "与现有记录编码重复时不得写入");
    }

    @Test
    void csvExportHonoursFiltersAndRowLimit() throws Exception {
        roles.saveAndFlush(new SysRole("admin", "Administrator", "Full access", true));
        roles.saveAndFlush(new SysRole("viewer", "Reporter", null, false));
        roles.saveAndFlush(new SysRole("=SUM(A1)", "Formula", "danger", true));
        String all =
                mvc.perform(get("/api/sys/roles/export").with(user("viewer")))
                        .andExpect(status().isOk())
                        .andExpect(
                                header().string(
                                                HttpHeaders.CONTENT_DISPOSITION,
                                                containsString("sys-roles.csv")))
                        .andExpect(content().contentTypeCompatibleWith("text/csv"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(all.contains("code,name,description,enabled"));
        assertTrue(all.contains("admin"));
        assertTrue(all.contains("viewer"));
        assertTrue(all.contains("'=SUM(A1)"), "公式前缀应被转义");
        String byCode =
                mvc.perform(get("/api/sys/roles/export?code=ADM").with(user("viewer")))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(byCode.contains("admin"));
        assertFalse(byCode.contains("viewer"));
        String byName =
                mvc.perform(get("/api/sys/roles/export?name=FORM").with(user("viewer")))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(byName.contains("Formula"));
        assertFalse(byName.contains("Reporter"));
        roles.saveAndFlush(new SysRole("extra", "Extra", null, true));
        mvc.perform(get("/api/sys/roles/export").with(user("viewer")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void csvImportRequiresLoginCsrfAndAdmin() throws Exception {
        mvc.perform(get("/api/sys/roles/import/template")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/sys/roles/export")).andExpect(status().isUnauthorized());
        String good = "code,name,description,enabled\naudit,Audit,,true\n";
        for (String path :
                new String[] {"/api/sys/roles/import/validate", "/api/sys/roles/import"}) {
            mvc.perform(multipart(path).file(csv(good)).with(user("admin").roles("ADMIN")))
                    .andExpect(status().isForbidden());
            mvc.perform(
                            multipart(path)
                                    .file(csv(good))
                                    .with(user("viewer").roles("VIEWER"))
                                    .with(csrf()))
                    .andExpect(status().isForbidden());
        }
        assertEquals(0, roles.count(), "未携带 CSRF 或非管理员不得写入");
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
        mvc.perform(get("/api/sys/roles/import/template").session(session))
                .andExpect(status().isOk());
        mvc.perform(
                        multipart("/api/sys/roles/import")
                                .file(csv(good))
                                .session(session)
                                .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.count").value(1));
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        assertTrue(session.isInvalid());
        mvc.perform(get("/api/sys/roles/import/template")).andExpect(status().isUnauthorized());
    }
}
