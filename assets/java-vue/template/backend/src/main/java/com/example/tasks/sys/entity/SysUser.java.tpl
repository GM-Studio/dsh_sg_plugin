package com.acme.orders.sys.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 系统用户实体：用户名唯一，通过角色编码关联角色（系统管理模块）。 */
@Entity
@Table(name = "sys_users")
public class SysUser {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String username;

    @Column(length = 128)
    private String displayName;

    @Column(nullable = false, length = 64)
    private String roleCode;

    @Column(nullable = false)
    private boolean enabled;

    /** JPA 使用的受保护无参构造方法。 */
    protected SysUser() {}

    /** 新建用户时使用的完整构造方法。 */
    public SysUser(String username, String displayName, String roleCode, boolean enabled) {
        this.username = username;
        this.displayName = displayName;
        this.roleCode = roleCode;
        this.enabled = enabled;
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

    /** 就地更新可变字段，主键保持不变，便于受管实体直接落库。 */
    public void update(String username, String displayName, String roleCode, boolean enabled) {
        this.username = username;
        this.displayName = displayName;
        this.roleCode = roleCode;
        this.enabled = enabled;
    }
}
