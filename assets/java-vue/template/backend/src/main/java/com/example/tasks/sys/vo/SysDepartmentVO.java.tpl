package com.example.tasks.sys.vo;

import com.example.tasks.sys.entity.SysDepartment;

/** 部门视图对象：对外暴露的稳定只读结构。 */
public final class SysDepartmentVO {
    private final Long id;
    private final String code;
    private final String name;
    private final String parentCode;
    private final boolean enabled;

    public SysDepartmentVO(SysDepartment department) {
        this.id = department.getId();
        this.code = department.getCode();
        this.name = department.getName();
        this.parentCode = department.getParentCode();
        this.enabled = department.isEnabled();
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

    public String getParentCode() {
        return parentCode;
    }

    public boolean isEnabled() {
        return enabled;
    }
}
