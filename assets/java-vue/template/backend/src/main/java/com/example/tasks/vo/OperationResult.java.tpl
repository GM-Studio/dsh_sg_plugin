package com.example.tasks.vo;

public final class OperationResult {
    private final Long id;
    private final boolean deleted;
    private final int count;

    public OperationResult(Long id, boolean deleted, int count) {
        this.id = id;
        this.deleted = deleted;
        this.count = count;
    }

    public Long getId() {
        return id;
    }

    public boolean isDeleted() {
        return deleted;
    }

    public int getCount() {
        return count;
    }
}
