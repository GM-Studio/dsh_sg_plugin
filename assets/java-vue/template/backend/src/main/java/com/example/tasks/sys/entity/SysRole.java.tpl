package com.example.tasks.sys.entity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;

/** 系统角色实体：角色编码唯一，是用户权限绑定的稳定标识（系统管理模块）。 */
@Entity
@Table(name = "sys_roles")
public class SysRole {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 255)
    private String description;

    @Column(nullable = false)
    private boolean enabled;

    /** JPA 使用的受保护无参构造方法。 */
    protected SysRole() {}

    /** 新建角色时使用的完整构造方法。 */
    public SysRole(String code, String name, String description, boolean enabled) {
        this.code = code;
        this.name = name;
        this.description = description;
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

    public String getDescription() {
        return description;
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** 就地更新可变字段，主键保持不变，便于受管实体直接落库。 */
    public void update(String code, String name, String description, boolean enabled) {
        this.code = code;
        this.name = name;
        this.description = description;
        this.enabled = enabled;
    }
}
