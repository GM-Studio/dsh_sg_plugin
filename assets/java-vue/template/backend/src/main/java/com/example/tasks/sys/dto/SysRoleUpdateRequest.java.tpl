package com.acme.orders.sys.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/** 角色更新请求：沿用新建请求的字段校验，额外要求正整数主键 id。 */
public class SysRoleUpdateRequest extends SysRoleRequest {
    @NotNull
    @Min(1)
    private Long id;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }
}
