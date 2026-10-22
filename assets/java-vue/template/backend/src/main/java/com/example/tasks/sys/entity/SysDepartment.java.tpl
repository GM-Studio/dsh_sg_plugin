package com.example.tasks.sys.entity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;

/** 系统部门实体：部门编码唯一，parentCode 自关联上级部门形成层级（系统管理模块）。 */
@Entity
@Table(name = "sys_departments")
public class SysDepartment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 64)
    private String parentCode;

    @Column(nullable = false)
    private boolean enabled;

    /** JPA 使用的受保护无参构造方法。 */
    protected SysDepartment() {}

    /** 新建部门时使用的完整构造方法。 */
    public SysDepartment(String code, String name, String parentCode, boolean enabled) {
        this.code = code;
        this.name = name;
        this.parentCode = parentCode;
        this.enabled = enabled;
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

    /** 就地更新可变字段，主键保持不变，便于受管实体直接落库。 */
    public void update(String code, String name, String parentCode, boolean enabled) {
        this.code = code;
        this.name = name;
        this.parentCode = parentCode;
        this.enabled = enabled;
    }
}
