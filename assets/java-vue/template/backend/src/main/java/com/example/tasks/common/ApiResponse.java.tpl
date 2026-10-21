package com.example.tasks.common;

import java.io.IOException;
import javax.servlet.http.HttpServletResponse;
import org.slf4j.MDC;

/** Stable contract shared by controllers and the security filter chain. */
public final class ApiResponse<T> {
    private final Object code;
    private final String message;
    private final T data;
    private final String traceId;

    private ApiResponse(Object code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
        this.traceId = MDC.get("traceId");
    }

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(0, "OK", data);
    }

    public static <T> ApiResponse<T> failure(String code, String message, T data) {
        return new ApiResponse<>(code, message, data);
    }

    public Object getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public T getData() {
        return data;
    }

    public String getTraceId() {
        return traceId;
    }

    /** Messages are constants, traceId is generated internally, never from user input. */
    public static void securityError(HttpServletResponse response, int status) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        String code = status == 401 ? "UNAUTHENTICATED" : "FORBIDDEN";
        String message = status == 401 ? "Login required" : "Permission or CSRF token denied";
        response.getWriter()
                .write(
                        "{\"code\":\""
                                + code
                                + "\",\"message\":\""
                                + message
                                + "\",\"data\":null,\"traceId\":\""
                                + MDC.get("traceId")
                                + "\"}");
    }
}
