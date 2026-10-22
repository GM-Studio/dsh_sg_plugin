package com.example.tasks.sys.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.sys.service.SysDashboardService;
import com.example.tasks.sys.vo.SysDashboardVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 仪表盘统计接口：查询走 GET，路径固定为 /api/sys/dashboard。 */
@RestController
@RequestMapping("/api/sys/dashboard")
public class SysDashboardController {
    private final SysDashboardService service;

    public SysDashboardController(SysDashboardService service) {
        this.service = service;
    }

    /** 返回仪表盘汇总统计，只读且无副作用。 */
    @GetMapping
    public ApiResponse<SysDashboardVO> summary() {
        return ApiResponse.success(service.summary());
    }
}
