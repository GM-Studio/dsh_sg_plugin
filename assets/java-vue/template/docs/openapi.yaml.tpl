{
  "openapi": "3.0.3",
  "info": {
    "title": "SpecGate Task reference API",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks": {
      "get": {
        "summary": "Paginate Task VOs",
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
            "name": "title",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "completed",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "sortBy",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "sortOrder",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
        "summary": "Create task (ADMIN)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
                "$ref": "#/components/schemas/TaskRequest"
              }
            }
          }
        }
      }
    },
    "/api/tasks/{id}": {
      "get": {
        "summary": "Task detail",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks/update": {
      "post": {
        "summary": "Update task (ADMIN)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
                "$ref": "#/components/schemas/UpdateTaskRequest"
              }
            }
          }
        }
      }
    },
    "/api/tasks/delete": {
      "post": {
        "summary": "Delete task, JSON receipt (ADMIN)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks/batch-delete": {
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks/batch-update-status": {
      "post": {
        "summary": "Atomic status update (ADMIN)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks/import/template": {
      "get": {
        "summary": "CSV template download",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks/export": {
      "get": {
        "summary": "Filtered CSV export, max 1000 records",
        "parameters": [
          {
            "in": "query",
            "name": "title",
            "schema": {
              "type": "string"
            }
          },
          {
            "in": "query",
            "name": "completed",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks/import/validate": {
      "post": {
        "summary": "CSV preview, no writes (ADMIN)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/tasks/import": {
      "post": {
        "summary": "Atomic CSV insert, <=1000 rows and 2 MiB (ADMIN)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/files": {
      "get": {
        "summary": "File metadata, up to 100 records",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/files/upload": {
      "post": {
        "summary": "Upload file <=10 MiB (ADMIN)",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/files/{fileId}": {
      "get": {
        "summary": "File metadata",
        "parameters": [
          {
            "in": "path",
            "name": "fileId",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
    "/api/files/{fileId}/download": {
      "get": {
        "summary": "Authenticated attachment download",
        "parameters": [
          {
            "in": "path",
            "name": "fileId",
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
            "description": "Uniform JSON error (400/401/403/404/405/413/415/429/500 as applicable)",
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
      "TaskRequest": {
        "type": "object",
        "required": [
          "title",
          "completed"
        ],
        "properties": {
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "completed": {
            "type": "boolean"
          }
        }
      },
      "UpdateTaskRequest": {
        "type": "object",
        "required": [
          "id",
          "title",
          "completed"
        ],
        "properties": {
          "id": {
            "type": "integer",
            "format": "int64",
            "minimum": 1
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "completed": {
            "type": "boolean"
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
          },
          "completed": {
            "type": "boolean",
            "description": "Required for batch-update-status"
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
      "Empty": {
        "type": "object"
      }
    }
  }
}
