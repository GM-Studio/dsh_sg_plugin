package com.example.tasks.dto;

import java.util.List;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;

public class BatchRequest {
    @NotNull
    @Size(min = 1, max = 100)
    private List<Long> ids;

    private Boolean completed;

    public List<Long> getIds() {
        return ids;
    }

    public void setIds(List<Long> ids) {
        this.ids = ids;
    }

    public Boolean getCompleted() {
        return completed;
    }

    public void setCompleted(Boolean completed) {
        this.completed = completed;
    }
}
