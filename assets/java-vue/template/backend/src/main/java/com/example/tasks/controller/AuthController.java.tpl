package com.example.tasks.controller;

import com.example.tasks.common.ApiResponse;
import com.example.tasks.dto.LoginRequest;
import com.example.tasks.security.LocalAccounts;
import com.example.tasks.vo.UserVO;
import java.util.Collections;
import java.util.Map;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
@RequestMapping("/api/auth")
public class AuthController {
    private final LocalAccounts accounts;
    private final HttpSessionSecurityContextRepository repository;

    public AuthController(LocalAccounts accounts, HttpSessionSecurityContextRepository repository) {
        this.accounts = accounts;
        this.repository = repository;
    }

    @GetMapping("/csrf")
    public ApiResponse<Map<String, String>> csrf(CsrfToken token) {
        return ApiResponse.success(Collections.singletonMap("token", token.getToken()));
    }

    @PostMapping("/login")
    public ApiResponse<UserVO> login(
            @Valid @RequestBody LoginRequest input,
            HttpServletRequest request,
            HttpServletResponse response) {
        Authentication authentication =
                accounts.login(input.getUsername(), input.getPassword(), request.getRemoteAddr());
        request.getSession();
        request.changeSessionId();
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        repository.saveContext(context, request, response);
        return ApiResponse.success(user(authentication));
    }

    @GetMapping("/me")
    public ApiResponse<UserVO> me(Authentication authentication) {
        return ApiResponse.success(user(authentication));
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpServletRequest request) {
        request.getSession().invalidate();
        SecurityContextHolder.clearContext();
        return ApiResponse.success(null);
    }

    private UserVO user(Authentication authentication) {
        return new UserVO(
                authentication.getName(),
                authentication
                        .getAuthorities()
                        .iterator()
                        .next()
                        .getAuthority()
                        .substring("ROLE_".length()));
    }
}
