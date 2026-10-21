package com.example.tasks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.example.tasks.repository.NoteRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties="spring.datasource.url=jdbc:h2:mem:notes;DB_CLOSE_DELAY=-1")
@AutoConfigureMockMvc
class NoteApiTest {
    @Autowired private MockMvc mvc;
    @Autowired private NoteRepository repository;
    @Autowired private ObjectMapper mapper;
    @DynamicPropertySource
    static void credentials(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD",()->UUID.randomUUID().toString());
        registry.add("APP_VIEWER_PASSWORD",()->UUID.randomUUID().toString());
    }
    @Test
    void AC101_noteCrudPagingAndAtomicBatchesFollowReference() throws Exception {
        repository.deleteAll();
        String body=mvc.perform(post("/api/notes").with(user("admin").roles("ADMIN")).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Note\",\"completed\":false}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        long id=mapper.readTree(body).path("data").path("id").asLong();
        mvc.perform(get("/api/notes/"+id).with(user("viewer"))).andExpect(jsonPath("$.data.title").value("Note"));
        mvc.perform(post("/api/notes/update").with(user("admin").roles("ADMIN")).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":"+id+",\"title\":\"Updated note\",\"completed\":true}"))
                .andExpect(jsonPath("$.data.completed").value(true));
        mvc.perform(get("/api/notes?title=Updated&completed=true&sortBy=title&sortOrder=desc&pageSize=1").with(user("viewer")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/notes?page=100").with(user("viewer"))).andExpect(jsonPath("$.data.records").isEmpty());
        mvc.perform(post("/api/notes/batch-delete").with(user("admin").roles("ADMIN")).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":["+id+",999999]}" )).andExpect(status().isNotFound());
        assertEquals(1,repository.count());
        mvc.perform(post("/api/notes/batch-update-status").with(user("admin").roles("ADMIN")).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":["+id+"],\"completed\":false}")).andExpect(jsonPath("$.data.count").value(1));
        mvc.perform(post("/api/notes/delete").with(user("admin").roles("ADMIN")).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":"+id+"}")).andExpect(jsonPath("$.data.deleted").value(true));
        mvc.perform(get("/api/notes/"+id).with(user("viewer"))).andExpect(status().isNotFound());
        for(String query:new String[]{"page=0","pageSize=101","sortBy=sql","sortOrder=sql"}){
            mvc.perform(get("/api/notes?"+query).with(user("viewer"))).andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/notes/batch-delete").with(user("admin").roles("ADMIN")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"ids\":[1,1]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/notes/batch-update-status").with(user("admin").roles("ADMIN")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"ids\":[1]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/notes").with(user("viewer")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
    }
}
