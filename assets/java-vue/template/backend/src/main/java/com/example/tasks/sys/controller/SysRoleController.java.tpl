package com.example.tasks.sys.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.dto.IdRequest;
import com.example.tasks.sys.dto.SysRoleRequest;
import com.example.tasks.sys.dto.SysRoleUpdateRequest;
import com.example.tasks.sys.service.SysRoleCsvService;
import com.example.tasks.sys.service.SysRoleService;
import com.example.tasks.sys.vo.SysOptionVO;
import com.example.tasks.sys.vo.SysRoleVO;
import com.example.tasks.vo.ImportResult;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import javax.validation.Valid;
import java.net.URI;
import java.util.List;
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

/** 角色管理接口：查询走 GET，变更走 POST JSON，路径固定为 /api/sys/roles。 */
@RestController
@RequestMapping("/api/sys/roles")
public class SysRoleController {
    private final SysRoleService service;
    private final SysRoleCsvService csv;

    public SysRoleController(SysRoleService service, SysRoleCsvService csv) {
        this.service = service;
        this.csv = csv;
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

    /** 校验上传的 CSV，仅返回逐行错误，不写入任何数据。 */
    @PostMapping(value = "/import/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportResult> validateImport(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(csv.ingest(file, false));
    }

    /** 导入 CSV：全部行校验通过才落库，任一行失败则整体回滚。 */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<ImportResult> importRoles(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(csv.ingest(file, true));
    }

    /** 下载导入模板（text/csv 附件）。 */
    @GetMapping("/import/template")
    public ResponseEntity<byte[]> template() {
        return download(csv.template(), "sys-role-template.csv");
    }

    /** 按 code/name 过滤导出角色（text/csv 附件）。 */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String name) {
        return download(csv.export(code, name), "sys-roles.csv");
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
