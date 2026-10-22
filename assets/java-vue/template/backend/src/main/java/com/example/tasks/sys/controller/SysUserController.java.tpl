package com.example.tasks.sys.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.dto.BatchRequest;
import com.example.tasks.dto.IdRequest;
import com.example.tasks.sys.dto.SysUserRequest;
import com.example.tasks.sys.dto.SysUserUpdateRequest;
import com.example.tasks.sys.service.SysUserCsvService;
import com.example.tasks.sys.service.SysUserService;
import com.example.tasks.sys.vo.SysUserVO;
import com.example.tasks.vo.ImportResult;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import javax.validation.Valid;
import java.net.URI;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** 用户管理接口：查询走 GET，变更走 POST JSON，路径固定为 /api/sys/users。 */
@RestController
@RequestMapping("/api/sys/users")
public class SysUserController {
    private final SysUserService service;
    private final SysUserCsvService csv;

    public SysUserController(SysUserService service, SysUserCsvService csv) {
        this.service = service;
        this.csv = csv;
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

    /** 校验上传的 CSV，仅返回逐行错误，不写入任何数据。 */
    @PostMapping(value = "/import/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportResult> validateImport(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(csv.ingest(file, false));
    }

    /** 导入 CSV：全部行校验通过才落库，任一行失败则整体回滚。 */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportResult> importUsers(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(csv.ingest(file, true));
    }

    /** 下载导入模板（text/csv 附件）。 */
    @GetMapping("/import/template")
    public ResponseEntity<byte[]> template() {
        return download(csv.template(), "sys-user-template.csv");
    }

    /** 按 username/roleCode/enabled 过滤导出用户（text/csv 附件）。 */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export(
            @RequestParam(required = false) String username,
            @RequestParam(required = false) String roleCode,
            @RequestParam(required = false) Boolean enabled) {
        return download(csv.export(username, roleCode, enabled), "sys-users.csv");
    }

    /** 统一按 text/csv 附件返回下载内容。 */
    private ResponseEntity<byte[]> download(byte[] bytes, String filename) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + filename + "\"")
                .body(bytes);
    }
}
