package com.example.tasks.sys.entity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;

/** 审计日志实体：只追加不修改，时间戳以字符串保存，避免 JPA/Jackson 的时间映射差异（系统管理模块）。 */
@Entity
@Table(name = "sys_audit_logs")
public class SysAuditLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String actor;

    @Column(nullable = false, length = 64)
    private String action;

    @Column(length = 128)
    private String target;

    @Column(length = 512)
    private String detail;

    /** ISO-8601 文本时间戳，落库为字符串，读取时原样返回。 */
    @Column(nullable = false, length = 32)
    private String createdAt;

    /** JPA 使用的受保护无参构造方法。 */
    protected SysAuditLog() {}

    /** 追写审计日志时使用的完整构造方法。 */
    public SysAuditLog(
            String actor, String action, String target, String detail, String createdAt) {
        this.actor = actor;
        this.action = action;
        this.target = target;
        this.detail = detail;
        this.createdAt = createdAt;
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
