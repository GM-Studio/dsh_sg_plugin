package __PACKAGE__;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import __VALIDATION__.Valid;
import __VALIDATION__.constraints.Min;
import __VALIDATION__.constraints.NotBlank;
import __VALIDATION__.constraints.NotNull;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Item CRUD endpoints: GET queries and POST JSON mutations. */
@RestController
@RequestMapping(value = "/api/items", produces = MediaType.APPLICATION_JSON_VALUE)
public class ItemController {
  private final ItemStore store;

  /** Creates the controller. */
  public ItemController(ItemStore store) {
    this.store = store;
  }

  /** Lists items. */
  @GetMapping
  public List<Item> list() {
    return store.list();
  }

  /** Gets an item. */
  @GetMapping("/{id}")
  public ResponseEntity<Object> get(@PathVariable long id) {
    return store
        .get(id)
        .map(item -> ResponseEntity.ok((Object) item))
        .orElseGet(
            () -> ResponseEntity.status(404).body(Collections.singletonMap("error", "not found")));
  }

  /** Creates an item from JSON. */
  @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<Item> create(@Valid @RequestBody ItemRequest request) {
    return ResponseEntity.status(201)
        .body(store.create(request.getName(), request.getDescription()));
  }

  /** Updates an item with its id in the JSON body. */
  @PostMapping(value = "/update", consumes = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<Object> update(@Valid @RequestBody UpdateRequest request) {
    return store
        .update(request.getId(), request.getName(), request.getDescription())
        .map(item -> ResponseEntity.ok((Object) item))
        .orElseGet(
            () -> ResponseEntity.status(404).body(Collections.singletonMap("error", "not found")));
  }

  /** Deletes an item and returns a JSON receipt. */
  @PostMapping(value = "/delete", consumes = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<Map<String, Object>> delete(@Valid @RequestBody IdRequest request) {
    if (!store.delete(request.getId())) {
      return ResponseEntity.status(404)
          .body(Collections.<String, Object>singletonMap("error", "not found"));
    }
    Map<String, Object> receipt = new LinkedHashMap<>();
    receipt.put("id", request.getId());
    receipt.put("deleted", true);
    return ResponseEntity.ok(receipt);
  }

  /** Returns JSON for malformed bodies and validation errors. */
  @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
  public ResponseEntity<Map<String, String>> invalid(Exception exception) {
    return ResponseEntity.badRequest()
        .body(Collections.singletonMap("error", "invalid JSON request"));
  }

  /** Returns JSON for unsupported methods. */
  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<Map<String, String>> method(Exception exception) {
    return ResponseEntity.status(405).body(Collections.singletonMap("error", "use GET or POST"));
  }

  /** Returns JSON for unsupported content types. */
  @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
  public ResponseEntity<Map<String, String>> contentType(Exception exception) {
    return ResponseEntity.status(415)
        .body(Collections.singletonMap("error", "use application/json"));
  }

  /** Create request. */
  public static class ItemRequest {
    @NotBlank private String name;
    private String description;
    /** Returns name. */
    public String getName() {
      return name;
    }
    /** Sets name. */
    public void setName(String name) {
      this.name = name;
    }
    /** Returns description. */
    public String getDescription() {
      return description;
    }
    /** Sets description. */
    public void setDescription(String description) {
      this.description = description;
    }
  }

  /** Delete request. */
  public static class IdRequest {
    @NotNull
    @Min(1)
    private Long id;
    /** Returns id. */
    public Long getId() {
      return id;
    }
    /** Sets id. */
    public void setId(Long id) {
      this.id = id;
    }
  }

  /** Update request. */
  public static class UpdateRequest extends ItemRequest {
    @NotNull
    @Min(1)
    private Long id;
    /** Returns id. */
    public Long getId() {
      return id;
    }
    /** Sets id. */
    public void setId(Long id) {
      this.id = id;
    }
  }
}
