package com.example.tasks.dto;

import javax.validation.constraints.Min;
import javax.validation.constraints.NotNull;

public class UpdateCustomerRequest extends CustomerRequest {
    @NotNull
    @Min(1)
    private Long id;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }
}
