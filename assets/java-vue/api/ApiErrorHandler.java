package com.example.tasks;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiErrorHandler {
  private static final Logger LOG = LoggerFactory.getLogger(ApiErrorHandler.class);

  private ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("status", status.value());
    body.put("message", message);
    return ResponseEntity.status(status).body(body);
  }

  @ExceptionHandler(TaskNotFoundException.class)
  public ResponseEntity<Map<String, Object>> notFound(TaskNotFoundException exception) {
    return error(HttpStatus.NOT_FOUND, exception.getMessage());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException exception) {
    Map<String, String> fields = new LinkedHashMap<>();
    exception
        .getBindingResult()
        .getFieldErrors()
        .forEach(e -> fields.put(e.getField(), e.getDefaultMessage()));
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("status", 400);
    body.put("message", "Invalid task");
    body.put("errors", fields);
    return ResponseEntity.badRequest().body(body);
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  public ResponseEntity<Map<String, Object>> badRequest(Exception exception) {
    return error(HttpStatus.BAD_REQUEST, "Malformed request");
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> unexpected(Exception exception) {
    LOG.error("Unexpected request failure", exception);
    return error(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");
  }

  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<Map<String, Object>> methodNotAllowed(Exception exception) {
    return error(HttpStatus.METHOD_NOT_ALLOWED, "Use GET for queries and POST for mutations");
  }

  @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
  public ResponseEntity<Map<String, Object>> unsupportedMediaType(Exception exception) {
    return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Use application/json");
  }
}
