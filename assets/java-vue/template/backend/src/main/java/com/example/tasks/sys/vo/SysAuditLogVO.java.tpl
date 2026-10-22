package com.example.tasks.sys.vo;

import com.example.tasks.sys.entity.SysAuditLog;

/** 审计日志视图对象：对外暴露的只读结构，createdAt 以原始文本透出。 */
public final class SysAuditLogVO {
    private final Long id;
    private final String actor;
    private final String action;
    private final String target;
    private final String detail;
    private final String createdAt;

    public SysAuditLogVO(SysAuditLog auditLog) {
        this.id = auditLog.getId();
        this.actor = auditLog.getActor();
        this.action = auditLog.getAction();
        this.target = auditLog.getTarget();
        this.detail = auditLog.getDetail();
        this.createdAt = auditLog.getCreatedAt();
    }

    public Long getId() {
        return id;
    }

    public String getActor() {
        return actor;
    }

    public String getAction() {
        return action;
    }

    public String getTarget() {
        return target;
    }

    public String getDetail() {
        return detail;
    }

    public String getCreatedAt() {
        return createdAt;
    }
}
