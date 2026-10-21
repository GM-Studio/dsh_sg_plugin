import fs from 'node:fs';
import path from 'node:path';

const output = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!output)
  throw new Error('Usage: node scripts/build-customer-test-assets.mjs <test-assets.json>');

const read = (relative) => fs.readFileSync(path.resolve('assets/e2e/customer', relative), 'utf8');
const backend = 'backend/src/test/java/com/example/tasks/CustomerApiTest.java';
const frontend = 'frontend/test/customer-panel.test.ts';
const assets = {
  role: 'test',
  cases: [
    {
      id: 'CASE-AC-1',
      acIds: ['AC-1'],
      description: 'Customer JSON CRUD persists all fields.',
      codeFiles: [backend],
    },
    {
      id: 'CASE-AC-2',
      acIds: ['AC-2'],
      description: 'Customer validation rejects duplicate email and invalid status.',
      codeFiles: [backend],
    },
    {
      id: 'CASE-AC-3',
      acIds: ['AC-3'],
      description: 'Customer summary and filtered list reconcile counts.',
      codeFiles: [backend],
    },
    {
      id: 'CASE-AC-4',
      acIds: ['AC-4'],
      description: 'Vue customer panel filters, creates, edits and deletes customers.',
      codeFiles: [frontend],
    },
  ],
  code: {
    [backend]: read('backend/CustomerApiTest.java'),
    [frontend]: read('frontend/customer-panel.fixture.ts'),
    'runner.mjs': read('runner.mjs'),
  },
  fixtures: {
    'fixtures/customer.json':
      '{"id":1,"name":"Acme Buyer","email":"buyer@example.com","company":"Acme","status":"ACTIVE","notes":"Important account"}\n',
  },
  coverage: { lines: 80, branches: 70 },
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(assets, null, 2) + '\n');
