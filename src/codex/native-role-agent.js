import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue } from './events.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MAX_PROMPT_BYTES = 512 * 1024;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function writableGitDirectory(root, worktree, branch) {
  if (!fs.existsSync(path.join(worktree, '.git'))) return null;
  const git = (cwd, args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const common = (cwd) =>
    fs.realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const directory = common(root);
  if (
    directory !== common(worktree) ||
    fs.realpathSync(git(worktree, ['rev-parse', '--show-toplevel'])) !==
      fs.realpathSync(worktree) ||
    git(worktree, ['symbolic-ref', '--short', 'HEAD']) !== branch ||
    !fs.lstatSync(directory).isDirectory() ||
    (fs.existsSync(path.join(PLUGIN_ROOT, '.git')) &&
      directory === fs.realpathSync(path.join(PLUGIN_ROOT, '.git')))
  )
    throw new Error('The assigned worktree must belong to the bound product Git repository');
  const registered = git(root, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .some((line) => {
      if (!line.startsWith('worktree ')) return false;
      try {
        return fs.realpathSync(line.slice(9)) === fs.realpathSync(worktree);
      } catch {
        return false;
      }
    });
  if (!registered) throw new Error('The assigned worktree is not registered');
  return directory;
}

const ROLE_AGENTS = Object.freeze({
  'test-designer': {
    name: 'specgate_test_designer',
    file: 'specgate_test_designer.toml',
    title: 'SpecGate Test Designer',
  },
  frontend: {
    name: 'specgate_implementer',
    file: 'specgate_implementer.toml',
    title: 'SpecGate Implementer',
  },
  backend: {
    name: 'specgate_implementer',
    file: 'specgate_implementer.toml',
    title: 'SpecGate Implementer',
  },
  review: {
    name: 'specgate_reviewer',
    file: 'specgate_reviewer.toml',
    title: 'SpecGate Reviewer',
  },
});

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}

function readAgentConfig(projectRoot, role) {
  const agent = ROLE_AGENTS[role];
  if (!agent)
    return failure('ROLE_AGENT_UNKNOWN', 'No native Codex agent is configured for this role');
  const candidates = [
    path.join(projectRoot, '.codex', 'agents', agent.file),
    path.join(PLUGIN_ROOT, 'assets', 'codex', 'agents', agent.file),
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) continue;
      const instructions = fs.readFileSync(candidate, 'utf8');
      if (!instructions.trim()) continue;
      return { ok: true, agent, path: candidate, instructions };
    } catch {
      // Try the next trusted configuration location.
    }
  }
  return failure(
    'ROLE_AGENT_CONFIG_MISSING',
    `The real ${agent.name} configuration was not found in the project or plugin assets`,
  );
}

function roleTask(role, challenge) {
  if (role === 'review')
    return [
      'Read the fixed integration commit, frozen acceptance criteria, diff and quality evidence without changing any files or Git references.',
      'Return exactly one JSON object with mode, reviewedCommit, qualityHash, summary, verdict and findings.',
      'Each finding must contain id, severity, file, changedLine, acIds, evidence from that line and recommendation.',
      'severity must be exactly one of P0, P1, P2 or P3.',
      'A blocker about frozen evidence may cite a .specgate/codex/** evidence file with changedLine 1 and quote evidence from that artifact.',
      'Use verdict fail for blocking findings in the selected mode; do not claim independent verification that did not run.',
    ];
  if (role === 'test-designer') {
    return [
      'Execute the complete test-design task now. Do not return a plan, acknowledgement or empty summary.',
      'Create specgate-tests.json at the assigned worktree root and all executable test assets under specgate-tests/.',
      'The runner must be specgate-tests/runner.mjs, map every acceptance criterion to at least one case, and emit the required JSON report.',
      'The report must contain cases: [{id: exact frozen case ID, status: pass|fail|skip}]; status must be exactly pass, fail or skip. Both red and green use this schema, actual failures exit 1, infrastructure/setup errors must not masquerade as a red test failure.',
      'Changed executable configuration files also require coverage evidence; do not restrict changed-line coverage to business source directories or discard changed build configuration. Coverage must come from actual instrumentation and reconcile all original business sources.',
      'Run the repository formatter, lint and applicable checks on generated test sources.',
      'Only specgate-tests.json and files under specgate-tests/ may be changed.',
      'Commit every test asset in the assigned worktree. Return the exact commit, test counts, AC coverage and unresolved test risks.',
    ];
  }
  return [
    `Execute the complete ${role} implementation task now. Do not return a plan, acknowledgement or empty summary.`,
    `For ${role}, change only files allowed by the frozen filePolicy; forbiddenFiles take precedence. Obey the frozen contract, model, tests and project conventions.`,
    'Do not modify frozen test assets or implementation owned by another role.',
    'Run focused checks that are available in the worktree.',
    `Commit the complete implementation on the assigned ${role} branch and leave the worktree clean.`,
    'Return the exact commit and a concise summary of implemented acceptance criteria and checks.',
  ];
}

