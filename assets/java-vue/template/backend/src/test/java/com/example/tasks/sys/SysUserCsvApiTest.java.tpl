package com.example.tasks.sys;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.tasks.sys.entity.SysUser;
import com.example.tasks.sys.repository.SysUserRepository;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** 用户 CSV 导入导出接口测试：模板下载、逐行校验、导入落库与重复拒绝、过滤导出与权限边界。 */
@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:sys-user-csv-api;DB_CLOSE_DELAY=-1",
            "app.csv.max-rows=1000"
        })
@AutoConfigureMockMvc
class SysUserCsvApiTest {
    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();

    @Autowired private MockMvc mvc;
    @Autowired private SysUserRepository users;

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

    /** 构造 multipart 文件部件，文件名固定为 users.csv。 */
    private MockMultipartFile csv(String text) {
        return new MockMultipartFile(
                "file", "users.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void csvTemplateDownloadIsCsv() throws Exception {
        String template =
                mvc.perform(get("/api/sys/users/import/template").with(user("viewer")))
                        .andExpect(status().isOk())
                        .andExpect(
                                header().string(
                                                HttpHeaders.CONTENT_DISPOSITION,
                                                containsString("sys-user-template.csv")))
                        .andExpect(content().contentTypeCompatibleWith("text/csv"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(template.contains("username,displayName,roleCode,enabled"), "模板应包含固定表头");
        assertEquals(0, users.count());
    }

    @Test
    void csvValidateRejectsMalformedRowWithoutWriting() throws Exception {
        MockMultipartFile bad =
                csv("username,displayName,roleCode,enabled\n,No Name,viewer,true\n");
        mvc.perform(
                        multipart("/api/sys/users/import/validate")
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
                    "wrong,header\nx,viewer",
                    "username,displayName,roleCode,enabled\n",
                    "username,displayName,roleCode,enabled\nok,Ok,viewer,maybe\n",
                    "username,displayName,roleCode,enabled\n\"unterminated"
                }) {
            mvc.perform(
                            multipart("/api/sys/users/import")
                                    .file(csv(text))
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf()))
                    .andExpect(status().isBadRequest());
        }
        assertEquals(0, users.count(), "校验失败时不得写入任何数据");
    }

    @Test
    void csvImportWritesValidRowsAndRejectsDuplicates() throws Exception {
        MockMultipartFile good =
                csv(
                        "username,displayName,roleCode,enabled\n"
                                + "alice,Alice A,admin,true\n"
                                + "bob,,viewer,false\n");
        mvc.perform(
                        multipart("/api/sys/users/import/validate")
                                .file(good)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.count").value(2));
        assertEquals(0, users.count(), "validate 不应写库");
        mvc.perform(
                        multipart("/api/sys/users/import")
                                .file(good)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.count").value(2));
        assertEquals(2, users.count());
        mvc.perform(get("/api/sys/users?username=bob").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].roleCode").value("viewer"))
                .andExpect(jsonPath("$.data.records[0].enabled").value(false));
        mvc.perform(get("/api/sys/users?username=alice").with(user("viewer")))
                .andExpect(jsonPath("$.data.records[0].displayName").value("Alice A"));

        MockMultipartFile inFileDuplicate =
                csv(
                        "username,displayName,roleCode,enabled\n"
                                + "carol,Carol,viewer,true\n"
                                + "carol,Carol again,viewer,false\n");
        mvc.perform(
                        multipart("/api/sys/users/import/validate")
                                .file(inFileDuplicate)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(false))
                .andExpect(jsonPath("$.data.errors[0]").isNotEmpty());
        mvc.perform(
                        multipart("/api/sys/users/import")
                                .file(inFileDuplicate)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isBadRequest());
        assertEquals(2, users.count(), "重复用户名时整体回滚");

        MockMultipartFile existing =
                csv("username,displayName,roleCode,enabled\nalice,Alice anew,viewer,false\n");
        mvc.perform(
                        multipart("/api/sys/users/import/validate")
                                .file(existing)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(false));
        mvc.perform(
                        multipart("/api/sys/users/import")
                                .file(existing)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isBadRequest());
        assertEquals(2, users.count(), "与现有记录重名时不得写入");
    }

    @Test
    void csvExportHonoursFilters() throws Exception {
        users.saveAndFlush(new SysUser("dave", "Dave", "admin", true));
        users.saveAndFlush(new SysUser("erin", "Erin", "viewer", false));
        users.saveAndFlush(new SysUser("=SUM(A1)", "Formula", "viewer", true));
        String all =
                mvc.perform(get("/api/sys/users/export").with(user("viewer")))
                        .andExpect(status().isOk())
                        .andExpect(
                                header().string(
                                                HttpHeaders.CONTENT_DISPOSITION,
                                                containsString("sys-users.csv")))
                        .andExpect(content().contentTypeCompatibleWith("text/csv"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(all.contains("username,displayName,roleCode,enabled"));
        assertTrue(all.contains("dave"));
        assertTrue(all.contains("erin"));
        assertTrue(all.contains("'=SUM(A1)"), "公式前缀应被转义");
        String byRole =
                mvc.perform(get("/api/sys/users/export?roleCode=admin").with(user("viewer")))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(byRole.contains("dave"));
        assertFalse(byRole.contains("erin"));
        String byEnabled =
                mvc.perform(get("/api/sys/users/export?enabled=false").with(user("viewer")))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(byEnabled.contains("erin"));
        assertFalse(byEnabled.contains("dave"));
        String byUsername =
                mvc.perform(get("/api/sys/users/export?username=DAV").with(user("viewer")))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(byUsername.contains("dave"));
        assertFalse(byUsername.contains("erin"));
    }

    @Test
    void csvAuthRequiresLoginAndAdmin() throws Exception {
        mvc.perform(get("/api/sys/users/import/template")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/sys/users/export")).andExpect(status().isUnauthorized());
        String good = "username,displayName,roleCode,enabled\nalice,Alice,admin,true\n";
        for (String path :
                new String[] {"/api/sys/users/import/validate", "/api/sys/users/import"}) {
            mvc.perform(
                            multipart(path)
                                    .file(csv(good))
                                    .with(user("viewer").roles("VIEWER"))
                                    .with(csrf()))
                    .andExpect(status().isForbidden());
        }
        assertEquals(0, users.count());
    }
}
