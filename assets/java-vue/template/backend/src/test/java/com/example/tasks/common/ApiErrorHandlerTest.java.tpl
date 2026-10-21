package com.example.tasks.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.example.tasks.controller.ApiFallbackController;
import javax.servlet.RequestDispatcher;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class ApiErrorHandlerTest {
    @Test
    void AC003_unexpectedFailureDoesNotExposeInternalDetails() {
        ApiErrorHandler handler = new ApiErrorHandler();
        ApiResponse<Void> body =
                handler.unexpected(new IllegalStateException("private internal diagnostic"))
                        .getBody();
        assertEquals("INTERNAL", body.getCode());
        assertFalse(body.getMessage().contains("private"));
        assertEquals("NOT_ACCEPTABLE", handler.unacceptable(new Exception()).getBody().getCode());
        assertEquals("HTTP_404", handler.routeNotFound(new Exception()).getBody().getCode());
        assertEquals("FILE_SIZE", handler.tooLarge(new Exception()).getBody().getCode());
        ApiFallbackController fallback = new ApiFallbackController();
        MockHttpServletRequest request = new MockHttpServletRequest();
        assertEquals(500, fallback.error(request).getStatusCode().value());
        request.setAttribute(RequestDispatcher.ERROR_STATUS_CODE, 404);
        assertEquals(404, fallback.error(request).getStatusCode().value());
    }
}
