package com.example.tasks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.tasks.entity.Task;
import com.example.tasks.repository.StoredFileRepository;
import com.example.tasks.repository.TaskRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:api;DB_CLOSE_DELAY=-1",
            "app.csv.max-rows=3",
            "app.files.max-bytes=1024"
        })
@AutoConfigureMockMvc
class TaskApiTest {
    @Test
    void AC007_healthIsPublicWithoutSensitiveDetails() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
    }

    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();
    private static final Path FILES = tempDirectory();
    @Autowired private MockMvc mvc;
    @Autowired private TaskRepository tasks;
    @Autowired private StoredFileRepository files;
    @Autowired private ObjectMapper mapper;

    private static Path tempDirectory() {
        try {
            return Files.createTempDirectory("sg-upload-test-");
        } catch (java.io.IOException exception) {
            throw new IllegalStateException(exception);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        registry.add("APP_VIEWER_PASSWORD", () -> VIEWER_PASSWORD);
        registry.add("app.files.directory", () -> FILES.toString());
    }

    @BeforeEach
    void reset() throws Exception {
        tasks.deleteAll();
        files.deleteAll();
        try (java.util.stream.Stream<Path> paths = Files.list(FILES)) {
            for (Path path : (Iterable<Path>) paths::iterator) {
                Files.delete(path);
            }
        }
    }

    private String json(String title, boolean completed) throws Exception {
        java.util.Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("title", title);
        data.put("completed", completed);
        return mapper.writeValueAsString(data);
    }

    private MockMultipartFile csv(String text) {
        return new MockMultipartFile(
                "file", "tasks.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void AC001_crudPaginationFilteringAndBatchRollback() throws Exception {
        String created =
                mvc.perform(
                                post("/api/tasks")
                                        .with(user("admin").roles("ADMIN"))
                                        .with(csrf())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(json(" Alpha ", false)))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.data.title").value("Alpha"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long id = mapper.readTree(created).path("data").path("id").asLong();
        mvc.perform(get("/api/tasks/" + id).with(user("viewer")))
                .andExpect(jsonPath("$.data.id").value(id));
        mvc.perform(
                        post("/api/tasks/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"title\":\"Beta\",\"completed\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.completed").value(true));
        tasks.saveAndFlush(new Task("Gamma", false));
        mvc.perform(get("/api/tasks?pageSize=1&sortBy=title&sortOrder=desc").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.records[0].title").value("Gamma"));
        mvc.perform(get("/api/tasks?title=Beta&completed=true").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/tasks?page=100").with(user("viewer")))
                .andExpect(jsonPath("$.data.records").isEmpty());
        mvc.perform(
                        post("/api/tasks/batch-delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"ids\":[" + id + ",999999]}"))
                .andExpect(status().isNotFound());
        assertTrue(tasks.existsById(id));
        mvc.perform(
                        post("/api/tasks/batch-update-status")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"ids\":[" + id + "],\"completed\":false}"))
                .andExpect(jsonPath("$.data.count").value(1));
        assertFalse(tasks.findById(id).get().isCompleted());
        mvc.perform(
                        post("/api/tasks/delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"id\":" + id + "}"))
                .andExpect(jsonPath("$.data.deleted").value(true));
        mvc.perform(get("/api/tasks/" + id).with(user("viewer"))).andExpect(status().isNotFound());
        Long other = tasks.findAll().get(0).getId();
        mvc.perform(
                        post("/api/tasks/batch-delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"ids\":[" + other + "]}"))
                .andExpect(jsonPath("$.data.count").value(1));
    }

    @Test
    void AC003_validationAndJsonErrors() throws Exception {
        for (String query :
                new String[] {
                    "page=0", "pageSize=101", "pageSize=0", "sortBy=sql", "sortOrder=DROP", "page=x"
                }) {
            mvc.perform(get("/api/tasks?" + query).with(user("viewer")))
                    .andExpect(status().isBadRequest());
        }
        for (String body :
                new String[] {
                    "{",
                    "{}",
                    json(" ", false),
                    json(new String(new char[201]).replace('\0', 'a'), false)
                }) {
            mvc.perform(
                            post("/api/tasks")
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf())
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.traceId").isNotEmpty());
        }
        for (String body :
                new String[] {
                    "{\"ids\":[]}",
                    "{\"ids\":[1,1]}",
                    "{\"ids\":[null]}",
                    "{\"ids\":[-1]}",
                    "{\"ids\":[1]}"
                }) {
            mvc.perform(
                            post("/api/tasks/batch-update-status")
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf())
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(
                        post("/api/tasks/delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"id\":0}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/tasks/1").with(user("admin").roles("ADMIN")).with(csrf()))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(
                        post("/api/tasks")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.TEXT_PLAIN)
                                .content("x"))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void AC004_loginCsrfSessionRotationLogoutAndPermissions() throws Exception {
        mvc.perform(get("/api/tasks"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(post("/api/tasks").with(user("admin").roles("ADMIN")))
                .andExpect(status().isForbidden());
        for (String path :
                new String[] {
                    "/api/tasks",
                    "/api/tasks/update",
                    "/api/tasks/delete",
                    "/api/tasks/batch-delete",
                    "/api/tasks/batch-update-status",
                    "/api/tasks/import",
                    "/api/files/upload"
                }) {
            mvc.perform(
                            post(path)
                                    .with(user("viewer").roles("VIEWER"))
                                    .with(csrf())
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{}"))
                    .andExpect(status().isForbidden());
        }
        org.springframework.test.web.servlet.MvcResult tokenResult =
                mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) tokenResult.getRequest().getSession();
        String oldId = session.getId();
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
        assertNotEquals(oldId, session.getId());
        mvc.perform(get("/api/auth/me").session(session))
                .andExpect(jsonPath("$.data.username").value("admin"));
        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isOk());
        assertTrue(session.isInvalid());
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    @Test
    void AC005_csvValidationImportExportAndAtomicFailure() throws Exception {
        MockMultipartFile good =
                csv("title,completed\r\n\"Comma, quote \"\"ok\"\"\",true\r\nOther,false\r\n");
        mvc.perform(
                        multipart("/api/tasks/import/validate")
                                .file(good)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.count").value(2));
        assertEquals(0, tasks.count());
        mvc.perform(
                        multipart("/api/tasks/import")
                                .file(good)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.count").value(2));
        MockMultipartFile bad = csv("title,completed\nGood,false\n,wrong\n");
        mvc.perform(
                        multipart("/api/tasks/import/validate")
                                .file(bad)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(jsonPath("$.data.valid").value(false))
                .andExpect(jsonPath("$.data.errors[0]").isNotEmpty());
        mvc.perform(
                        multipart("/api/tasks/import")
                                .file(bad)
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isBadRequest());
        assertEquals(2, tasks.count());
        tasks.saveAndFlush(new Task("=SUM(A1)", false));
        String exported =
                mvc.perform(get("/api/tasks/export").with(user("viewer")))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertTrue(exported.contains("'=SUM(A1)"));
        mvc.perform(get("/api/tasks/import/template").with(user("viewer")))
                .andExpect(status().isOk());
        tasks.saveAndFlush(new Task("overflow", false));
        mvc.perform(get("/api/tasks/export").with(user("viewer")))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/tasks/export?title=Other&completed=false").with(user("viewer")))
                .andExpect(status().isOk());
        for (String text :
                new String[] {
                    "",
                    "wrong,header\nx,true",
                    "title,completed\n",
                    "title,completed\n1,true\n2,true\n3,true\n4,true",
                    "title,completed\n\"unterminated"
                }) {
            mvc.perform(
                            multipart("/api/tasks/import")
                                    .file(csv(text))
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf()))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    void AC006_filesUploadMetadataDownloadAndInvalidContent() throws Exception {
        String response =
                mvc.perform(
                                multipart("/api/files/upload")
                                        .file(
                                                new MockMultipartFile(
                                                        "file",
                                                        "note.txt",
                                                        "text/plain",
                                                        "hello".getBytes(StandardCharsets.UTF_8)))
                                        .with(user("admin").roles("ADMIN"))
                                        .with(csrf()))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String id = mapper.readTree(response).path("data").path("fileId").asText();
        mvc.perform(get("/api/files").with(user("viewer")))
                .andExpect(jsonPath("$.data[0].fileId").value(id));
        mvc.perform(get("/api/files/" + id).with(user("viewer")))
                .andExpect(jsonPath("$.data.size").value(5));
        assertEquals(
                "hello",
                mvc.perform(get("/api/files/" + id + "/download").with(user("viewer")))
                        .andReturn()
                        .getResponse()
                        .getContentAsString());
        mvc.perform(get("/api/files/" + id + "/download")).andExpect(status().isUnauthorized());
        for (String name :
                new String[] {
                    "../escape.txt", "..\\escape.txt", "bad.exe", "fake.png", "control\n.txt"
                }) {
            mvc.perform(
                            multipart("/api/files/upload")
                                    .file(
                                            new MockMultipartFile(
                                                    "file",
                                                    name,
                                                    "text/plain",
                                                    new byte[] {1, 2, 3}))
                                    .with(user("admin").roles("ADMIN"))
                                    .with(csrf()))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(
                        multipart("/api/files/upload")
                                .file(
                                        new MockMultipartFile(
                                                "file", "big.txt", "text/plain", new byte[1025]))
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf()))
                .andExpect(status().isPayloadTooLarge());
        Files.delete(FILES.resolve(id));
        mvc.perform(get("/api/files/" + id + "/download").with(user("viewer")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/files/unknown").with(user("viewer")))
                .andExpect(status().isNotFound());
    }
}
