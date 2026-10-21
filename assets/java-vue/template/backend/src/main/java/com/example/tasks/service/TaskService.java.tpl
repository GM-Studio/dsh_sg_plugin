package com.example.tasks.service;

import com.example.tasks.common.BusinessException;
import com.example.tasks.dto.BatchRequest;
import com.example.tasks.dto.TaskRequest;
import com.example.tasks.entity.Task;
import com.example.tasks.repository.TaskRepository;
import com.example.tasks.vo.OperationResult;
import com.example.tasks.vo.PageResult;
import com.example.tasks.vo.TaskVO;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.stream.Collectors;
import javax.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class TaskService {
    private final int maxPageSize;
    private final int maxBatchSize;
    private final TaskRepository repository;

    public TaskService(
            TaskRepository repository,
            @org.springframework.beans.factory.annotation.Value("${app.tasks.max-page-size:100}")
                    int maxPageSize,
            @org.springframework.beans.factory.annotation.Value("${app.tasks.max-batch-size:100}")
                    int maxBatchSize) {
        this.repository = repository;
        if (maxPageSize < 20 || maxPageSize > 100 || maxBatchSize < 1 || maxBatchSize > 100) {
            throw new IllegalArgumentException(
                    "Page limit must be 20–100; batch limit must be 1–100");
        }
        this.maxPageSize = maxPageSize;
        this.maxBatchSize = maxBatchSize;
    }

    public PageResult<TaskVO> list(
            int page,
            int pageSize,
            String title,
            Boolean completed,
            String sortBy,
            String sortOrder) {
        if (page < 1 || pageSize < 1 || pageSize > maxPageSize) {
            throw new BusinessException(
                    400, "PAGE", "page must be positive and pageSize between 1 and 100");
        }
        if (!("id".equals(sortBy) || "title".equals(sortBy) || "completed".equals(sortBy))
                || !("asc".equals(sortOrder) || "desc".equals(sortOrder))) {
            throw new BusinessException(400, "SORT", "Unsupported sort field or direction");
        }
        Page<Task> result =
                repository.findAll(
                        filter(title, completed),
                        PageRequest.of(
                                page - 1,
                                pageSize,
                                Sort.by(Sort.Direction.fromString(sortOrder), sortBy)));
        return new PageResult<>(
                result.getContent().stream().map(TaskVO::new).collect(Collectors.toList()),
                result.getTotalElements(),
                page,
                pageSize);
    }

    public Specification<Task> filter(String title, Boolean completed) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (title != null && !title.trim().isEmpty()) {
                String escaped =
                        title.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                predicates.add(builder.like(root.get("title"), "%" + escaped + "%", '\\'));
            }
            if (completed != null) {
                predicates.add(builder.equal(root.get("completed"), completed));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    public TaskVO get(Long id) {
        return new TaskVO(find(id));
    }

    private Task find(Long id) {
        if (id == null || id < 1) {
            throw new BusinessException(400, "ID", "id must be positive");
        }
        return repository
                .findById(id)
                .orElseThrow(() -> new BusinessException(404, "TASK_NOT_FOUND", "Task not found"));
    }

    @Transactional
    public TaskVO create(TaskRequest request) {
        return new TaskVO(
                repository.save(new Task(request.getTitle().trim(), request.getCompleted())));
    }

    @Transactional
    public TaskVO update(Long id, TaskRequest request) {
        Task task = find(id);
        task.update(request.getTitle().trim(), request.getCompleted());
        return new TaskVO(repository.save(task));
    }

    @Transactional
    public OperationResult delete(Long id) {
        repository.delete(find(id));
        return new OperationResult(id, true, 1);
    }

    @Transactional
    public OperationResult batch(BatchRequest request, boolean delete) {
        List<Long> ids = request.getIds();
        if (ids == null
                || ids.isEmpty()
                || ids.size() > maxBatchSize
                || new HashSet<>(ids).size() != ids.size()
                || ids.stream().anyMatch(id -> id == null || id < 1)) {
            throw new BusinessException(400, "BATCH_IDS", "Supply 1 to 100 different positive ids");
        }
        if (!delete && request.getCompleted() == null) {
            throw new BusinessException(400, "BATCH_STATUS", "completed is required");
        }
        List<Task> tasks = ids.stream().map(this::find).collect(Collectors.toList());
        if (delete) {
            repository.deleteAll(tasks);
        } else {
            tasks.forEach(task -> task.update(task.getTitle(), request.getCompleted()));
            repository.saveAll(tasks);
        }
        return new OperationResult(null, delete, tasks.size());
    }
}
