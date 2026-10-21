package com.example.tasks.vo;

import com.example.tasks.entity.Customer;

public final class CustomerVO {
    private final Long id;
    private final String name;
    private final String email;
    private final String company;
    private final String status;
    private final String notes;

    public CustomerVO(Customer customer) {
        this.id = customer.getId();
        this.name = customer.getName();
        this.email = customer.getEmail();
        this.company = customer.getCompany();
        this.status = customer.getStatus();
        this.notes = customer.getNotes();
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getEmail() {
        return email;
    }

    public String getCompany() {
        return company;
    }

    public String getStatus() {
        return status;
    }

    public String getNotes() {
        return notes;
    }
}
