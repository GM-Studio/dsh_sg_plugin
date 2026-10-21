package com.example.tasks.vo;

public final class CustomerSummaryVO {
    private final long total;
    private final long active;
    private final long inactive;

    public CustomerSummaryVO(long active, long inactive) {
        this.total = active + inactive;
        this.active = active;
        this.inactive = inactive;
    }

    public long getTotal() {
        return total;
    }

    public long getActive() {
        return active;
    }

    public long getInactive() {
        return inactive;
    }
}
