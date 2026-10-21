package __PACKAGE__;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** Item CRUD tests. */
@SpringBootTest
@AutoConfigureMockMvc
class ItemControllerTest {
  @Autowired private MockMvc mockMvc;
  @Autowired private ItemStore store;

  /** Resets the store. */
  @BeforeEach
  void reset() {
    store.clear();
  }

  /** AC-001. */
  @Test
  void listReturnsArray() throws Exception {
    mockMvc
        .perform(get("/api/items"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$").isArray());
  }

  /** AC-002/AC-004. */
  @Test
  void createAndGetItem() throws Exception {
    mockMvc
        .perform(
            post("/api/items")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"demo\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(1));
    mockMvc
        .perform(get("/api/items/1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("demo"));
  }

  /** AC-003. */
  @Test
  void getMissingReturns404() throws Exception {
    mockMvc.perform(get("/api/items/999")).andExpect(status().isNotFound());
  }

  /** AC-005. */
  @Test
  void createWithoutNameReturns400() throws Exception {
    mockMvc
        .perform(post("/api/items").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isBadRequest());
  }

  /** AC-006. */
  @Test
  void updateItem() throws Exception {
    mockMvc.perform(
        post("/api/items").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"demo\"}"));
    mockMvc
        .perform(
            post("/api/items/update")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":1,\"name\":\"updated\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("updated"));
  }

  /** AC-007. */
  @Test
  void updateMissingReturns404() throws Exception {
    mockMvc
        .perform(
            post("/api/items/update")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":999,\"name\":\"x\"}"))
        .andExpect(status().isNotFound());
  }

  /** AC-008. */
  @Test
  void deleteItem() throws Exception {
    mockMvc.perform(
        post("/api/items").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"demo\"}"));
    mockMvc
        .perform(
            post("/api/items/delete").contentType(MediaType.APPLICATION_JSON).content("{\"id\":1}"))
        .andExpect(status().isOk());
    mockMvc.perform(get("/api/items/1")).andExpect(status().isNotFound());
  }

  /** AC-009. */
  @Test
  void deleteMissingReturns404() throws Exception {
    mockMvc
        .perform(
            post("/api/items/delete")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":999}"))
        .andExpect(status().isNotFound());
  }
}
