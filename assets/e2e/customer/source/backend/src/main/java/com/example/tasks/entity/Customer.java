package com.example.tasks.entity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;

@Entity
@Table(name = "customers")
public class Customer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, unique = true, length = 200)
    private String email;

    @Column(length = 200)
    private String company;

    @Column(nullable = false, length = 16)
    private String status;

    @Column(length = 500)
    private String notes;

    protected Customer() {}

    public Customer(String name, String email, String company, String status, String notes) {
        update(name, email, company, status, notes);
    }

    public void update(String name, String email, String company, String status, String notes) {
        this.name = name;
        this.email = email;
        this.company = company;
        this.status = status;
        this.notes = notes;
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
