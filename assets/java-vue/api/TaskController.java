package com.example.tasks;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.validation.Valid;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotNull;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {
  private final TaskRepository repository;

  public TaskController(TaskRepository repository) {
    this.repository = repository;
  }

  @GetMapping
  public List<Task> list() {
    return repository.findAll(Sort.by("id"));
  }

  @GetMapping("/{id}")
  public Task get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow(TaskNotFoundException::new);
  }

  @PostMapping
  @Transactional
  public ResponseEntity<Task> create(@Valid @RequestBody TaskRequest request) {
    Task task = repository.save(new Task(request.getTitle().trim(), request.getCompleted()));
    return ResponseEntity.created(URI.create("/api/tasks/" + task.getId())).body(task);
  }

  @PostMapping("/update")
  @Transactional
  public Task update(@Valid @RequestBody UpdateRequest request) {
    Task task = get(request.getId());
    task.update(request.getTitle().trim(), request.getCompleted());
    return repository.save(task);
  }

  @PostMapping("/delete")
  @Transactional
  public Map<String, Object> delete(@Valid @RequestBody IdRequest request) {
    repository.delete(get(request.getId()));
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("id", request.getId());
    response.put("deleted", true);
    return response;
  }

  public static class IdRequest {
    @NotNull
    @Min(1)
    private Long id;

    public Long getId() {
      return id;
    }

    public void setId(Long id) {
      this.id = id;
    }
  }

  public static class UpdateRequest extends TaskRequest {
    @NotNull
    @Min(1)
    private Long id;

    public Long getId() {
      return id;
    }

    public void setId(Long id) {
      this.id = id;
    }
  }
}
