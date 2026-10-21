package com.example.tasks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.tasks.entity.Task;
import com.example.tasks.repository.TaskRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

class TaskPersistenceTest {
    private ConfigurableApplicationContext open(String url) {
        return new SpringApplicationBuilder(TaskApplication.class)
                .web(WebApplicationType.NONE)
                .run(
                        "--spring.datasource.url=" + url,
                        "--spring.jpa.hibernate.ddl-auto=update",
                        "--APP_ADMIN_PASSWORD=" + java.util.UUID.randomUUID(),
                        "--APP_VIEWER_PASSWORD=" + java.util.UUID.randomUUID());
    }

    @Test
    void AC002_taskSurvivesClosingAndReopeningDatabase() throws Exception {
        Path directory = Files.createTempDirectory("task-persistence-");
        String url =
                "jdbc:h2:file:"
                        + directory.resolve("tasks").toAbsolutePath().toString().replace('\\', '/')
                        + ";DB_CLOSE_ON_EXIT=FALSE";
        Long id;
        try (ConfigurableApplicationContext first = open(url)) {
            id =
                    first.getBean(TaskRepository.class)
                            .saveAndFlush(new Task("Persistent", true))
                            .getId();
        }
        assertTrue(Files.exists(directory.resolve("tasks.mv.db")));
        try (ConfigurableApplicationContext second = open(url)) {
            Task restored = second.getBean(TaskRepository.class).findById(id).get();
            assertEquals("Persistent", restored.getTitle());
            assertTrue(restored.isCompleted());
        }
        Files.deleteIfExists(directory.resolve("tasks.mv.db"));
        Files.deleteIfExists(directory.resolve("tasks.trace.db"));
        Files.delete(directory);
    }
}
