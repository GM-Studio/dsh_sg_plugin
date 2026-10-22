package com.example.tasks.sys.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.dto.BatchRequest;
import com.example.tasks.dto.IdRequest;
import com.example.tasks.sys.dto.SysUserRequest;
import com.example.tasks.sys.dto.SysUserUpdateRequest;
import com.example.tasks.sys.service.SysUserService;
import com.example.tasks.sys.vo.SysUserVO;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import javax.validation.Valid;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 用户管理接口：查询走 GET，变更走 POST JSON，路径固定为 /api/sys/users。 */
@RestController
@RequestMapping("/api/sys/users")
public class SysUserController {
    private final SysUserService service;

    public SysUserController(SysUserService service) {
        this.service = service;
    }

    /** 分页查询用户，支持 username 模糊过滤与 roleCode/enabled 精确过滤。 */
    @GetMapping
    public ApiResponse<PageResult<SysUserVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String username,
            @RequestParam(required = false) String roleCode,
            @RequestParam(required = false) Boolean enabled) {
        return ApiResponse.success(service.list(page, pageSize, username, roleCode, enabled));
    }

    @GetMapping("/{id}")
    public ApiResponse<SysUserVO> get(@PathVariable Long id) {
        return ApiResponse.success(service.get(id));
    }

    /** 新建用户，成功返回 201 与 Location 头，便于前端直接跳转详情。 */
    @PostMapping
    public ResponseEntity<ApiResponse<SysUserVO>> create(
            @Valid @RequestBody SysUserRequest request) {
        SysUserVO user = service.create(request);
        return ResponseEntity.created(URI.create("/api/sys/users/" + user.getId()))
                .body(ApiResponse.success(user));
    }

    @PostMapping("/update")
    public ApiResponse<SysUserVO> update(@Valid @RequestBody SysUserUpdateRequest request) {
        return ApiResponse.success(service.update(request.getId(), request));
    }

    @PostMapping("/delete")
    public ApiResponse<OperationResult> delete(@Valid @RequestBody IdRequest request) {
        return ApiResponse.success(service.delete(request.getId()));
    }

    @PostMapping("/batch-delete")
    public ApiResponse<OperationResult> batchDelete(@Valid @RequestBody BatchRequest request) {
        return ApiResponse.success(service.batchDelete(request));
    }
}
