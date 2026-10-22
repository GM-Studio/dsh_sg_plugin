package com.example.tasks.sys.vo;

import com.example.tasks.sys.entity.SysMenu;

/** 菜单视图对象：对外暴露的稳定只读结构。 */
public final class SysMenuVO {
    private final Long id;
    private final String code;
    private final String name;
    private final String path;
    private final String icon;
    private final int sortOrder;
    private final boolean enabled;

    public SysMenuVO(SysMenu menu) {
        this.id = menu.getId();
        this.code = menu.getCode();
        this.name = menu.getName();
        this.path = menu.getPath();
        this.icon = menu.getIcon();
        this.sortOrder = menu.getSortOrder();
        this.enabled = menu.isEnabled();
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
}
