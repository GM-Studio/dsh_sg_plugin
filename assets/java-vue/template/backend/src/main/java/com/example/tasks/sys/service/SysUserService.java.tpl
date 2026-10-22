package com.example.tasks.sys.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.dto.BatchRequest;
import com.example.tasks.sys.dto.SysUserRequest;
import com.example.tasks.sys.entity.SysUser;
import com.example.tasks.sys.repository.SysUserRepository;
import com.example.tasks.sys.vo.SysUserVO;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import javax.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 用户管理服务：分页过滤查询与增删改，并保证用户名唯一。 */
@Service
@Transactional(readOnly = true)
public class SysUserService {
    private final int maxPageSize;
    private final int maxBatchSize;
    private final SysUserRepository repository;

    /** 读取分页/批量上限配置并做范围校验，越界配置让应用启动即失败。 */
    public SysUserService(
            SysUserRepository repository,
            @org.springframework.beans.factory.annotation.Value("${app.sys.max-page-size:100}")
                    int maxPageSize,
            @org.springframework.beans.factory.annotation.Value("${app.sys.max-batch-size:100}")
                    int maxBatchSize) {
        this.repository = repository;
        if (maxPageSize < 20 || maxPageSize > 100 || maxBatchSize < 1 || maxBatchSize > 100) {
            throw new IllegalArgumentException(
                    "Page limit must be 20–100; batch limit must be 1–100");
        }
        this.maxPageSize = maxPageSize;
        this.maxBatchSize = maxBatchSize;
    }

    /** 分页查询用户，支持用户名模糊（忽略大小写）、角色编码与启用状态过滤，默认按 id 升序。 */
    public PageResult<SysUserVO> list(
            int page, int pageSize, String username, String roleCode, Boolean enabled) {
        if (page < 1 || pageSize < 1 || pageSize > maxPageSize) {
            throw new BusinessException(
                    400, "PAGE", "page must be positive and pageSize between 1 and 100");
        }
        Page<SysUser> result =
                repository.findAll(
                        filter(username, roleCode, enabled),
                        PageRequest.of(page - 1, pageSize, Sort.by(Sort.Direction.ASC, "id")));
        return new PageResult<>(
                result.getContent().stream().map(SysUserVO::new).collect(Collectors.toList()),
                result.getTotalElements(),
                page,
                pageSize);
    }

    /** 构造用户过滤条件：用户名模糊匹配（转义通配符），角色编码与状态精确匹配。 */
    public Specification<SysUser> filter(String username, String roleCode, Boolean enabled) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (username != null && !username.trim().isEmpty()) {
                String escaped =
                        username.trim()
                                .replace("\\", "\\\\")
                                .replace("%", "\\%")
                                .replace("_", "\\_")
                                .toLowerCase(Locale.ROOT);
                predicates.add(
                        builder.like(
                                builder.lower(root.get("username")), "%" + escaped + "%", '\\'));
            }
            if (roleCode != null && !roleCode.trim().isEmpty()) {
                predicates.add(builder.equal(root.get("roleCode"), roleCode.trim()));
            }
            if (enabled != null) {
                predicates.add(builder.equal(root.get("enabled"), enabled));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    public SysUserVO get(Long id) {
        return new SysUserVO(find(id));
    }

    /** 加载用户实体，id 非法返回 400，不存在返回 404。 */
    private SysUser find(Long id) {
        if (id == null || id < 1) {
            throw new BusinessException(400, "ID", "id must be positive");
        }
        return repository
                .findById(id)
                .orElseThrow(
                        () -> new BusinessException(404, "SYS_USER_NOT_FOUND", "User not found"));
    }

    /** 新建用户：先做用户名唯一性校验，重复时返回 409。 */
    @Transactional
    public SysUserVO create(SysUserRequest request) {
        String username = request.getUsername().trim();
        requireUsernameAvailable(username, null);
        return new SysUserVO(
                repository.save(
                        new SysUser(
                                username,
                                trimmedDisplayName(request),
                                request.getRoleCode().trim(),
                                request.getEnabled())));
    }

    /** 更新用户：用户名被其它用户占用时返回 409，否则就地更新并落库。 */
    @Transactional
    public SysUserVO update(Long id, SysUserRequest request) {
        SysUser user = find(id);
        String username = request.getUsername().trim();
        requireUsernameAvailable(username, id);
        user.update(
                username,
                trimmedDisplayName(request),
                request.getRoleCode().trim(),
                request.getEnabled());
        return new SysUserVO(repository.save(user));
    }

    /** 删除用户，返回统一的删除结果。 */
    @Transactional
    public OperationResult delete(Long id) {
        repository.delete(find(id));
        return new OperationResult(id, true, 1);
    }

    /** 批量删除用户：ids 必须是 1..maxBatchSize 个互不相同的正整数，任一缺失即整体回滚。 */
    @Transactional
    public OperationResult batchDelete(BatchRequest request) {
        List<Long> ids = request.getIds();
        if (ids == null
                || ids.isEmpty()
                || ids.size() > maxBatchSize
                || new HashSet<>(ids).size() != ids.size()
                || ids.stream().anyMatch(id -> id == null || id < 1)) {
            throw new BusinessException(400, "BATCH_IDS", "Supply 1 to 100 different positive ids");
        }
        List<SysUser> users = ids.stream().map(this::find).collect(Collectors.toList());
        repository.deleteAll(users);
        return new OperationResult(null, true, users.size());
    }

    /** 用户名唯一性校验：selfId 非空表示更新场景，此时忽略自身记录。 */
    private void requireUsernameAvailable(String username, Long selfId) {
        SysUser existing = repository.findByUsername(username).orElse(null);
        if (existing != null && (selfId == null || !selfId.equals(existing.getId()))) {
            throw new BusinessException(409, "SYS_USER_NAME_CONFLICT", "Username already exists");
        }
    }

    /** 显示名允许为空，保存前仅去除首尾空格。 */
    private static String trimmedDisplayName(SysUserRequest request) {
        return request.getDisplayName() == null ? null : request.getDisplayName().trim();
    }
}
