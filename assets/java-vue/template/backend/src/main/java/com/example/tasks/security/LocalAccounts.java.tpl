package com.example.tasks.security;

import com.example.tasks.common.BusinessException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

/** Two configured local accounts; passwords are only retained as salted hashes. */
@Service
public class LocalAccounts {
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    private final Map<String, String> hashes = new HashMap<>();
    private final Map<String, Attempt> attempts = new HashMap<>();
    private final String dummyHash;

    public LocalAccounts(
            @Value("${APP_ADMIN_PASSWORD:}") String admin,
            @Value("${APP_VIEWER_PASSWORD:}") String viewer) {
        requirePassword(admin);
        requirePassword(viewer);
        hashes.put("admin", encoder.encode(admin));
        hashes.put("viewer", encoder.encode(viewer));
        dummyHash = encoder.encode(java.util.UUID.randomUUID().toString());
    }

    private void requirePassword(String password) {
        int bytes = password.getBytes(StandardCharsets.UTF_8).length;
        if (password.length() < 12 || bytes > 72) {
            throw new IllegalStateException(
                    "Set APP_ADMIN_PASSWORD and APP_VIEWER_PASSWORD: 12+ characters, at most 72 UTF-8 bytes");
        }
    }

    public synchronized Authentication login(String username, String password, String address) {
        long now = System.currentTimeMillis();
        attempts.entrySet().removeIf(entry -> now - entry.getValue().started >= 60000);
        Attempt attempt = attempts.get(address);
        if (attempt != null && attempt.count >= 5 || attempt == null && attempts.size() >= 1024) {
            throw new BusinessException(429, "LOGIN_LIMIT", "Try again later");
        }
        boolean validLength = password.getBytes(StandardCharsets.UTF_8).length <= 72;
        boolean matches =
                encoder.matches(
                        validLength ? password : "invalid",
                        hashes.getOrDefault(username, dummyHash));
        if (!validLength || !hashes.containsKey(username) || !matches) {
            if (attempt == null) {
                attempt = new Attempt(now);
                attempts.put(address, attempt);
            }
            attempt.count++;
            throw new BusinessException(401, "LOGIN_FAILED", "Invalid credentials");
        }
        attempts.remove(address);
        String role = "admin".equals(username) ? "ADMIN" : "VIEWER";
        return new UsernamePasswordAuthenticationToken(
                username,
                null,
                Collections.singletonList(new SimpleGrantedAuthority("ROLE_" + role)));
    }

    private static class Attempt {
        private final long started;
        private int count;

        Attempt(long started) {
            this.started = started;
        }
    }
}
