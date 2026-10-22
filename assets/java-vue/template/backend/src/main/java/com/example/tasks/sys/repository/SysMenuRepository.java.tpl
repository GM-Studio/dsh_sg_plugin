package com.example.tasks.sys.repository;

import com.example.tasks.sys.entity.SysMenu;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** 菜单仓储：提供分页/条件查询（Specification）以及按编码的唯一性校验。 */
public interface SysMenuRepository
        extends JpaRepository<SysMenu, Long>,
                org.springframework.data.jpa.repository.JpaSpecificationExecutor<SysMenu> {
    /** 按菜单编码精确查询，用于创建与更新时的唯一性校验。 */
    Optional<SysMenu> findByCode(String code);
}
