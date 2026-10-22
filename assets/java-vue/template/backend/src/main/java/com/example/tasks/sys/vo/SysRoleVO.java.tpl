package com.example.tasks.sys.vo;

import com.example.tasks.sys.entity.SysRole;

/** 角色视图对象：对外暴露的稳定只读结构。 */
public final class SysRoleVO {
    private final Long id;
    private final String code;
    private final String name;
    private final String description;
    private final boolean enabled;

    public SysRoleVO(SysRole role) {
        this.id = role.getId();
        this.code = role.getCode();
        this.name = role.getName();
        this.description = role.getDescription();
        this.enabled = role.isEnabled();
    }

    public Long getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public boolean isEnabled() {
        return enabled;
    }
}
