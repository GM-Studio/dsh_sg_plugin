package com.example.tasks;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class TaskApiTest {
  private static final String DB_URL = databaseUrl();

  @Autowired private MockMvc mvc;
  @Autowired private TaskRepository repository;
  @Autowired private ObjectMapper mapper;

  private static String databaseUrl() {
    try {
      return "jdbc:h2:file:"
          + Files.createTempDirectory("task-api-")
              .resolve("tasks")
              .toAbsolutePath()
              .toString()
              .replace('\\', '/')
          + ";DB_CLOSE_ON_EXIT=FALSE";
    } catch (IOException exception) {
      throw new IllegalStateException(exception);
    }
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", () -> DB_URL);
  }

  @BeforeEach
  void clean() {
    repository.deleteAll();
  }

  @Test
  void AC001_crudAndMissingTask() throws Exception {
    String body =
        mvc.perform(
                post("/api/tasks")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"title\":\" First \",\"completed\":false}"))
            .andExpect(status().isCreated())
            .andExpect(header().exists("Location"))
            .andExpect(jsonPath("$.title").value("First"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    long id = mapper.readTree(body).get("id").asLong();
    mvc.perform(get("/api/tasks"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1));
    mvc.perform(get("/api/tasks/{id}", id))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.completed").value(false));
    mvc.perform(
            post("/api/tasks/update")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":" + id + ",\"title\":\"Changed\",\"completed\":true}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("Changed"))
        .andExpect(jsonPath("$.completed").value(true));
    mvc.perform(
            post("/api/tasks/delete")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":" + id + "}"))
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.id").value(id))
        .andExpect(jsonPath("$.deleted").value(true));
    mvc.perform(get("/api/tasks/{id}", id))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("Task not found"));
    mvc.perform(
            post("/api/tasks/update")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":" + id + ",\"title\":\"Missing\",\"completed\":false}"))
        .andExpect(status().isNotFound());
    mvc.perform(
            post("/api/tasks/delete")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":" + id + "}"))
        .andExpect(status().isNotFound());
  }

  @Test
  void AC001_mutationIdsAndMethodsAreValidatedAsJson() throws Exception {
    for (String body : new String[] {"{}", "{\"id\":null}", "{\"id\":0}", "{\"id\":-1}"}) {
      mvc.perform(post("/api/tasks/delete").contentType(MediaType.APPLICATION_JSON).content(body))
          .andExpect(status().isBadRequest())
          .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));
    }
    mvc.perform(
            post("/api/tasks/update")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Missing id\",\"completed\":false}"))
        .andExpect(status().isBadRequest());
    for (HttpMethod method :
        new HttpMethod[] {
          HttpMethod.valueOf("PUT"), HttpMethod.valueOf("DELETE"), HttpMethod.valueOf("PATCH")
        }) {
      mvc.perform(
              request(method, "/api/tasks/1").contentType(MediaType.APPLICATION_JSON).content("{}"))
          .andExpect(status().isMethodNotAllowed())
          .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));
    }
  }

  @Test
  void AC001_invalidRequestsAndHealth() throws Exception {
    mvc.perform(
            post("/api/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"  \",\"completed\":false}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.title").exists());
    mvc.perform(
            post("/api/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"No boolean\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.completed").exists());
    String longTitle = new String(new char[201]).replace('\0', 'x');
    mvc.perform(
            post("/api/tasks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"" + longTitle + "\",\"completed\":false}"))
        .andExpect(status().isBadRequest());
    mvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON).content("not json"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Malformed request"));
    mvc.perform(get("/api/tasks/not-a-number")).andExpect(status().isBadRequest());
    mvc.perform(get("/actuator/health"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("UP"));
  }
}
