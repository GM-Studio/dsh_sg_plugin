package com.example.tasks.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.example.tasks.common.BusinessException;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LocalAccountsTest {
    @Test
    void localDemoPasswordsRequireExplicitDemoMode() {
        assertThrows(IllegalStateException.class, () -> new LocalAccounts("admin", "viewer"));
        assertThrows(
                IllegalStateException.class, () -> new LocalAccounts("admin", "viewer", false));
        assertThrows(IllegalStateException.class, () -> new LocalAccounts("123", "viewer", true));
        LocalAccounts accounts = new LocalAccounts("admin", "viewer", true);
        assertEquals("admin", accounts.login("admin", "admin", "demo-admin").getName());
        assertEquals("viewer", accounts.login("viewer", "viewer", "demo-viewer").getName());
    }

    @Test
    void AC004_passwordConfigurationAndBruteForceLimit() {
        String password = UUID.randomUUID().toString();
        assertThrows(IllegalStateException.class, () -> new LocalAccounts("", password));
        assertThrows(
                IllegalStateException.class,
                () -> new LocalAccounts(password, new String(new char[73]).replace('\0', 'a')));
        LocalAccounts accounts = new LocalAccounts(password, password);
        assertEquals(
                "ROLE_ADMIN",
                accounts.login("admin", password, "one")
                        .getAuthorities()
                        .iterator()
                        .next()
                        .getAuthority());
        assertEquals(
                "ROLE_VIEWER",
                accounts.login("viewer", password, "two")
                        .getAuthorities()
                        .iterator()
                        .next()
                        .getAuthority());
        for (int attempt = 0; attempt < 5; attempt++) {
            assertEquals(
                    401,
                    assertThrows(
                                    BusinessException.class,
                                    () -> accounts.login("unknown", "wrong", "limited"))
                            .getStatus());
        }
        assertEquals(
                429,
                assertThrows(
                                BusinessException.class,
                                () -> accounts.login("admin", password, "limited"))
                        .getStatus());
        assertThrows(BusinessException.class, () -> accounts.login("admin", "wrong", "other"));
        assertThrows(
                BusinessException.class,
                () -> accounts.login("admin", new String(new char[73]).replace('\0', 'x'), "long"));
        assertEquals("admin", accounts.login("admin", password, "other").getName());
    }
}
