package com.acme.orders.sys.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 用户新建请求：用户名、角色编码必填，显示名可选。 */
public class SysUserRequest {
    @NotBlank
    @Size(max = 64)
    private String username;

    @Size(max = 128)
    private String displayName;

    @NotBlank
    @Size(max = 64)
    private String roleCode;

    @NotNull private Boolean enabled;

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getRoleCode() {
        return roleCode;
    }

    public void setRoleCode(String roleCode) {
        this.roleCode = roleCode;
    }

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
    }
}
