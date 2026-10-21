package com.example.tasks.vo;

import java.util.List;

public final class ImportResult {
    private final int count;
    private final List<String> errors;

    public ImportResult(int count, List<String> errors) {
        this.count = count;
        this.errors = errors;
    }

    public int getCount() {
        return count;
    }

    public List<String> getErrors() {
        return errors;
    }

    public boolean isValid() {
        return errors.isEmpty();
    }
}
