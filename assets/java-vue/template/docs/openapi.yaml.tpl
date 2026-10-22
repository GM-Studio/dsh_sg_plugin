{
  "openapi": "3.0.3",
  "info": {
    "title": "SpecGate admin reference API",
    "version": "java-vue-admin-1",
    "description": "See api.md for exact typed data contracts, limits, atomicity and transfer exceptions."
  },
  "servers": [
    {
      "url": "http://127.0.0.1:8080"
    }
  ],
  "security": [
    {
      "SessionCookie": []
    }
  ],
  "paths": {
    "/api/auth/csrf": {
      "get": {
        "summary": "Get CSRF token, retain Session Cookie",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "security": []
      }
    },
    "/api/auth/login": {
      "post": {
        "summary": "Login, rotate session",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LoginRequest"
              }
            }
          }
        }
      }
    },
    "/api/auth/me": {
      "get": {
        "summary": "Current user and role",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/auth/logout": {
      "post": {
        "summary": "Invalidate session",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Empty"
              }
            }
          }
        }
      }
    },
    "/api/sys/dashboard": {
      "get": {
        "summary": "Dashboard summary counts",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/users": {
      "get": {
        "summary": "Paginate users",
        "parameters": [
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "pageSize",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "username",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "roleCode",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "enabled",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create user (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysUserRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/users/{id}": {
      "get": {
        "summary": "User detail",
        "parameters": [
          {
            "in": "path",
            "name": "id",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/users/update": {
      "post": {
        "summary": "Update user (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysUserUpdateRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/users/delete": {
      "post": {
        "summary": "Delete user, JSON receipt (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/IdRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/users/batch-delete": {
      "post": {
        "summary": "Atomic delete, 1–100 distinct ids (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/BatchRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/users/import/template": {
      "get": {
        "summary": "User CSV template download",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "text/csv": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              },
              "application/octet-stream": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/users/export": {
      "get": {
        "summary": "Filtered user CSV export, max 1000 records",
        "parameters": [
          {
            "in": "query",
            "name": "username",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "roleCode",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "enabled",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "text/csv": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              },
              "application/octet-stream": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/users/import/validate": {
      "post": {
        "summary": "User CSV preview, no writes (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "required": [
                  "file"
                ],
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/users/import": {
      "post": {
        "summary": "Atomic user CSV insert, <=1000 rows and 2 MiB (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "required": [
                  "file"
                ],
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/roles": {
      "get": {
        "summary": "Paginate roles",
        "parameters": [
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "pageSize",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "code",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "name",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create role (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysRoleRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/options": {
      "get": {
        "summary": "Role options for dropdowns",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/{id}": {
      "get": {
        "summary": "Role detail",
        "parameters": [
          {
            "in": "path",
            "name": "id",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/update": {
      "post": {
        "summary": "Update role (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysRoleUpdateRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/delete": {
      "post": {
        "summary": "Delete role, JSON receipt (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/IdRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/import/template": {
      "get": {
        "summary": "Role CSV template download",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "text/csv": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              },
              "application/octet-stream": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/export": {
      "get": {
        "summary": "Filtered role CSV export, max 1000 records",
        "parameters": [
          {
            "in": "query",
            "name": "code",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "name",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "text/csv": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              },
              "application/octet-stream": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/import/validate": {
      "post": {
        "summary": "Role CSV preview, no writes (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "required": [
                  "file"
                ],
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/roles/import": {
      "post": {
        "summary": "Atomic role CSV insert, <=1000 rows and 2 MiB (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "required": [
                  "file"
                ],
                "properties": {
                  "file": {
                    "type": "string",
                    "format": "binary"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/departments": {
      "get": {
        "summary": "Paginate departments",
        "parameters": [
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "pageSize",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "code",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "name",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create department (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysDepartmentRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/departments/options": {
      "get": {
        "summary": "Department options for dropdowns",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/departments/{id}": {
      "get": {
        "summary": "Department detail",
        "parameters": [
          {
            "in": "path",
            "name": "id",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/departments/update": {
      "post": {
        "summary": "Update department (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysDepartmentUpdateRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/departments/delete": {
      "post": {
        "summary": "Delete department, JSON receipt (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/IdRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/menus": {
      "get": {
        "summary": "Paginate menus",
        "parameters": [
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "pageSize",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "code",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "name",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create menu (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysMenuRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/menus/options": {
      "get": {
        "summary": "Menu options for dropdowns",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/menus/{id}": {
      "get": {
        "summary": "Menu detail",
        "parameters": [
          {
            "in": "path",
            "name": "id",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    },
    "/api/sys/menus/update": {
      "post": {
        "summary": "Update menu (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SysMenuUpdateRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/menus/delete": {
      "post": {
        "summary": "Delete menu, JSON receipt (ADMIN)",
        "parameters": [
          {
            "in": "header",
            "name": "X-CSRF-TOKEN",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/IdRequest"
              }
            }
          }
        }
      }
    },
    "/api/sys/audits": {
      "get": {
        "summary": "Paginate the audit log (read-only)",
        "parameters": [
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "pageSize",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "actor",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "action",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          },
          "default": {
            "description": "Uniform JSON error (400/401/403/404/405/409/413/415/429/500 as applicable)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ApiResponse"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "SessionCookie": {
        "type": "apiKey",
        "in": "cookie",
        "name": "JSESSIONID"
      }
    },
    "schemas": {
      "ApiResponse": {
        "type": "object",
        "required": [
          "code",
          "message",
          "data",
          "traceId"
        ],
        "properties": {
          "code": {
            "oneOf": [
              {
                "type": "integer"
              },
              {
                "type": "string"
              }
            ]
          },
          "message": {
            "type": "string"
          },
          "data": {},
          "traceId": {
            "type": "string"
          }
        }
      },
      "LoginRequest": {
        "type": "object",
        "required": [
          "username",
          "password"
        ],
        "properties": {
          "username": {
            "type": "string",
            "enum": [
              "admin",
              "viewer"
            ]
          },
          "password": {
            "type": "string",
            "format": "password",
            "maxLength": 72
          }
        }
      },
      "IdRequest": {
        "type": "object",
        "required": [
          "id"
        ],
        "properties": {
          "id": {
            "type": "integer",
            "format": "int64",
            "minimum": 1
          }
        }
      },
      "BatchRequest": {
        "type": "object",
        "required": [
          "ids"
        ],
        "properties": {
          "ids": {
            "type": "array",
            "minItems": 1,
            "maxItems": 100,
            "uniqueItems": true,
            "items": {
              "type": "integer",
              "format": "int64",
              "minimum": 1
            }
          }
        }
      },
      "SysUserRequest": {
        "type": "object",
        "required": [
          "username",
          "roleCode",
          "enabled"
        ],
        "properties": {
          "username": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "displayName": {
            "type": "string",
            "maxLength": 128
          },
          "roleCode": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "enabled": {
            "type": "boolean"
          }
        }
      },
      "SysUserUpdateRequest": {
        "allOf": [
          {
            "$ref": "#/components/schemas/SysUserRequest"
          },
          {
            "type": "object",
            "required": [
              "id"
            ],
            "properties": {
              "id": {
                "type": "integer",
                "format": "int64",
                "minimum": 1
              }
            }
          }
        ]
      },
      "SysRoleRequest": {
        "type": "object",
        "required": [
          "code",
          "name",
          "enabled"
        ],
        "properties": {
          "code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "description": {
            "type": "string",
            "maxLength": 255
          },
          "enabled": {
            "type": "boolean"
          }
        }
      },
      "SysRoleUpdateRequest": {
        "allOf": [
          {
            "$ref": "#/components/schemas/SysRoleRequest"
          },
          {
            "type": "object",
            "required": [
              "id"
            ],
            "properties": {
              "id": {
                "type": "integer",
                "format": "int64",
                "minimum": 1
              }
            }
          }
        ]
      },
      "SysDepartmentRequest": {
        "type": "object",
        "required": [
          "code",
          "name",
          "enabled"
        ],
        "properties": {
          "code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "parentCode": {
            "type": "string",
            "maxLength": 64
          },
          "enabled": {
            "type": "boolean"
          }
        }
      },
      "SysDepartmentUpdateRequest": {
        "allOf": [
          {
            "$ref": "#/components/schemas/SysDepartmentRequest"
          },
          {
            "type": "object",
            "required": [
              "id"
            ],
            "properties": {
              "id": {
                "type": "integer",
                "format": "int64",
                "minimum": 1
              }
            }
          }
        ]
      },
      "SysMenuRequest": {
        "type": "object",
        "required": [
          "code",
          "name",
          "sortOrder",
          "enabled"
        ],
        "properties": {
          "code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "path": {
            "type": "string",
            "maxLength": 128
          },
          "icon": {
            "type": "string",
            "maxLength": 64
          },
          "sortOrder": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9999
          },
          "enabled": {
            "type": "boolean"
          }
        }
      },
      "SysMenuUpdateRequest": {
        "allOf": [
          {
            "$ref": "#/components/schemas/SysMenuRequest"
          },
          {
            "type": "object",
            "required": [
              "id"
            ],
            "properties": {
              "id": {
                "type": "integer",
                "format": "int64",
                "minimum": 1
              }
            }
          }
        ]
      },
      "Empty": {
        "type": "object"
      }
    }
  }
}
