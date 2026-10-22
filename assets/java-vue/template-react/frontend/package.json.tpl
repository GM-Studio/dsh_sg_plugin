{
  "name": "admin-web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": "^22.12.0 || ^24.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run --coverage",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "antd": "5.22.6",
    "i18next": "24.2.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-i18next": "15.4.1",
    "react-router-dom": "6.28.0",
    "zustand": "5.0.2"
  },
  "devDependencies": {
    "@eslint/js": "9.39.2",
    "@testing-library/jest-dom": "6.6.3",
    "@testing-library/react": "16.1.0",
    "@testing-library/user-event": "14.5.2",
    "@types/node": "22.19.11",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "5.2.0",
    "@vitest/coverage-v8": "4.0.18",
    "eslint": "9.39.2",
    "eslint-plugin-react-hooks": "5.1.0",
    "globals": "16.5.0",
    "jsdom": "26.1.0",
    "prettier": "3.8.1",
    "typescript": "5.9.3",
    "typescript-eslint": "8.56.1",
    "vite": "7.3.1",
    "vitest": "4.0.18"
  }
}
