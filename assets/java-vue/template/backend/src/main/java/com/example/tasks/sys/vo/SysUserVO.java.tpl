package com.acme.orders.sys.vo;

import com.acme.orders.sys.entity.SysUser;

/** 用户视图对象：对外暴露的稳定只读结构。 */
public final class SysUserVO {
    private final Long id;
    private final String username;
    private final String displayName;
    private final String roleCode;
    private final boolean enabled;

    public SysUserVO(SysUser user) {
        this.id = user.getId();
        this.username = user.getUsername();
        this.displayName = user.getDisplayName();
        this.roleCode = user.getRoleCode();
        this.enabled = user.isEnabled();
    }

    public Long getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getRoleCode() {
        return roleCode;
    }

    public boolean isEnabled() {
        return enabled;
    }
}
