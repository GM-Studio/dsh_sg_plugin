package com.example.tasks.sys.repository;

import com.example.tasks.sys.entity.SysAuditLog;
import org.springframework.data.jpa.repository.JpaRepository;

/** 审计日志仓储：提供条件查询（Specification）与追加写入，不提供修改/删除入口。 */
public interface SysAuditLogRepository
        extends JpaRepository<SysAuditLog, Long>,
                org.springframework.data.jpa.repository.JpaSpecificationExecutor<SysAuditLog> {}
