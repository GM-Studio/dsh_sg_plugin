package com.example.tasks.sys.service;

import com.example.tasks.sys.repository.SysAuditLogRepository;
import com.example.tasks.sys.repository.SysDepartmentRepository;
import com.example.tasks.sys.repository.SysMenuRepository;
import com.example.tasks.sys.repository.SysRoleRepository;
import com.example.tasks.sys.repository.SysUserRepository;
import com.example.tasks.sys.vo.SysDashboardVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 仪表盘统计服务：只读汇总系统各领域的记录数量。 */
@Service
@Transactional(readOnly = true)
public class SysDashboardService {
    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final SysDepartmentRepository departmentRepository;
    private final SysMenuRepository menuRepository;
    private final SysAuditLogRepository auditLogRepository;

    public SysDashboardService(
            SysUserRepository userRepository,
            SysRoleRepository roleRepository,
            SysDepartmentRepository departmentRepository,
            SysMenuRepository menuRepository,
            SysAuditLogRepository auditLogRepository) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.departmentRepository = departmentRepository;
        this.menuRepository = menuRepository;
        this.auditLogRepository = auditLogRepository;
    }

    /** 汇总仪表盘统计：用户、角色、部门、菜单与审计记录总数。 */
    public SysDashboardVO summary() {
        return new SysDashboardVO(
                userRepository.count(),
                roleRepository.count(),
                departmentRepository.count(),
                menuRepository.count(),
                auditLogRepository.count());
    }
}
