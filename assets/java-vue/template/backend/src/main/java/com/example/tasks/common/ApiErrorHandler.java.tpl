package com.example.tasks.common;

import java.util.LinkedHashMap;
import java.util.Map;
import javax.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class ApiErrorHandler {
    @ExceptionHandler(org.springframework.web.servlet.NoHandlerFoundException.class)
    public ResponseEntity<ApiResponse<Void>> routeNotFound(Exception exception) {
        return ResponseEntity.status(404)
                .body(ApiResponse.failure("HTTP_404", "Resource not found", null));
    }

    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<ApiResponse<Void>> unacceptable(Exception exception) {
        return ResponseEntity.status(406)
                .body(ApiResponse.failure("NOT_ACCEPTABLE", "JSON response required", null));
    }

    private static final Logger LOGGER = LoggerFactory.getLogger(ApiErrorHandler.class);

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> business(BusinessException exception) {
        return ResponseEntity.status(exception.getStatus())
                .body(ApiResponse.failure(exception.getCode(), exception.getMessage(), null));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Map<String, String>>> validation(
            MethodArgumentNotValidException exception) {
        Map<String, String> fields = new LinkedHashMap<>();
        exception
                .getBindingResult()
                .getFieldErrors()
                .forEach(error -> fields.put(error.getField(), error.getDefaultMessage()));
        return ResponseEntity.badRequest()
                .body(ApiResponse.failure("VALIDATION", "Invalid input", fields));
    }

    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MethodArgumentTypeMismatchException.class,
        ConstraintViolationException.class,
        MissingServletRequestParameterException.class,
        MissingServletRequestPartException.class
    })
    public ResponseEntity<ApiResponse<Void>> malformed(Exception exception) {
        return ResponseEntity.badRequest()
                .body(ApiResponse.failure("BAD_REQUEST", "Malformed request", null));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> method(Exception exception) {
        return ResponseEntity.status(405)
                .body(ApiResponse.failure("METHOD", "Use GET or POST", null));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> media(Exception exception) {
        return ResponseEntity.status(415)
                .body(ApiResponse.failure("MEDIA_TYPE", "Unsupported media type", null));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResponse<Void>> tooLarge(Exception exception) {
        return ResponseEntity.status(413)
                .body(ApiResponse.failure("FILE_SIZE", "File exceeds limit", null));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> unexpected(Exception exception) {
        LOGGER.error("Unexpected request failure", exception);
        return ResponseEntity.status(500)
                .body(ApiResponse.failure("INTERNAL", "Internal server error", null));
    }
}
