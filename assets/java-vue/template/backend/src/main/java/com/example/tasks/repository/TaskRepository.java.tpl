package com.example.tasks.repository;

import com.example.tasks.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskRepository
        extends JpaRepository<Task, Long>,
                org.springframework.data.jpa.repository.JpaSpecificationExecutor<Task> {}
