package com.example.tasks.sys.service;

import com.example.tasks.entity.Task;
import com.example.tasks.repository.TaskRepository;
import com.example.tasks.sys.repository.SysRoleRepository;
import com.example.tasks.sys.repository.SysUserRepository;
import com.example.tasks.sys.vo.SysDashboardVO;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 仪表盘统计服务：只读汇总用户、角色与任务数量。 */
@Service
@Transactional(readOnly = true)
public class SysDashboardService {
    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final TaskRepository taskRepository;

    public SysDashboardService(
            SysUserRepository userRepository,
            SysRoleRepository roleRepository,
            TaskRepository taskRepository) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.taskRepository = taskRepository;
    }

    /** 汇总仪表盘统计：用户/角色总数，以及任务总数与已完成任务数。 */
    public SysDashboardVO summary() {
        long taskCount = taskRepository.count();
        long completedTaskCount = taskRepository.findAll(completed()).size();
        return new SysDashboardVO(
                userRepository.count(), roleRepository.count(), taskCount, completedTaskCount);
    }

    /** 已完成任务的过滤条件：把筛选下推到数据库，避免逐条在内存中判断。 */
    private static Specification<Task> completed() {
        return (root, query, builder) -> builder.isTrue(root.get("completed"));
    }
}
