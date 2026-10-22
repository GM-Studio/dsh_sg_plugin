import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from './core/artifact-store.js';
import { hashValue } from './events.js';
import { validateDeliveryRecord } from './project-model.js';
import { checkedProjectRoot } from './project-state.js';

const failure = (code, message) => ({ ok: false, code, message });

function redact(value) {
  return String(value || '')
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<local-path>')
    .replace(/\/(?:tmp|home|Users|opt|var|private)\/[^\s"'`]+/g, '<local-path>')
    .replace(
      /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]{6,})/gi,
      '<redacted>',
    );
}

function list(values) {
  return Array.isArray(values) && values.length > 0
    ? values.map((entry) => `- ${entry}`).join('\n')
    : '- None';
}

export function createDeliveryRecord({
  deliveryId,
  projectId,
  changeId,
  parentDeliveryId = null,
  baselineCommit,
  deliveryCommit,
  environmentFingerprint,
  reviewMode,
  acceptedAt = new Date().toISOString(),
  acceptance,
  evidence,
  knownIssues = [],
  rollback,
  push = { requested: false, remoteUrl: null, status: 'not-requested' },
  tag,
  state = 'delivery-accepted',
} = {}) {
  const stableId =
    deliveryId ||
    `delivery-${hashValue({
      projectId,
      changeId,
      deliveryCommit,
      parentDeliveryId,
    }).slice(0, 16)}`;
  const delivery = {
    schemaVersion: 2,
    deliveryId: stableId,
    projectId,
    changeId,
    parentDeliveryId,
    baselineCommit,
    deliveryCommit,
    tag: tag || `specgate-delivery-${stableId}`,
    state,
    environmentFingerprint,
    reviewMode,
    acceptedAt,
    acceptance,
    evidence,
    knownIssues,
    rollback,
    push,
  };
  const checked = validateDeliveryRecord(delivery);
  return checked.ok ? { ok: true, delivery } : checked;
}

export function renderInternalPack({ delivery, internal } = {}) {
  return [
    `# Internal delivery evidence: ${delivery.deliveryId}`,
    '',
    `- Project: ${delivery.projectId}`,
    `- Change: ${delivery.changeId}`,
    `- Commit: ${delivery.deliveryCommit}`,
    `- Environment: ${delivery.environmentFingerprint}`,
    `- Review mode: ${delivery.reviewMode}`,
    '',
    '## Acceptance',
    list(delivery.acceptance),
    '',
    '## Evidence',
    list(delivery.evidence),
    '',
    '## Internal details',
    '```json',
    JSON.stringify(internal || {}, null, 2),
    '```',
    '',
  ].join('\n');
}

export function renderCustomerPack({ delivery, customer = {} } = {}) {
  return [
    `# ${redact(customer.title || `Delivery ${delivery.deliveryId}`)}`,
    '',
    redact(customer.summary || 'Customer delivery summary is unavailable.'),
    '',
    '## Included',
    list(delivery.acceptance.map(redact)),
    '',
    '## Verification',
    list((customer.verification || []).map(redact)),
    '',
    '## Known issues',
    list((customer.knownIssues || delivery.knownIssues).map(redact)),
    '',
    '## Upgrade',
    redact(customer.upgrade || 'Apply the accepted delivery commit.'),
    '',
    '## Rollback',
    redact(customer.rollback?.code || delivery.rollback.code),
    '',
    redact(customer.rollback?.data || delivery.rollback.data),
    '',
    redact(customer.rollback?.forwardFix || delivery.rollback.forwardFix),
    '',
  ].join('\n');
}

function git(root, args) {
  return spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${root}`,
      '-c',
      'core.filemode=false',
      '-c',
      'core.autocrlf=true',
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
        ),
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      timeout: 30000,
    },
  );
}

function ensureTag(root, delivery) {
  const existing = git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${delivery.tag}`]);
  if (existing.status === 0) {
    return existing.stdout.trim() === delivery.deliveryCommit
      ? { ok: true, created: false }
      : failure('DELIVERY_TAG_CONFLICT', 'Existing local tag points to another commit');
  }
  const created = git(root, [
    '-c',
    'user.name=SpecGate',
    '-c',
    'user.email=specgate@local',
    'tag',
    '-a',
    delivery.tag,
    '-m',
    `SpecGate delivery ${delivery.deliveryId}`,
    delivery.deliveryCommit,
  ]);
  return created.status === 0
    ? { ok: true, created: true }
    : failure('DELIVERY_TAG_FAILED', created.stderr || 'Local delivery tag failed');
}

export function persistDelivery({
  projectRoot,
  delivery,
  internal = {},
  customer = {},
  write = true,
  createTag = true,
} = {}) {
  const checked = validateDeliveryRecord(delivery);
  if (!checked.ok) return checked;
  const internalPack = renderInternalPack({ delivery, internal });
  const customerPack = renderCustomerPack({ delivery, customer });
  if (!write) return { ok: true, internal: internalPack, customer: customerPack };
  let root;
  try {
    root = checkedProjectRoot(projectRoot);
  } catch (error) {
    return failure(error.code || 'DELIVERY_WRITE_FAILED', error.message);
  }
  const directory = `.specgate/codex/deliveries/${delivery.deliveryId}`;
  const store = createArtifactStore({ projectRoot: root });
  const recordWrite = store.writeJson(`${directory}/record.json`, delivery);
  if (!recordWrite.ok) return recordWrite;
  const internalWrite = store.writeText(`${directory}/internal.md`, internalPack);
  if (!internalWrite.ok) return internalWrite;
  const customerWrite = store.writeText(`${directory}/customer.md`, customerPack);
  if (!customerWrite.ok) return customerWrite;
  if (createTag) {
    const tagged = ensureTag(root, delivery);
    if (!tagged.ok) return tagged;
  }
  return {
    ok: true,
    delivery,
    directory,
    recordHash: recordWrite.hash,
    internalHash: internalWrite.hash,
    customerHash: customerWrite.hash,
  };
}

export function readDeliveryRecord({ projectRoot, deliveryId } = {}) {
  try {
    if (typeof deliveryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deliveryId))
      return failure('INVALID_ARGUMENT', 'A valid deliveryId is required');
    const root = checkedProjectRoot(projectRoot);
    const read = createArtifactStore({ projectRoot: root }).readJson(
      `.specgate/codex/deliveries/${deliveryId}/record.json`,
    );
    if (!read.ok) return read;
    const checked = validateDeliveryRecord(read.value);
    return checked.ok ? { ...read, delivery: read.value } : checked;
  } catch (error) {
    return failure(error.code || 'DELIVERY_READ_FAILED', error.message);
  }
}
