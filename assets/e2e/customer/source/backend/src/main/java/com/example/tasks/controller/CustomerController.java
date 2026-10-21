package com.example.tasks.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.dto.CustomerRequest;
import com.example.tasks.dto.IdRequest;
import com.example.tasks.dto.UpdateCustomerRequest;
import com.example.tasks.service.CustomerService;
import com.example.tasks.vo.CustomerSummaryVO;
import com.example.tasks.vo.CustomerVO;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import java.net.URI;
import javax.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/customers")
public class CustomerController {
    private final CustomerService service;

    public CustomerController(CustomerService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<PageResult<CustomerVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String status) {
        return ApiResponse.success(service.list(page, pageSize, query, status));
    }

    @GetMapping("/summary")
    public ApiResponse<CustomerSummaryVO> summary() {
        return ApiResponse.success(service.summary());
    }

    @GetMapping("/{id}")
    public ApiResponse<CustomerVO> get(@PathVariable Long id) {
        return ApiResponse.success(service.get(id));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<CustomerVO>> create(
            @Valid @RequestBody CustomerRequest request) {
        CustomerVO customer = service.create(request);
        return ResponseEntity.created(URI.create("/api/customers/" + customer.getId()))
                .body(ApiResponse.success(customer));
    }

    @PostMapping("/update")
    public ApiResponse<CustomerVO> update(@Valid @RequestBody UpdateCustomerRequest request) {
        return ApiResponse.success(service.update(request.getId(), request));
    }

    @PostMapping("/delete")
    public ApiResponse<OperationResult> delete(@Valid @RequestBody IdRequest request) {
        return ApiResponse.success(service.delete(request.getId()));
    }
}
