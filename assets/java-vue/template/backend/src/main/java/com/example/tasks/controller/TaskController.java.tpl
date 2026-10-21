package com.example.tasks.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.dto.BatchRequest;
import com.example.tasks.dto.IdRequest;
import com.example.tasks.dto.TaskRequest;
import com.example.tasks.dto.UpdateTaskRequest;
import com.example.tasks.service.TaskService;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import com.example.tasks.vo.TaskVO;
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
@RequestMapping("/api/tasks")
public class TaskController {
    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<PageResult<TaskVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) Boolean completed,
            @RequestParam(defaultValue = "id") String sortBy,
            @RequestParam(defaultValue = "asc") String sortOrder) {
        return ApiResponse.success(
                service.list(page, pageSize, title, completed, sortBy, sortOrder));
    }

    @GetMapping("/{id}")
    public ApiResponse<TaskVO> get(@PathVariable Long id) {
        return ApiResponse.success(service.get(id));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<TaskVO>> create(@Valid @RequestBody TaskRequest request) {
        TaskVO task = service.create(request);
        return ResponseEntity.created(URI.create("/api/tasks/" + task.getId()))
                .body(ApiResponse.success(task));
    }

    @PostMapping("/update")
    public ApiResponse<TaskVO> update(@Valid @RequestBody UpdateTaskRequest request) {
        return ApiResponse.success(service.update(request.getId(), request));
    }

    @PostMapping("/delete")
    public ApiResponse<OperationResult> delete(@Valid @RequestBody IdRequest request) {
        return ApiResponse.success(service.delete(request.getId()));
    }

    @PostMapping("/batch-delete")
    public ApiResponse<OperationResult> batchDelete(@Valid @RequestBody BatchRequest request) {
        return ApiResponse.success(service.batch(request, true));
    }

    @PostMapping("/batch-update-status")
    public ApiResponse<OperationResult> batchUpdate(@Valid @RequestBody BatchRequest request) {
        return ApiResponse.success(service.batch(request, false));
    }
}
