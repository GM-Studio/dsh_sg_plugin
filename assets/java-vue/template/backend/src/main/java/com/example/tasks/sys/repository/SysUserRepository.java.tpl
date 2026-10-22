package com.example.tasks.sys.repository;

import com.example.tasks.sys.entity.SysUser;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** 用户仓储：提供分页/条件查询（Specification）以及按用户名的唯一性校验。 */
public interface SysUserRepository
        extends JpaRepository<SysUser, Long>,
                org.springframework.data.jpa.repository.JpaSpecificationExecutor<SysUser> {
    /** 按用户名精确查询，用于创建与更新时的唯一性校验。 */
    Optional<SysUser> findByUsername(String username);
}
