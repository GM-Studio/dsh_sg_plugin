package com.example.tasks;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.tasks.repository.CustomerRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:customer-contract;DB_CLOSE_DELAY=-1",
            "spring.jpa.hibernate.ddl-auto=create-drop"
        })
@AutoConfigureMockMvc
class CustomerApiTest {
    private static final String ADMIN_PASSWORD = UUID.randomUUID().toString();
    private static final String VIEWER_PASSWORD = UUID.randomUUID().toString();

    @Autowired private MockMvc mvc;
    @Autowired private CustomerRepository customers;

    @DynamicPropertySource
    static void credentials(DynamicPropertyRegistry registry) {
        registry.add("APP_ADMIN_PASSWORD", () -> ADMIN_PASSWORD);
        registry.add("APP_VIEWER_PASSWORD", () -> VIEWER_PASSWORD);
    }

    @BeforeEach
    void reset() {
        customers.deleteAll();
    }

    private String body(String email, String status) {
        return "{\"name\":\"Acme Buyer\",\"email\":\""
                + email
                + "\",\"company\":\"Acme\",\"status\":\""
                + status
                + "\",\"notes\":\"Important account\"}";
    }

    private long create(String email, String status) throws Exception {
        String response =
                mvc.perform(
                                post("/api/customers")
                                        .with(user("admin").roles("ADMIN"))
                                        .with(csrf())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body(email, status)))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.data.name").value("Acme Buyer"))
                        .andExpect(jsonPath("$.data.email").value(email))
                        .andExpect(jsonPath("$.data.status").value(status))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        Number id = com.jayway.jsonpath.JsonPath.read(response, "$.data.id");
        return id.longValue();
    }

    @Test
    void AC001_customerCrudPersistsAllFields() throws Exception {
        long id = create("buyer@example.com", "ACTIVE");
        mvc.perform(get("/api/customers/" + id).with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.company").value("Acme"))
                .andExpect(jsonPath("$.data.notes").value("Important account"));
        mvc.perform(
                        post("/api/customers/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"name\":\"Acme Buyer\",\"email\":\"buyer@example.com\","
                                                + "\"company\":\"Acme Ltd\",\"status\":\"INACTIVE\",\"notes\":\"Renewed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("INACTIVE"))
                .andExpect(jsonPath("$.data.company").value("Acme Ltd"));
        mvc.perform(
                        post("/api/customers/delete")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"id\":" + id + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.deleted").value(true));
    }

    @Test
    void AC002_validationRejectsDuplicateEmailAndInvalidStatus() throws Exception {
        create("unique@example.com", "ACTIVE");
        mvc.perform(
                        post("/api/customers")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body("unique@example.com", "ACTIVE")))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/customers")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body("other@example.com", "UNKNOWN")))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/customers")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"name\":\"\",\"email\":\"bad\",\"status\":\"ACTIVE\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void AC003_summaryAndFilteredListReconcileCustomers() throws Exception {
        create("active@example.com", "ACTIVE");
        create("inactive@example.com", "INACTIVE");
        mvc.perform(get("/api/customers/summary").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.active").value(1))
                .andExpect(jsonPath("$.data.inactive").value(1));
        mvc.perform(get("/api/customers?status=INACTIVE").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].email").value("inactive@example.com"));
    }
}
