import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const busy = () =>
  Object.assign(new Error('Another delivery operation owns the implementation worktree lease'), {
    code: 'IMPLEMENTATION_BUSY',
  });
const unsafe = () =>
  Object.assign(new Error('The implementation lease contains an unsafe path'), {
    code: 'UNSAFE_PATH',
  });

export async function withOperationLease(root, operation) {
  const directory = path.join(root, '.specgate/codex');
  for (const target of [path.join(root, '.specgate'), directory]) {
    if (!fs.existsSync(target)) fs.mkdirSync(target);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe();
  }
  const guard = path.join(directory, 'implementation-acquisition.lock');
  const lease = path.join(directory, 'implementation.lock');
  const ownerFile = path.join(lease, 'owner.json');
  const nonce = randomUUID();
  function guarded(action) {
    try {
      fs.mkdirSync(guard);
    } catch (error) {
      if (error.code === 'EEXIST') throw busy();
      throw error;
    }
    try {
      return action();
    } finally {
      fs.rmdirSync(guard);
    }
  }
  function owner() {
    const stat = fs.lstatSync(lease);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe();
    const file = fs.lstatSync(ownerFile);
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.size > 4096)
      throw unsafe();
    return JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  }
  guarded(() => {
    if (fs.existsSync(lease)) {
      let previous;
      try {
        previous = owner();
      } catch (error) {
        if (error.code === 'UNSAFE_PATH') throw error;
        throw busy();
      }
      if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw busy();
      try {
        process.kill(previous.pid, 0);
        throw busy();
      } catch (error) {
        if (error.code !== 'ESRCH') throw error.code === 'EPERM' ? busy() : error;
      }
      // Only reclaim a proven dead owner while holding the acquisition guard.
      fs.unlinkSync(ownerFile);
      fs.rmdirSync(lease);
    }
    fs.mkdirSync(lease);
    fs.writeFileSync(
      ownerFile,
      JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  });
  async function releaseLease() {
    const deadline = Date.now() + 1000;
    while (true) {
      try {
        guarded(() => {
          const current = owner();
          if (current.pid !== process.pid || current.nonce !== nonce) throw busy();
          fs.unlinkSync(ownerFile);
          fs.rmdirSync(lease);
        });
        break;
      } catch (error) {
        if (error.code !== 'IMPLEMENTATION_BUSY' || Date.now() >= deadline) throw error;
        await delay(10);
      }
    }
  }
  try {
    return await operation();
  } finally {
    await releaseLease();
  }
}
