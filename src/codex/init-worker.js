import { startJavaInit } from './core/java/java-init.js';

// Private staging worker. The parent supplies a clean Git environment and empty
// template/hooks directory. This callback unlocks generation only; it is never
// user approval, and the parent replaces its receipt before promotion.
const [root, version] = process.argv.slice(2);
let result;
try {
  result = await startJavaInit({
    root,
    version,
    userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
  });
} catch (error) {
  result = { ok: false, code: 'INIT_WORKER_FAILED', message: error.message };
}
process.stdout.write(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
