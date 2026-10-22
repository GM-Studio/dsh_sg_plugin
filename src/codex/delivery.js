import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from './core/artifact-store.js';
import { hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';
import { validateDeliveryRecord } from './project-model.js';
import { checkedProjectRoot } from './project-state.js';
import { validateDeliveryRecordV3 } from './control/delivery-controlled.js';

const failure = (code, message) => ({ ok: false, code, message });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 4000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const DATE = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

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
      `safe.directory=${gitSafeDirectory(root)}`,
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
  if (delivery?.schemaVersion === 3)
    return persistDeliveryV3({ projectRoot, delivery, internal, customer, write, createTag });
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

export function persistDeliveryV3({
  projectRoot,
  delivery,
  internal = {},
  customer = {},
  write = true,
  createTag = true,
} = {}) {
  const internalPack = renderInternalPack({ delivery, internal });
  const customerPack = renderCustomerPack({ delivery, customer });
  const finalRecord =
    delivery?.packs === null
      ? {
          ...delivery,
          packs: {
            internalHash: hashValue(internalPack),
            customerHash: hashValue(customerPack),
          },
        }
      : delivery;
  const checked = validateDeliveryRecordV3(finalRecord);
  if (!checked.ok) return checked;
  if (!write)
    return {
      ok: true,
      delivery: finalRecord,
      internal: internalPack,
      customer: customerPack,
    };
  let root;
  try {
    root = checkedProjectRoot(projectRoot);
  } catch (error) {
    return failure(error.code || 'DELIVERY_WRITE_FAILED', error.message);
  }
  const directory = `.specgate/codex/deliveries/${finalRecord.deliveryId}`;
  const store = createArtifactStore({ projectRoot: root });
  const recordWrite = store.writeJson(`${directory}/record.json`, finalRecord);
  if (!recordWrite.ok) return recordWrite;
  const internalWrite = store.writeText(`${directory}/internal.md`, internalPack);
  if (!internalWrite.ok) return internalWrite;
  const customerWrite = store.writeText(`${directory}/customer.md`, customerPack);
  if (!customerWrite.ok) return customerWrite;
  if (createTag) {
    const tagged = ensureTag(root, finalRecord);
    if (!tagged.ok) return tagged;
  }
  return {
    ok: true,
    delivery: finalRecord,
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
    const store = createArtifactStore({ projectRoot: root });
    const read = store.readJson(`.specgate/codex/deliveries/${deliveryId}/record.json`);
    if (!read.ok) return read;
    const checked =
      read.value?.schemaVersion === 3
        ? validateDeliveryRecordV3(read.value)
        : validateDeliveryRecord(read.value);
    if (!checked.ok) return checked;
    if (read.value.schemaVersion !== 3) return { ...read, delivery: read.value };
    const acceptancePath = `.specgate/codex/deliveries/${deliveryId}/customer-acceptance.json`;
    if (!fs.existsSync(path.join(root, acceptancePath))) return { ...read, delivery: read.value };
    const acceptanceRead = store.readJson(acceptancePath);
    if (!acceptanceRead.ok) return acceptanceRead;
    const acceptance = acceptanceRead.value;
    if (
      !object(acceptance) ||
      acceptance.schemaVersion !== 1 ||
      acceptance.deliveryId !== deliveryId ||
      acceptance.status !== 'accepted' ||
      acceptance.baseRecordHash !== read.hash ||
      !text(acceptance.actorId, 256) ||
      !text(acceptance.source, 64) ||
      acceptance.authLevel !== 'step-up' ||
      !DATE(acceptance.at) ||
      !text(acceptance.evidence, 1024)
    )
      return failure('CUSTOMER_ACCEPTANCE_INVALID', 'Customer acceptance evidence is invalid');
    const delivery = {
      ...read.value,
      releaseState: 'customer-accepted',
      customerAcceptance: {
        status: 'accepted',
        actorId: acceptance.actorId,
        source: acceptance.source,
        at: acceptance.at,
        evidence: acceptance.evidence,
      },
    };
    const finalCheck = validateDeliveryRecordV3(delivery);
    return finalCheck.ok
      ? { ...read, delivery, acceptancePath, acceptanceHash: acceptanceRead.hash }
      : finalCheck;
  } catch (error) {
    return failure(error.code || 'DELIVERY_READ_FAILED', error.message);
  }
}

export function findLatestDeliveryRecord({ projectRoot } = {}) {
  try {
    const root = checkedProjectRoot(projectRoot);
    const deliveriesRoot = path.join(root, '.specgate', 'codex', 'deliveries');
    if (!fs.existsSync(deliveriesRoot))
      return failure('DELIVERY_NOT_FOUND', 'No DeliveryRecord exists');
    const candidates = [];
    for (const entry of fs.readdirSync(deliveriesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)) continue;
      const read = readDeliveryRecord({ projectRoot: root, deliveryId: entry.name });
      if (!read.ok) continue;
      candidates.push({
        ok: true,
        deliveryId: read.delivery.deliveryId,
        delivery: read.delivery,
        recordHash: read.hash,
        acceptanceHash: read.acceptanceHash || null,
      });
    }
    candidates.sort(
      (left, right) =>
        Date.parse(right.delivery.approvedAt) - Date.parse(left.delivery.approvedAt) ||
        right.delivery.deliveryId.localeCompare(left.delivery.deliveryId),
    );
    return (
      candidates[0] ||
      failure('DELIVERY_NOT_FOUND', 'No readable DeliveryRecord exists for the project')
    );
  } catch (error) {
    return failure(error.code || 'DELIVERY_READ_FAILED', error.message);
  }
}

