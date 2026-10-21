package com.example.tasks.vo;

import java.util.List;

public final class PageResult<T> {
    private final List<T> records;
    private final long total;
    private final int page;
    private final int pageSize;

    public PageResult(List<T> records, long total, int page, int pageSize) {
        this.records = records;
        this.total = total;
        this.page = page;
        this.pageSize = pageSize;
    }

    public List<T> getRecords() {
        return records;
    }

    public long getTotal() {
        return total;
    }

    public int getPage() {
        return page;
    }

    public int getPageSize() {
        return pageSize;
    }
}
