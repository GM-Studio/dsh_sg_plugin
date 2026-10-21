package com.example.tasks.vo;

public final class UserVO {
    private final String username;
    private final String role;

    public UserVO(String username, String role) {
        this.username = username;
        this.role = role;
    }

    public String getUsername() {
        return username;
    }

    public String getRole() {
        return role;
    }
}
