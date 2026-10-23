package com.example.tasks.security;

import com.example.tasks.common.BusinessException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
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

    public LocalAccounts(String admin, String viewer) {
        this(admin, viewer, false);
    }

    @Autowired
    public LocalAccounts(
            @Value("${APP_ADMIN_PASSWORD:}") String admin,
            @Value("${APP_VIEWER_PASSWORD:}") String viewer,
            @Value("${APP_LOCAL_DEMO:false}") boolean localDemo) {
        requirePassword(admin, localDemo && "admin".equals(admin));
        requirePassword(viewer, localDemo && "viewer".equals(viewer));
        hashes.put("admin", encoder.encode(admin));
        hashes.put("viewer", encoder.encode(viewer));
        dummyHash = encoder.encode(java.util.UUID.randomUUID().toString());
    }

    private void requirePassword(String password, boolean localDemoPassword) {
        int bytes = password.getBytes(StandardCharsets.UTF_8).length;
        if ((!localDemoPassword && password.length() < 12) || bytes > 72) {
            throw new IllegalStateException(
                    "请配置管理员与只读账号密码：至少 12 个字符，最多 72 个 UTF-8 字节；仅本地演示模式允许预置演示密码");
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
