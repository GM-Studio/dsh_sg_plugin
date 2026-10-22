package com.example.tasks.sys.vo;

/** 仪表盘统计视图对象：对外暴露的稳定只读结构。 */
public final class SysDashboardVO {
    private final long userCount;
    private final long roleCount;
    private final long taskCount;
    private final long completedTaskCount;

    /** 汇总统计构造方法：入参均为统计完成的非负数量。 */
    public SysDashboardVO(long userCount, long roleCount, long taskCount, long completedTaskCount) {
        this.userCount = userCount;
        this.roleCount = roleCount;
        this.taskCount = taskCount;
        this.completedTaskCount = completedTaskCount;
    }

    public long getUserCount() {
        return userCount;
    }

    public long getRoleCount() {
        return roleCount;
    }

    public long getTaskCount() {
        return taskCount;
    }

    public long getCompletedTaskCount() {
        return completedTaskCount;
    }
}
