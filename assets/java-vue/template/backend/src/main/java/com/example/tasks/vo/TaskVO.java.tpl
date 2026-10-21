package com.example.tasks.vo;

import com.example.tasks.entity.Task;

public final class TaskVO {
    private final Long id;
    private final String title;
    private final boolean completed;

    public TaskVO(Task task) {
        this.id = task.getId();
        this.title = task.getTitle();
        this.completed = task.isCompleted();
    }

    public Long getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public boolean isCompleted() {
        return completed;
    }
}
