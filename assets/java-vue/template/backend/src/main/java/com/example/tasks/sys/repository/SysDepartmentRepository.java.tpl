package com.example.tasks.sys.repository;

import com.example.tasks.sys.entity.SysDepartment;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** 部门仓储：提供分页/条件查询（Specification）以及按编码的唯一性校验。 */
public interface SysDepartmentRepository
        extends JpaRepository<SysDepartment, Long>,
                org.springframework.data.jpa.repository.JpaSpecificationExecutor<SysDepartment> {
    /** 按部门编码精确查询，用于创建与更新时的唯一性校验。 */
    Optional<SysDepartment> findByCode(String code);
}
