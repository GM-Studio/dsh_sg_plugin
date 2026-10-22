package com.example.tasks.sys.entity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;

/** 系统菜单实体：菜单编码唯一，是前端菜单与路由绑定的稳定标识（系统管理模块）。 */
@Entity
@Table(name = "sys_menus")
public class SysMenu {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String code;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 128)
    private String path;

    @Column(length = 64)
    private String icon;

    @Column(nullable = false)
    private int sortOrder;

    @Column(nullable = false)
    private boolean enabled;

    /** JPA 使用的受保护无参构造方法。 */
    protected SysMenu() {}

    /** 新建菜单时使用的完整构造方法。 */
    public SysMenu(
            String code, String name, String path, String icon, int sortOrder, boolean enabled) {
        this.code = code;
        this.name = name;
        this.path = path;
        this.icon = icon;
        this.sortOrder = sortOrder;
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

    public String getPath() {
        return path;
    }

    public String getIcon() {
        return icon;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** 就地更新可变字段，主键保持不变，便于受管实体直接落库。 */
    public void update(
            String code, String name, String path, String icon, int sortOrder, boolean enabled) {
        this.code = code;
        this.name = name;
        this.path = path;
        this.icon = icon;
        this.sortOrder = sortOrder;
        this.enabled = enabled;
    }
}
