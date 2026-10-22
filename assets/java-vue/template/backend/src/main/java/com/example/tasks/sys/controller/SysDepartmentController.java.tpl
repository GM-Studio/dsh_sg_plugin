package com.example.tasks.sys.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.dto.IdRequest;
import com.example.tasks.sys.dto.SysDepartmentRequest;
import com.example.tasks.sys.dto.SysDepartmentUpdateRequest;
import com.example.tasks.sys.service.SysDepartmentService;
import com.example.tasks.sys.vo.SysDepartmentVO;
import com.example.tasks.sys.vo.SysOptionVO;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import javax.validation.Valid;
import java.net.URI;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 部门管理接口：查询走 GET，变更走 POST JSON，路径固定为 /api/sys/departments。 */
@RestController
@RequestMapping("/api/sys/departments")
public class SysDepartmentController {
    private final SysDepartmentService service;

    public SysDepartmentController(SysDepartmentService service) {
        this.service = service;
    }

    /** 分页查询部门，支持 code/name 模糊过滤。 */
    @GetMapping
    public ApiResponse<PageResult<SysDepartmentVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String name) {
        return ApiResponse.success(service.list(page, pageSize, code, name));
    }

    /** 部门下拉选项，供用户表单选择部门编码。 */
    @GetMapping("/options")
    public ApiResponse<List<SysOptionVO>> options() {
        return ApiResponse.success(service.options());
    }

    @GetMapping("/{id}")
    public ApiResponse<SysDepartmentVO> get(@PathVariable Long id) {
        return ApiResponse.success(service.get(id));
    }

    /** 新建部门，成功返回 201 与 Location 头，便于前端直接跳转详情。 */
    @PostMapping
    public ResponseEntity<ApiResponse<SysDepartmentVO>> create(
            @Valid @RequestBody SysDepartmentRequest request) {
        SysDepartmentVO department = service.create(request);
        return ResponseEntity.created(URI.create("/api/sys/departments/" + department.getId()))
                .body(ApiResponse.success(department));
    }

    @PostMapping("/update")
    public ApiResponse<SysDepartmentVO> update(
            @Valid @RequestBody SysDepartmentUpdateRequest request) {
        return ApiResponse.success(service.update(request.getId(), request));
    }

    @PostMapping("/delete")
    public ApiResponse<OperationResult> delete(@Valid @RequestBody IdRequest request) {
        return ApiResponse.success(service.delete(request.getId()));
    }
}