export function recordCustomerAcceptance({
  projectRoot,
  deliveryId,
  expectedRecordHash = null,
  actorId,
  source,
  authLevel,
  evidence,
  at = new Date().toISOString(),
} = {}) {
  try {
    const root = checkedProjectRoot(projectRoot);
    if (
      typeof deliveryId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deliveryId) ||
      !text(actorId, 256) ||
      !['web', 'feishu', 'cli', 'api'].includes(source) ||
      authLevel !== 'step-up' ||
      !text(evidence, 1024) ||
      !DATE(at)
    )
      return failure('CUSTOMER_ACCEPTANCE_INVALID', 'A trusted acceptance Decision is required');
    const store = createArtifactStore({ projectRoot: root });
    const basePath = `.specgate/codex/deliveries/${deliveryId}/record.json`;
    const base = store.readJson(basePath);
    if (!base.ok) return base;
    if (expectedRecordHash && base.hash !== expectedRecordHash)
      return failure(
        'DELIVERY_ARTIFACT_CHANGED',
        'DeliveryRecord changed after it was linked to the WorkItem',
      );
    const checked = validateDeliveryRecordV3(base.value);
    if (!checked.ok) return checked;
    const existingPath = `.specgate/codex/deliveries/${deliveryId}/customer-acceptance.json`;
    if (fs.existsSync(path.join(root, existingPath))) {
      const existing = store.readJson(existingPath);
      if (
        existing.ok &&
        existing.value?.deliveryId === deliveryId &&
        existing.value?.status === 'accepted' &&
        existing.value?.actorId === actorId &&
        existing.value?.source === source &&
        existing.value?.authLevel === 'step-up' &&
        existing.value?.evidence === evidence &&
        existing.value?.baseRecordHash === base.hash
      ) {
        return {
          ok: true,
          duplicate: true,
          acceptance: existing.value,
          acceptanceHash: existing.hash,
          delivery: {
            ...base.value,
            releaseState: 'customer-accepted',
            customerAcceptance: {
              status: 'accepted',
              actorId: existing.value.actorId,
              source: existing.value.source,
              at: existing.value.at,
              evidence: existing.value.evidence,
            },
          },
        };
      }
      return failure('CUSTOMER_ALREADY_ACCEPTED', 'Delivery already has customer acceptance');
    }
    const acceptance = {
      schemaVersion: 1,
      deliveryId,
      status: 'accepted',
      actorId,
      source,
      authLevel,
      at,
      evidence,
      baseRecordHash: base.hash,
    };
    const written = store.writeJson(
      `.specgate/codex/deliveries/${deliveryId}/customer-acceptance.json`,
      acceptance,
    );
    if (!written.ok) return written;
    return {
      ok: true,
      duplicate: false,
      acceptance,
      acceptanceHash: written.hash,
      delivery: {
        ...base.value,
        releaseState: 'customer-accepted',
        customerAcceptance: {
          status: 'accepted',
          actorId,
          source,
          at,
          evidence,
        },
      },
    };
  } catch (error) {
    return failure(error.code || 'CUSTOMER_ACCEPTANCE_FAILED', error.message);
  }
}
