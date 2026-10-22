{
  "name": "task-web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": "^22.12.0 || ^24.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run --coverage",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "vue": "3.5.30",
    "vue-router": "4.5.1",
    "element-plus": "2.11.8",
    "vue-i18n": "11.1.12"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "6.0.4",
    "@vue/test-utils": "2.4.6",
    "@vitest/coverage-v8": "4.0.18",
    "@types/node": "22.19.11",
    "@eslint/js": "9.39.2",
    "eslint": "9.39.2",
    "eslint-plugin-vue": "10.7.0",
    "vue-eslint-parser": "10.2.0",
    "globals": "16.5.0",
    "jsdom": "26.1.0",
    "prettier": "3.8.1",
    "typescript": "5.9.3",
    "typescript-eslint": "8.56.1",
    "vite": "7.3.1",
    "vitest": "4.0.18",
    "vue-tsc": "3.2.5"
  }
}