export function buildNativeRolePrompt({ projectRoot, role, challenge, agentConfig }) {
  const assignment = {
    schemaVersion: 1,
    kind: 'specgate-native-role-assignment',
    agent: agentConfig.agent.name,
    role,
    projectRoot,
    operation: challenge.operation,
    changeId: challenge.changeId,
    worktree: challenge.worktree,
    branch: challenge.branch || null,
    freezeCommit: challenge.freezeCommit || challenge.baseCommit || null,
    previousCommit: challenge.previousCommit || null,
    graph: challenge.graph || challenge.plan || challenge.requirements || null,
    contract: challenge.contract || null,
    model: challenge.model || null,
    tests: challenge.tests || null,
    conventions: challenge.conventions || null,
    filePolicy: challenge.filePolicy || null,
    findings: challenge.findings || [],
    repairContext: challenge.repairContext || null,
    testDesign:
      challenge.testDesign || challenge.manifest
        ? {
            manifest: challenge.manifest || null,
            testRoot: challenge.testRoot || null,
          }
        : null,
    conflictPaths: challenge.conflictPaths || null,
    review:
      role === 'review'
        ? {
            mode: challenge.mode || null,
            integrationCommit: challenge.integrationCommit || null,
            qualityHash: challenge.qualityHash || null,
            quality: challenge.quality || null,
            redEvidence: challenge.redEvidence || null,
            diff: challenge.diff || null,
          }
        : null,
  };
  return [
    `You are the assigned ${agentConfig.agent.title}. This is a real, bounded task assignment from SpecGate.`,
    'The assignment below contains the task identifiers and frozen inputs. Work only in the assigned worktree.',
    '',
    '<specgate_assignment>',
    canonicalJson(assignment),
    '</specgate_assignment>',
    '',
    '<agent_configuration>',
    agentConfig.instructions,
    '</agent_configuration>',
    '',
    'Required execution:',
    ...roleTask(role, challenge).map((line) => `- ${line}`),
    '',
    role === 'review'
      ? 'A completion without a parseable structured report will be rejected by SpecGate.'
      : 'A completion without a new commit will be rejected by SpecGate. Do not claim completion before committing.',
  ].join('\n');
}

function extractSessionId(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const key of ['session_id', 'sessionId', 'thread_id', 'threadId']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  if (value.thread && typeof value.thread === 'object') {
    const nested = extractSessionId(value.thread, seen);
    if (nested) return nested;
  }
  for (const entry of Object.values(value)) {
    const nested = extractSessionId(entry, seen);
    if (nested) return nested;
  }
  return null;
}

function extractAgentMessage(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (value.type === 'agent_message' && typeof value.text === 'string' && value.text.trim())
    return value.text.trim();
  for (const key of ['item', 'message', 'response', 'result']) {
    const nested = extractAgentMessage(value[key], seen);
    if (nested) return nested;
  }
  return null;
}

