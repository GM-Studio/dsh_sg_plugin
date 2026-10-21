package com.example.tasks.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.dto.CustomerRequest;
import com.example.tasks.entity.Customer;
import com.example.tasks.repository.CustomerRepository;
import com.example.tasks.vo.CustomerSummaryVO;
import com.example.tasks.vo.CustomerVO;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import javax.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class CustomerService {
    private final CustomerRepository repository;

    public CustomerService(CustomerRepository repository) {
        this.repository = repository;
    }

    public PageResult<CustomerVO> list(int page, int pageSize, String query, String status) {
        if (page < 1 || pageSize < 1 || pageSize > 100) {
            throw new BusinessException(400, "PAGE", "Invalid page or pageSize");
        }
        String normalizedStatus = normalizeStatus(status, false);
        Page<Customer> result =
                repository.findAll(
                        filter(query, normalizedStatus),
                        PageRequest.of(page - 1, pageSize, Sort.by("id").ascending()));
        List<CustomerVO> records =
                result.getContent().stream().map(CustomerVO::new).collect(Collectors.toList());
        return new PageResult<>(records, result.getTotalElements(), page, pageSize);
    }

    private Specification<Customer> filter(String query, String status) {
        return (root, ignored, builder) -> {
            java.util.ArrayList<Predicate> predicates = new java.util.ArrayList<>();
            if (query != null && !query.trim().isEmpty()) {
                String escaped =
                        query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                String value = "%" + escaped.toLowerCase(Locale.ROOT) + "%";
                predicates.add(
                        builder.or(
                                builder.like(builder.lower(root.get("name")), value, '\\'),
                                builder.like(builder.lower(root.get("email")), value, '\\'),
                                builder.like(builder.lower(root.get("company")), value, '\\')));
            }
            if (status != null) predicates.add(builder.equal(root.get("status"), status));
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    public CustomerVO get(Long id) {
        return new CustomerVO(find(id));
    }

    public CustomerSummaryVO summary() {
        long active = repository.countByStatus("ACTIVE");
        long inactive = repository.countByStatus("INACTIVE");
        return new CustomerSummaryVO(active, inactive);
    }

    @Transactional
    public CustomerVO create(CustomerRequest request) {
        String email = normalizedEmail(request.getEmail());
        if (repository.existsByEmailIgnoreCase(email)) {
            throw new BusinessException(400, "DUPLICATE_EMAIL", "Email already exists");
        }
        Customer customer =
                new Customer(
                        request.getName().trim(),
                        email,
                        trim(request.getCompany()),
                        normalizeStatus(request.getStatus(), true),
                        trim(request.getNotes()));
        return new CustomerVO(repository.save(customer));
    }

    @Transactional
    public CustomerVO update(Long id, CustomerRequest request) {
        Customer customer = find(id);
        String email = normalizedEmail(request.getEmail());
        if (repository.existsByEmailIgnoreCaseAndIdNot(email, id)) {
            throw new BusinessException(400, "DUPLICATE_EMAIL", "Email already exists");
        }
        customer.update(
                request.getName().trim(),
                email,
                trim(request.getCompany()),
                normalizeStatus(request.getStatus(), true),
                trim(request.getNotes()));
        return new CustomerVO(repository.save(customer));
    }

    @Transactional
    public OperationResult delete(Long id) {
        repository.delete(find(id));
        return new OperationResult(id, true, 1);
    }

    private Customer find(Long id) {
        if (id == null || id < 1) throw new BusinessException(400, "ID", "id must be positive");
        return repository
                .findById(id)
                .orElseThrow(
                        () ->
                                new BusinessException(
                                        404, "CUSTOMER_NOT_FOUND", "Customer not found"));
    }

    private static String normalizedEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static String normalizeStatus(String value, boolean required) {
        if (value == null || value.trim().isEmpty()) {
            if (required) throw new BusinessException(400, "STATUS", "status is required");
            return null;
        }
        String status = value.trim().toUpperCase(Locale.ROOT);
        if (!("ACTIVE".equals(status) || "INACTIVE".equals(status))) {
            throw new BusinessException(400, "STATUS", "status must be ACTIVE or INACTIVE");
        }
        return status;
    }
}
