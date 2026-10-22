package com.acme.orders.sys.controller;

import com.acme.orders.common.ApiResponse;
import com.acme.orders.dto.IdRequest;
import com.acme.orders.sys.dto.SysRoleRequest;
import com.acme.orders.sys.dto.SysRoleUpdateRequest;
import com.acme.orders.sys.service.SysRoleService;
import com.acme.orders.sys.vo.SysOptionVO;
import com.acme.orders.sys.vo.SysRoleVO;
import com.acme.orders.vo.OperationResult;
import com.acme.orders.vo.PageResult;
import jakarta.validation.Valid;
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

/** 角色管理接口：查询走 GET，变更走 POST JSON，路径固定为 /api/sys/roles。 */
@RestController
@RequestMapping("/api/sys/roles")
public class SysRoleController {
    private final SysRoleService service;

    public SysRoleController(SysRoleService service) {
        this.service = service;
    }

    /** 分页查询角色，支持 code/name 模糊过滤。 */
    @GetMapping
    public ApiResponse<PageResult<SysRoleVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String name) {
        return ApiResponse.success(service.list(page, pageSize, code, name));
    }

    /** 角色下拉选项，供用户表单选择角色编码。 */
    @GetMapping("/options")
    public ApiResponse<List<SysOptionVO>> options() {
        return ApiResponse.success(service.options());
    }

    @GetMapping("/{id}")
    public ApiResponse<SysRoleVO> get(@PathVariable Long id) {
        return ApiResponse.success(service.get(id));
    }

    /** 新建角色，成功返回 201 与 Location 头，便于前端直接跳转详情。 */
    @PostMapping
    public ResponseEntity<ApiResponse<SysRoleVO>> create(
            @Valid @RequestBody SysRoleRequest request) {
        SysRoleVO role = service.create(request);
        return ResponseEntity.created(URI.create("/api/sys/roles/" + role.getId()))
                .body(ApiResponse.success(role));
    }

    @PostMapping("/update")
    public ApiResponse<SysRoleVO> update(@Valid @RequestBody SysRoleUpdateRequest request) {
        return ApiResponse.success(service.update(request.getId(), request));
    }

    @PostMapping("/delete")
    public ApiResponse<OperationResult> delete(@Valid @RequestBody IdRequest request) {
        return ApiResponse.success(service.delete(request.getId()));
    }
}