function terminateProcessTree(child, platform = process.platform) {
  if (!child?.pid) return;
  if (platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on?.('error', () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // The close or timeout event remains the observable failure.
      }
    });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // The close or timeout event remains the observable failure.
  }
}

/**
 * Creates a real non-interactive Codex role provider. The complete assignment
 * and agent configuration are delivered through stdin so Windows command-line
 * limits cannot silently truncate the task.
 */
export function createNativeCodexRoleProvider({
  projectRoot,
  command,
  spawnImpl = spawn,
  terminate = terminateProcessTree,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
  env = process.env,
  clock = Date.now,
} = {}) {
  command ||= env.SPECGATE_CODEX_COMMAND || 'codex';
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot))
    throw new TypeError('An absolute project root is required');
  if (typeof command !== 'string' || !command) throw new TypeError('A Codex command is required');
  if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl must be a function');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('timeoutMs must be a positive integer');
  const root = fs.realpathSync(projectRoot);

  async function runRole(role, challenge = {}, { signal } = {}) {
    if (!ROLE_AGENTS[role])
      return failure('ROLE_AGENT_UNKNOWN', 'No native Codex agent is configured for this role');
    if (
      !text(challenge.changeId) ||
      !text(challenge.worktree) ||
      (role !== 'review' && !text(challenge.branch)) ||
      !path.isAbsolute(challenge.worktree)
    )
      return failure(
        'ROLE_ASSIGNMENT_INVALID',
        'The role assignment is missing its worktree context',
      );
    const worktree = path.resolve(challenge.worktree);
    if (!inside(root, worktree) || !fs.existsSync(worktree))
      return failure(
        'ROLE_WORKTREE_INVALID',
        'The role worktree is outside the project or missing',
      );
    if (signal?.aborted) return failure('CANCELLED', 'The role task was cancelled before start');
    const configured = readAgentConfig(root, role);
    if (!configured.ok) return configured;
    let gitDirectory;
    if (role !== 'review') {
      try {
        gitDirectory = writableGitDirectory(root, worktree, challenge.branch);
      } catch {
        return failure(
          'ROLE_WORKTREE_GIT_INVALID',
          'Cannot grant Git metadata access to an unregistered or foreign worktree',
        );
      }
    }
    const prompt = buildNativeRolePrompt({
      projectRoot: root,
      role,
      challenge,
      agentConfig: configured,
    });
    if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES)
      return failure(
        'ROLE_ASSIGNMENT_TOO_LARGE',
        'The complete role assignment exceeds the bounded stdin message limit',
        { promptBytes: Buffer.byteLength(prompt, 'utf8') },
      );
    const args = [
      'exec',
      '--json',
      '--color',
      'never',
      '--ephemeral',
      '--sandbox',
      role === 'review' ? 'read-only' : 'workspace-write',
      ...(gitDirectory ? ['--add-dir', gitDirectory] : []),
      '--cd',
      worktree,
      '--config',
      'approval_policy="never"',
      '--config',
      'mcp_servers={}',
      '--config',
      'plugins={}',
      '-',
    ];
    const childEnvironment = {
      ...env,
      SPECGATE_NATIVE_AGENTS: '0',
      SPECGATE_INTERACTIVE_APPROVAL: '0',
      SPECGATE_ROLE_AGENT: configured.agent.name,
      SPECGATE_ROLE_ASSIGNMENT_HASH: hashValue(prompt),
      GIT_AUTHOR_NAME: 'SpecGate Codex Agent',
      GIT_AUTHOR_EMAIL: 'specgate-agent@localhost',
      GIT_COMMITTER_NAME: 'SpecGate Codex Agent',
      GIT_COMMITTER_EMAIL: 'specgate-agent@localhost',
    };
    const startedAt = new Date(clock()).toISOString();
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(command, args, {
          cwd: worktree,
          env: childEnvironment,
          detached: platform !== 'win32',
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve(
          failure('ROLE_AGENT_START_FAILED', 'The native Codex role process could not start', {
            detail: String(error?.message || '').slice(0, 512),
            startedAt,
          }),
        );
        return;
      }
      let settled = false;
      let timedOut = false;
      let stdoutBuffer = '';
      let stderr = '';
      let parsedEvents = 0;
      let sessionId = null;
      let agentMessage = '';
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve({
          role,
          agent: configured.agent.name,
          assignmentHash: childEnvironment.SPECGATE_ROLE_ASSIGNMENT_HASH,
          promptBytes: Buffer.byteLength(prompt, 'utf8'),
          startedAt,
          finishedAt: new Date(clock()).toISOString(),
          parsedEvents,
          sessionId,
          stderrTail: stderr.slice(-16000),
          ...value,
        });
      };
      const abort = () => terminate(child, platform);
      const timer = setTimeout(() => {
        timedOut = true;
        abort();
      }, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      const consumeLine = (line) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          parsedEvents += 1;
          sessionId ||= extractSessionId(event);
          agentMessage = extractAgentMessage(event) || agentMessage;
        } catch {
          stderr = `${stderr}\nInvalid JSONL from Codex role agent`.slice(-MAX_CAPTURE_BYTES);
        }
      };
      child.stdout?.on('data', (chunk) => {
        stdoutBuffer += String(chunk);
        let newline;
        while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
          consumeLine(stdoutBuffer.slice(0, newline));
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
        }
        if (stdoutBuffer.length > MAX_CAPTURE_BYTES)
          stdoutBuffer = stdoutBuffer.slice(-MAX_CAPTURE_BYTES);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-MAX_CAPTURE_BYTES);
      });
      child.stdin?.on?.('error', () => {
        // A closed stdin is reported through the process exit code.
      });
      child.stdin?.end(prompt);
      child.on?.('error', (error) => {
        finish({
          ok: false,
          code: 'ROLE_AGENT_START_FAILED',
          message: 'The native Codex role process failed',
          detail: String(error?.message || '').slice(0, 512),
        });
      });
      child.on?.('close', (code, signalName) => {
        if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
        if (timedOut) {
          finish({
            ok: false,
            code: 'ROLE_AGENT_TIMEOUT',
            message: 'The native Codex role task exceeded its time limit',
            exitCode: code,
            signal: signalName,
          });
          return;
        }
        if (signal?.aborted) {
          finish({
            ok: false,
            code: 'CANCELLED',
            message: 'The native Codex role task was cancelled',
            exitCode: code,
            signal: signalName,
          });
          return;
        }
        if (code !== 0 || parsedEvents === 0) {
          finish({
            ok: false,
            code: 'ROLE_AGENT_EXECUTION_FAILED',
            message:
              code === 0
                ? 'The native Codex role process produced no machine events'
                : 'The native Codex role process failed',
            exitCode: code,
            signal: signalName,
          });
          return;
        }
        if (role === 'review') {
          let report;
          try {
            report = JSON.parse(agentMessage);
            if (!report || typeof report !== 'object' || Array.isArray(report))
              throw Error('Invalid report');
          } catch {
            finish({
              ok: false,
              code: 'REVIEW_REPORT_INVALID',
              message: 'Reviewer did not return one JSON report',
            });
            return;
          }
          finish({ ...report, ok: true, exitCode: code, signal: signalName });
          return;
        }
        finish({
          ok: true,
          summary: agentMessage || `${configured.agent.title} completed the assigned task`,
          exitCode: code,
          signal: signalName,
        });
      });
    });
  }

  return Object.freeze(
    Object.assign(runRole, {
      run: runRole,
      agentForRole: (role) => ROLE_AGENTS[role]?.name || null,
    }),
  );
}
