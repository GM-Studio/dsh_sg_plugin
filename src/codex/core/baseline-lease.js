import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isProcessAlive } from './lock.js';

export function baselineProcessAlive(pid) {
  if (!isProcessAlive(pid)) return false;
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (/^[ZX]/.test(stat.slice(stat.lastIndexOf(')') + 2))) return false;
    } catch {
      /* permission uncertainty remains alive */
    }
  }
  return true;
}

const invalid = (message) => Object.assign(new Error(message), { code: 'BASELINE_LEASE_INVALID' });
export function readLeaseJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024)
    throw invalid('Unsafe baseline ownership record');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw invalid('Unreadable baseline ownership record; retained');
  }
}
export function writeLeaseJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temporary, file);
        break;
      } catch (error) {
        if (attempt >= 19 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export function inspectBaselineLease(directory) {
  if (!fs.existsSync(directory)) return null;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw invalid('Unsafe baseline lease directory');
  const ownerFile = path.join(directory, 'owner.json');
  let owner;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      owner = readLeaseJson(ownerFile);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!fs.existsSync(directory)) return null;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!owner) throw invalid('Baseline ownership publication is incomplete; retained');
  if (
    !/^[a-f0-9-]{36}$/.test(owner.token || '') ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0
  )
    throw invalid('Incomplete baseline ownership record; no automatic reclamation');
  const workerFile = path.join(directory, 'worker.json');
  const worker = fs.existsSync(workerFile) ? readLeaseJson(workerFile) : null;
  if (
    worker &&
    (worker.token !== owner.token || !Number.isSafeInteger(worker.pid) || worker.pid <= 0)
  )
    throw invalid('Invalid baseline worker ownership');
  const commandFile = path.join(directory, 'command.json');
  const command = fs.existsSync(commandFile) ? readLeaseJson(commandFile) : null;
  if (command && command.token !== owner.token) throw invalid('Invalid baseline child ownership');
  const childAlive =
    command && (command.pid ? baselineProcessAlive(command.pid) : !command.stopped);
  const ownerAlive =
    owner.host && owner.host !== os.hostname()
      ? true
      : baselineProcessAlive(worker?.pid || owner.pid);
  return {
    ...owner,
    workerPid: worker?.pid || null,
    alive: ownerAlive || !!childAlive,
    ownerAlive,
    childAlive: !!childAlive,
  };
}
function guarded(directory, token, operation) {
  const guard = `${directory}.guard-${token}`;
  let locked = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      fs.mkdirSync(guard);
      locked = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  if (!locked)
    throw Object.assign(new Error('Baseline ownership is changing; retry without deleting state'), {
      code: 'BASELINE_LEASE_BUSY',
    });
  try {
    return operation();
  } finally {
    fs.rmdirSync(guard);
  }
}
export function acquireBaselineLease(directory, description, recover) {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const attempt = () => {
    try {
      fs.mkdirSync(directory);
    } catch (error) {
      if (error.code === 'EEXIST') return null;
      throw error;
    }
    const owner = { ...description, host: os.hostname(), pid: process.pid, token: randomUUID() };
    writeLeaseJson(path.join(directory, 'owner.json'), owner);
    return { ...owner, directory };
  };
  let lease = attempt();
  if (lease) return { ok: true, lease };
  const observed = inspectBaselineLease(directory);
  if (!observed) {
    lease = attempt();
    return lease ? { ok: true, lease } : { ok: false, owner: inspectBaselineLease(directory) };
  }
  if (observed.alive) return { ok: false, owner: observed };
  guarded(directory, observed.token, () => {
    const current = inspectBaselineLease(directory);
    if (!current || current.token !== observed.token || current.alive) return;
    recover(current);
    fs.rmSync(directory, { recursive: true });
  });
  lease = attempt();
  return lease ? { ok: true, lease } : { ok: false, owner: inspectBaselineLease(directory) };
}
export function claimBaselineWorker(lease, pid = process.pid) {
  return guarded(lease.directory, lease.token, () => {
    const current = inspectBaselineLease(lease.directory);
    if (
      !current ||
      current.token !== lease.token ||
      (current.workerPid && current.workerPid !== pid)
    )
      throw invalid('Baseline ownership changed before worker startup');
    const file = path.join(lease.directory, 'worker.json');
    if (!fs.existsSync(file)) writeLeaseJson(file, { token: lease.token, pid });
  });
}
export function observeBaselineProcess(lease, event) {
  const current = inspectBaselineLease(lease.directory);
  if (
    !current ||
    current.token !== lease.token ||
    (current.workerPid || current.pid) !== process.pid
  )
    throw invalid('Only the current baseline owner can record child processes');
  writeLeaseJson(path.join(lease.directory, 'command.json'), { ...event, token: lease.token });
}
export function observeSupervisedBaselineProcess(lease, stopped = false) {
  return guarded(lease.directory, lease.token, () => {
    const current = inspectBaselineLease(lease.directory);
    const file = path.join(lease.directory, 'command.json');
    const command = fs.existsSync(file) ? readLeaseJson(file) : null;
    if (
      !current ||
      current.token !== lease.token ||
      !command ||
      (command.pid && command.pid !== process.pid)
    )
      throw invalid('Baseline command ownership changed before execution');
    writeLeaseJson(file, { ...command, pid: process.pid, stopped });
  });
}
export function releaseBaselineLease(lease) {
  return guarded(lease.directory, lease.token, () => {
    const current = inspectBaselineLease(lease.directory);
    if (!current || current.token !== lease.token) return false;
    if ((current.workerPid || current.pid) !== process.pid || current.childAlive) return false;
    fs.rmSync(lease.directory, { recursive: true });
    return true;
  });
}
