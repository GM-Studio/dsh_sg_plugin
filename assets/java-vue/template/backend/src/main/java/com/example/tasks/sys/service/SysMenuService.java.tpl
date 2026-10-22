package com.example.tasks.sys.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.sys.dto.SysMenuRequest;
import com.example.tasks.sys.entity.SysMenu;
import com.example.tasks.sys.repository.SysMenuRepository;
import com.example.tasks.sys.vo.SysMenuVO;
import com.example.tasks.sys.vo.SysOptionVO;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import javax.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 菜单管理服务：分页过滤查询、下拉选项与增删改，并保证菜单编码唯一。 */
@Service
@Transactional(readOnly = true)
public class SysMenuService {
    private final int maxPageSize;
    private final int maxBatchSize;
    private final SysMenuRepository repository;

    /** 读取分页/批量上限配置并做范围校验，越界配置让应用启动即失败。 */
    public SysMenuService(
            SysMenuRepository repository,
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

    /** 分页查询菜单，支持编码/名称忽略大小写的模糊过滤，默认按 sortOrder 升序再按 id 升序。 */
    public PageResult<SysMenuVO> list(int page, int pageSize, String code, String name) {
        if (page < 1 || pageSize < 1 || pageSize > maxPageSize) {
            throw new BusinessException(
                    400, "PAGE", "page must be positive and pageSize between 1 and 100");
        }
        Page<SysMenu> result =
                repository.findAll(
                        filter(code, name),
                        PageRequest.of(
                                page - 1,
                                pageSize,
                                Sort.by(Sort.Direction.ASC, "sortOrder")
                                        .and(Sort.by(Sort.Direction.ASC, "id"))));
        return new PageResult<>(
                result.getContent().stream().map(SysMenuVO::new).collect(Collectors.toList()),
                result.getTotalElements(),
                page,
                pageSize);
    }

    /** 构造编码/名称的模糊过滤条件：去除首尾空格、忽略大小写并转义 LIKE 通配符。 */
    public Specification<SysMenu> filter(String code, String name) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (code != null && !code.trim().isEmpty()) {
                String escaped =
                        code.trim()
                                .replace("\\", "\\\\")
                                .replace("%", "\\%")
                                .replace("_", "\\_")
                                .toLowerCase(Locale.ROOT);
                predicates.add(
                        builder.like(builder.lower(root.get("code")), "%" + escaped + "%", '\\'));
            }
            if (name != null && !name.trim().isEmpty()) {
                String escaped =
                        name.trim()
                                .replace("\\", "\\\\")
                                .replace("%", "\\%")
                                .replace("_", "\\_")
                                .toLowerCase(Locale.ROOT);
                predicates.add(
                        builder.like(builder.lower(root.get("name")), "%" + escaped + "%", '\\'));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    public SysMenuVO get(Long id) {
        return new SysMenuVO(find(id));
    }

    /** 列出全部菜单供前端下拉框使用，value 为菜单编码，label 为菜单名称，按 sortOrder/编码升序。 */
    public List<SysOptionVO> options() {
        return repository
                .findAll(
                        Sort.by(Sort.Direction.ASC, "sortOrder")
                                .and(Sort.by(Sort.Direction.ASC, "code")))
                .stream()
                .map(menu -> new SysOptionVO(menu.getCode(), menu.getName()))
                .collect(Collectors.toList());
    }

    /** 加载菜单实体，id 非法返回 400，不存在返回 404。 */
    private SysMenu find(Long id) {
        if (id == null || id < 1) {
            throw new BusinessException(400, "ID", "id must be positive");
        }
        return repository
                .findById(id)
                .orElseThrow(
                        () -> new BusinessException(404, "SYS_MENU_NOT_FOUND", "Menu not found"));
    }

    /** 新建菜单：先做编码唯一性校验，重复时返回 409。 */
    @Transactional
    public SysMenuVO create(SysMenuRequest request) {
        String code = request.getCode().trim();
        requireCodeAvailable(code, null);
        return new SysMenuVO(
                repository.save(
                        new SysMenu(
                                code,
                                request.getName().trim(),
                                trimmed(request.getPath()),
                                trimmed(request.getIcon()),
                                request.getSortOrder(),
                                request.getEnabled())));
    }

    /** 更新菜单：编码被其它菜单占用时返回 409，否则就地更新并落库。 */
    @Transactional
    public SysMenuVO update(Long id, SysMenuRequest request) {
        SysMenu menu = find(id);
        String code = request.getCode().trim();
        requireCodeAvailable(code, id);
        menu.update(
                code,
                request.getName().trim(),
                trimmed(request.getPath()),
                trimmed(request.getIcon()),
                request.getSortOrder(),
                request.getEnabled());
        return new SysMenuVO(repository.save(menu));
    }

    /** 删除菜单，返回统一的删除结果。 */
    @Transactional
    public OperationResult delete(Long id) {
        repository.delete(find(id));
        return new OperationResult(id, true, 1);
    }

    /** 编码唯一性校验：selfId 非空表示更新场景，此时忽略自身记录。 */
    private void requireCodeAvailable(String code, Long selfId) {
        SysMenu existing = repository.findByCode(code).orElse(null);
        if (existing != null && (selfId == null || !selfId.equals(existing.getId()))) {
            throw new BusinessException(409, "SYS_MENU_CODE_CONFLICT", "Menu code already exists");
        }
    }

    /** 路径与图标允许为空，保存前仅去除首尾空格。 */
    private static String trimmed(String value) {
        return value == null ? null : value.trim();
    }
}
