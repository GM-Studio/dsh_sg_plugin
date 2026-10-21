import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

function port(value: string | undefined, fallback: number): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535) {
    throw new Error('Ports must be integers between 1 and 65535');
  }
  return result;
}
const backendPort = port(process.env.BACKEND_PORT, 8080);
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: port(process.env.FRONTEND_PORT, 5173),
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:' + backendPort },
      '/actuator': { target: 'http://127.0.0.1:' + backendPort },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: port(process.env.FRONTEND_PORT, 5173),
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.vue'],
      reporter: ['text', 'json-summary', 'json', 'lcov'],
      thresholds: { lines: 80, branches: 70 },
    },
  },
});
