package com.example.tasks.sys.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.sys.entity.SysAuditLog;
import com.example.tasks.sys.repository.SysAuditLogRepository;
import com.example.tasks.sys.vo.SysAuditLogVO;
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

/** 审计日志服务：只提供分页查询与追加入库，按 id 倒序返回最新记录。 */
@Service
@Transactional(readOnly = true)
public class SysAuditLogService {
    private final int maxPageSize;
    private final int maxBatchSize;
    private final SysAuditLogRepository repository;

    /** 读取分页/批量上限配置并做范围校验，越界配置让应用启动即失败。 */
    public SysAuditLogService(
            SysAuditLogRepository repository,
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

    /** 分页查询审计日志，支持操作者/动作忽略大小写的模糊过滤，默认按 id 倒序。 */
    public PageResult<SysAuditLogVO> list(int page, int pageSize, String actor, String action) {
        if (page < 1 || pageSize < 1 || pageSize > maxPageSize) {
            throw new BusinessException(
                    400, "PAGE", "page must be positive and pageSize between 1 and 100");
        }
        Page<SysAuditLog> result =
                repository.findAll(
                        filter(actor, action),
                        PageRequest.of(page - 1, pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(
                result.getContent().stream().map(SysAuditLogVO::new).collect(Collectors.toList()),
                result.getTotalElements(),
                page,
                pageSize);
    }

    /** 构造操作者/动作的模糊过滤条件：去除首尾空格、忽略大小写并转义 LIKE 通配符。 */
    public Specification<SysAuditLog> filter(String actor, String action) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (actor != null && !actor.trim().isEmpty()) {
                String escaped =
                        actor.trim()
                                .replace("\\", "\\\\")
                                .replace("%", "\\%")
                                .replace("_", "\\_")
                                .toLowerCase(Locale.ROOT);
                predicates.add(
                        builder.like(builder.lower(root.get("actor")), "%" + escaped + "%", '\\'));
            }
            if (action != null && !action.trim().isEmpty()) {
                String escaped =
                        action.trim()
                                .replace("\\", "\\\\")
                                .replace("%", "\\%")
                                .replace("_", "\\_")
                                .toLowerCase(Locale.ROOT);
                predicates.add(
                        builder.like(builder.lower(root.get("action")), "%" + escaped + "%", '\\'));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    /** 追加一条审计日志：先按列长度校验入参，再写入 ISO-8601 文本时间戳。 */
    @Transactional
    public SysAuditLogVO record(String actor, String action, String target, String detail) {
        String trimmedActor =
                requireText(actor, 64, "AUDIT_ACTOR", "actor must be 1-64 characters");
        String trimmedAction =
                requireText(action, 64, "AUDIT_ACTION", "action must be 1-64 characters");
        String trimmedTarget =
                limitText(target, 128, "AUDIT_TARGET", "target must be at most 128 characters");
        String trimmedDetail =
                limitText(detail, 512, "AUDIT_DETAIL", "detail must be at most 512 characters");
        return new SysAuditLogVO(
                repository.save(
                        new SysAuditLog(
                                trimmedActor,
                                trimmedAction,
                                trimmedTarget,
                                trimmedDetail,
                                java.time.Instant.now().toString())));
    }

    /** 必填文本校验：去除首尾空格后必须非空且不超过列长度，否则返回 400。 */
    private static String requireText(String value, int maxLength, String code, String message) {
        String trimmed = value == null ? null : value.trim();
        if (trimmed == null || trimmed.isEmpty() || trimmed.length() > maxLength) {
            throw new BusinessException(400, code, message);
        }
        return trimmed;
    }

    /** 可选文本校验：空值统一存为 null，非空时去除首尾空格并校验列长度。 */
    private static String limitText(String value, int maxLength, String code, String message) {
        String trimmed = value == null ? null : value.trim();
        if (trimmed == null || trimmed.isEmpty()) {
            return null;
        }
        if (trimmed.length() > maxLength) {
            throw new BusinessException(400, code, message);
        }
        return trimmed;
    }
}
