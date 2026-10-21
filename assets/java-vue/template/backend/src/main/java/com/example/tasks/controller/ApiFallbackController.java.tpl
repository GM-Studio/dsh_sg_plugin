package com.example.tasks.controller;

import com.example.tasks.common.ApiResponse;
import javax.servlet.RequestDispatcher;
import javax.servlet.http.HttpServletRequest;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Keep container/MVC fallback errors inside the public contract. */
@RestController
public class ApiFallbackController implements ErrorController {
    @RequestMapping("/error")
    public ResponseEntity<ApiResponse<Void>> error(HttpServletRequest request) {
        Object attribute = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        int status = attribute instanceof Integer ? (Integer) attribute : 500;
        return ResponseEntity.status(status)
                .body(
                        ApiResponse.failure(
                                "HTTP_" + status,
                                status == 404 ? "Resource not found" : "Request failed",
                                null));
    }
}
