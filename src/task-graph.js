import { createHash } from 'node:crypto';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function splitDependencies(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parse the SpecGate task list. A task may carry:
 *
 *   - [ ] T1 实现登录接口 [P]
 *   - [ ] T2 实现登录页面 [P] depends: T1
 *   - [ ] T3 集成登录流程 role: reviewer
 *
 * No marker means serial execution; `[P]` opts into a parallel wave.
 */
export function parseTasks(text) {
  const tasks = [];
  let index = 0;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const match = rawLine.match(/^\s*-\s*\[([ xX])\]\s+(.*)$/);
    if (!match) continue;
    index += 1;

    let body = match[2].trim();
    const done = match[1].toLowerCase() === 'x';
    const parallel = /(?:^|\s)\[P\](?:\s|$)/i.test(body);
    body = body.replace(/(?:^|\s)\[P\](?=\s|$)/gi, ' ').trim();

    const dependsMatch = body.match(/\bdepends(?:\s+on)?\s*:\s*([^\n]+)/i);
    const depends = dependsMatch ? splitDependencies(dependsMatch[1]) : [];
    body = body.replace(/\bdepends(?:\s+on)?\s*:\s*[^\n]+/gi, ' ').trim();

    const roleMatch = body.match(/\brole\s*:\s*([a-z][a-z0-9-]*)/i);
    const role = roleMatch ? roleMatch[1].toLowerCase() : null;
    body = body.replace(/\brole\s*:\s*[a-z][a-z0-9-]*/gi, ' ').trim();

    const filesMatch = body.match(/\bfiles\s*:\s*([^\n]+)/i);
    const files = filesMatch
      ? filesMatch[1]
          .split(/[,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    body = body.replace(/\bfiles\s*:\s*[^\n]+/gi, ' ').trim();

    const idMatch = body.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s+/);
    const id = idMatch ? idMatch[1] : `task-${index}`;
    if (idMatch) body = body.slice(idMatch[0].length).trim();

    const title = body.replace(/\s+/g, ' ').trim();
    tasks.push({
      id,
      title,
      text: title,
      done,
      parallel,
      depends,
      role,
      files,
      line: rawLine,
      contentHash: sha256(
        JSON.stringify({ id, title, depends: [...depends].sort(), role, files: [...files].sort() }),
      ),
    });
  }
  return tasks;
}

/**
 * Build execution waves. Without any `[P]` marker the plan is strictly serial.
 * A non-parallel task always gets its own wave, even when other tasks in the
 * same file opted into parallelism.
 */
export function buildWaves(tasks, maxConcurrency = 4) {
  const limit = Math.max(1, Number(maxConcurrency) || 4);
  const open = tasks.filter((task) => !task.done);
  if (open.length === 0) return [];

  const anyParallel = open.some((task) => task.parallel);
  if (!anyParallel) {
    const completed = new Set(tasks.filter((task) => task.done).map((task) => task.id));
    const waves = [];
    for (const task of open) {
      const missing = task.depends.filter((dependency) => !completed.has(dependency));
      if (missing.length > 0) {
        throw new Error(
          `任务依赖无法满足：${task.id} 依赖 ${missing.join('、')}；请检查 tasks.md 的顺序、[P] 或 depends 标记。`,
        );
      }
      waves.push([task]);
      completed.add(task.id);
    }
    return waves;
  }

  const completed = new Set(tasks.filter((task) => task.done).map((task) => task.id));
  const remaining = [...open];
  const waves = [];

  while (remaining.length > 0) {
    const wave = [];
    let blocked = null;
    for (let index = 0; index < remaining.length && wave.length < limit; index += 1) {
      const task = remaining[index];
      const ready = task.depends.every((dependency) => completed.has(dependency));
      if (!ready) {
        blocked ??= task;
        continue;
      }
      if (!task.parallel) {
        if (wave.length === 0) {
          wave.push(task);
          remaining.splice(index, 1);
        }
        break;
      }
      wave.push(task);
      remaining.splice(index, 1);
      index -= 1;
    }

    if (wave.length === 0) {
      if (blocked) {
        throw new Error(
          `任务依赖无法满足：${blocked.id} 依赖 ${blocked.depends.join('、')}；请检查 tasks.md 是否存在环或缺失任务。`,
        );
      }
      throw new Error('任务依赖图无法推进；请检查 tasks.md 的 [P] / depends 标记。');
    }

    for (const task of wave) completed.add(task.id);
    waves.push(wave);
  }

  return waves;
}
