package com.example.tasks.security;

import com.example.tasks.common.ApiResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

@Configuration
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
public class SecurityConfig {
    @Bean
    public org.springframework.security.core.userdetails.UserDetailsService localUsersOnly() {
        return username -> {
            throw new org.springframework.security.core.userdetails.UsernameNotFoundException(
                    "Use the JSON login endpoint");
        };
    }

    @Bean
    public HttpSessionSecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http, HttpSessionSecurityContextRepository repository) throws Exception {
        http.securityContext(context -> context.securityContextRepository(repository))
                .csrf(csrf -> csrf.csrfTokenRepository(new HttpSessionCsrfTokenRepository()))
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(
                                                request ->
                                                        (request.getContextPath()
                                                                                + "/actuator/health")
                                                                        .equals(
                                                                                request
                                                                                        .getRequestURI())
                                                                || (request.getContextPath()
                                                                                + "/api/auth/csrf")
                                                                        .equals(
                                                                                request
                                                                                        .getRequestURI())
                                                                || (request.getContextPath()
                                                                                + "/api/auth/login")
                                                                        .equals(
                                                                                request
                                                                                        .getRequestURI()))
                                        .permitAll()
                                        .requestMatchers(
                                                request ->
                                                        (request.getContextPath()
                                                                        + "/api/auth/logout")
                                                                .equals(request.getRequestURI()))
                                        .authenticated()
                                        .requestMatchers(
                                                request -> "GET".equals(request.getMethod()))
                                        .authenticated()
                                        .anyRequest()
                                        .hasRole("ADMIN"))
                .exceptionHandling(
                        errors ->
                                errors.authenticationEntryPoint(
                                                (request, response, error) ->
                                                        ApiResponse.securityError(response, 401))
                                        .accessDeniedHandler(
                                                (request, response, error) ->
                                                        ApiResponse.securityError(response, 403)))
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable());
        return http.build();
    }
}
