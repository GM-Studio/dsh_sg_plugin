import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTENTION_STATES,
  DECISION_STATES,
  WORK_ITEM_STATES,
} from '../src/codex/core/control/persistence/state-machine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(
  path.join(root, 'src/codex/core/control/persistence/migrations/001-initial.sql'),
  'utf8',
);

const constraintValues = (name) => {
  const start = schema.indexOf(`CONSTRAINT ${name} CHECK`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = schema.indexOf('))', start);
  assert.notEqual(end, -1, `${name} must close`);
  return [...schema.slice(start, end).matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
};

test('schema state constraints include every reducer state', () => {
  assert.deepEqual(constraintValues('chk_work_item_state'), WORK_ITEM_STATES);
  assert.deepEqual(constraintValues('chk_attention_status'), ATTENTION_STATES);
  assert.deepEqual(constraintValues('chk_decision_status'), DECISION_STATES);
});

test('schema avoids reserved and stale table references', () => {
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS run\b/);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS session\b/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS execution_run\b/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_session\b/);
  assert.match(schema, /REFERENCES execution_run \(run_id\)/);
  assert.doesNotMatch(schema, /REFERENCES run \(run_id\)/);
});

test('schema enforces concurrency and idempotency primitives', () => {
  assert.match(schema, /uq_lease_project_active/);
  assert.match(schema, /GENERATED ALWAYS AS/);
  assert.match(schema, /UNIQUE KEY uq_decision_idempotency \(idempotency_key\)/);
  assert.match(schema, /UNIQUE KEY uq_notification_dedupe \(dedupe_key\)/);
  assert.match(schema, /PRIMARY KEY \(event_id\)/);
  assert.match(schema, /KEY idx_evidence_payload_hash/);
});

test('Decision timestamps distinguish recording from consumption', () => {
  const decision = schema.slice(
    schema.indexOf('CREATE TABLE IF NOT EXISTS decision'),
    schema.indexOf('CREATE TABLE IF NOT EXISTS evidence_event'),
  );
  assert.match(decision, /status VARCHAR\(32\) NOT NULL DEFAULT 'RECORDED'/);
  assert.match(decision, /consumed_at DATETIME\(3\) NULL/);
  assert.match(decision, /applied_at DATETIME\(3\) NULL/);
});
