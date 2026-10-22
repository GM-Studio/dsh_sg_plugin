package com.example.tasks.sys.repository;

import com.example.tasks.sys.entity.SysRole;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** 角色仓储：提供分页/条件查询（Specification）以及按编码的唯一性校验。 */
public interface SysRoleRepository
        extends JpaRepository<SysRole, Long>,
                org.springframework.data.jpa.repository.JpaSpecificationExecutor<SysRole> {
    /** 按角色编码精确查询，用于创建与更新时的唯一性校验。 */
    Optional<SysRole> findByCode(String code);
}
