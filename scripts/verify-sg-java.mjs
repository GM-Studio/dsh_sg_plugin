import path from 'node:path';
import { startJavaInit } from '../src/v4/java-init.js';
// Development fixture only. Mock confirmation NEVER substitutes production host approval.
if (!process.argv[2]) throw new Error('Provide a fresh empty validation target');
const root = path.resolve(process.argv[2]);
const result = await startJavaInit({
  root,
  env: process.env,
  quality: {
    mode: process.argv.includes('--strict') ? 'strict' : 'lenient',
    generateOnly: process.argv.includes('--generate-only'),
  },
  userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
});
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
