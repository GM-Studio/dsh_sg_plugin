package com.example.tasks.sys.vo;

/** 仪表盘统计视图对象：对外暴露的稳定只读结构。 */
public final class SysDashboardVO {
    private final long userCount;
    private final long roleCount;
    private final long departmentCount;
    private final long menuCount;
    private final long auditCount;

    /** 汇总统计构造方法：入参均为统计完成的非负数量。 */
    public SysDashboardVO(
            long userCount, long roleCount, long departmentCount, long menuCount, long auditCount) {
        this.userCount = userCount;
        this.roleCount = roleCount;
        this.departmentCount = departmentCount;
        this.menuCount = menuCount;
        this.auditCount = auditCount;
    }

    public long getUserCount() {
        return userCount;
    }

    public long getRoleCount() {
        return roleCount;
    }

    public long getDepartmentCount() {
        return departmentCount;
    }

    public long getMenuCount() {
        return menuCount;
    }

    public long getAuditCount() {
        return auditCount;
    }
}
