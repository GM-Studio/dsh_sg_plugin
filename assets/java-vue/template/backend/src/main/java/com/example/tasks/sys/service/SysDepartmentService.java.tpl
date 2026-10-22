package com.example.tasks.sys.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.sys.dto.SysDepartmentRequest;
import com.example.tasks.sys.entity.SysDepartment;
import com.example.tasks.sys.repository.SysDepartmentRepository;
import com.example.tasks.sys.vo.SysDepartmentVO;
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

/** 部门管理服务：分页过滤查询、下拉选项与增删改，并保证部门编码唯一。 */
@Service
@Transactional(readOnly = true)
public class SysDepartmentService {
    private final int maxPageSize;
    private final int maxBatchSize;
    private final SysDepartmentRepository repository;

    /** 读取分页/批量上限配置并做范围校验，越界配置让应用启动即失败。 */
    public SysDepartmentService(
            SysDepartmentRepository repository,
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

    /** 分页查询部门，支持编码/名称忽略大小写的模糊过滤，默认按 id 升序。 */
    public PageResult<SysDepartmentVO> list(int page, int pageSize, String code, String name) {
        if (page < 1 || pageSize < 1 || pageSize > maxPageSize) {
            throw new BusinessException(
                    400, "PAGE", "page must be positive and pageSize between 1 and 100");
        }
        Page<SysDepartment> result =
                repository.findAll(
                        filter(code, name),
                        PageRequest.of(page - 1, pageSize, Sort.by(Sort.Direction.ASC, "id")));
        return new PageResult<>(
                result.getContent().stream().map(SysDepartmentVO::new).collect(Collectors.toList()),
                result.getTotalElements(),
                page,
                pageSize);
    }

    /** 构造编码/名称的模糊过滤条件：去除首尾空格、忽略大小写并转义 LIKE 通配符。 */
    public Specification<SysDepartment> filter(String code, String name) {
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

    public SysDepartmentVO get(Long id) {
        return new SysDepartmentVO(find(id));
    }

    /** 列出全部部门供前端下拉框使用，value 为部门编码，label 为部门名称，按编码升序。 */
    public List<SysOptionVO> options() {
        return repository.findAll(Sort.by(Sort.Direction.ASC, "code")).stream()
                .map(department -> new SysOptionVO(department.getCode(), department.getName()))
                .collect(Collectors.toList());
    }

    /** 加载部门实体，id 非法返回 400，不存在返回 404。 */
    private SysDepartment find(Long id) {
        if (id == null || id < 1) {
            throw new BusinessException(400, "ID", "id must be positive");
        }
        return repository
                .findById(id)
                .orElseThrow(
                        () ->
                                new BusinessException(
                                        404, "SYS_DEPARTMENT_NOT_FOUND", "Department not found"));
    }

    /** 新建部门：先做编码唯一性校验，重复时返回 409。 */
    @Transactional
    public SysDepartmentVO create(SysDepartmentRequest request) {
        String code = request.getCode().trim();
        requireCodeAvailable(code, null);
        return new SysDepartmentVO(
                repository.save(
                        new SysDepartment(
                                code,
                                request.getName().trim(),
                                trimmedParentCode(request),
                                request.getEnabled())));
    }

    /** 更新部门：编码被其它部门占用时返回 409，否则就地更新并落库。 */
    @Transactional
    public SysDepartmentVO update(Long id, SysDepartmentRequest request) {
        SysDepartment department = find(id);
        String code = request.getCode().trim();
        requireCodeAvailable(code, id);
        department.update(
                code, request.getName().trim(), trimmedParentCode(request), request.getEnabled());
        return new SysDepartmentVO(repository.save(department));
    }

    /** 删除部门，返回统一的删除结果。 */
    @Transactional
    public OperationResult delete(Long id) {
        repository.delete(find(id));
        return new OperationResult(id, true, 1);
    }

    /** 编码唯一性校验：selfId 非空表示更新场景，此时忽略自身记录。 */
    private void requireCodeAvailable(String code, Long selfId) {
        SysDepartment existing = repository.findByCode(code).orElse(null);
        if (existing != null && (selfId == null || !selfId.equals(existing.getId()))) {
            throw new BusinessException(
                    409, "SYS_DEPARTMENT_CODE_CONFLICT", "Department code already exists");
        }
    }

    /** 上级部门编码允许为空，保存前仅去除首尾空格。 */
    private static String trimmedParentCode(SysDepartmentRequest request) {
        return request.getParentCode() == null ? null : request.getParentCode().trim();
    }
}
