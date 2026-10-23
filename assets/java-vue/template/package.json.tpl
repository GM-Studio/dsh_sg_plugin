{
  "name": "java-vue-tasks",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": "^22.12.0 || ^24.0.0"
  },
  "scripts": {
    "setup": "node scripts/run.mjs install",
    "dev": "node scripts/run.mjs dev",
    "dev:all": "node scripts/run.mjs dev:all",
    "configure": "node scripts/configure.mjs",
    "backend": "node scripts/run.mjs backend",
    "frontend": "node scripts/run.mjs frontend",
    "build": "node scripts/run.mjs build",
    "test": "node scripts/run.mjs test",
    "lint": "node scripts/run.mjs lint",
    "format": "node scripts/run.mjs format",
    "format:check": "node scripts/run.mjs format:check",
    "verify": "node scripts/run.mjs verify"
  }
}
