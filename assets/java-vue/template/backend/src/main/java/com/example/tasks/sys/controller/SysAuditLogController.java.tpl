package com.example.tasks.sys.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.sys.service.SysAuditLogService;
import com.example.tasks.sys.vo.SysAuditLogVO;
import com.example.tasks.vo.PageResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 审计日志接口：只读查询，仅暴露 GET /api/sys/audits，不提供任何变更端点。 */
@RestController
@RequestMapping("/api/sys/audits")
public class SysAuditLogController {
    private final SysAuditLogService service;

    public SysAuditLogController(SysAuditLogService service) {
        this.service = service;
    }

    /** 分页查询审计日志，支持 actor/action 模糊过滤，按 id 倒序返回最新记录。 */
    @GetMapping
    public ApiResponse<PageResult<SysAuditLogVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String action) {
        return ApiResponse.success(service.list(page, pageSize, actor, action));
    }
}
