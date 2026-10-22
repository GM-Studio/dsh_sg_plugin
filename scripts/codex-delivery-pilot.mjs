import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { previewInit, executeInit } from '../src/codex/init.js';
import { verifyProject } from '../src/codex/verify.js';
import { recordNewProjectBaseline, loadProjectReadiness } from '../src/codex/project-new.js';
import { assessVerification } from '../src/codex/verification.js';
import { createDeliveryRecord, persistDelivery } from '../src/codex/delivery.js';
import { createIncrementalPlan } from '../src/codex/incremental.js';
import { buildChangeContract } from '../src/codex/change-policy.js';
import { hashValue } from '../src/codex/events.js';
import { commandSpec } from '../src/codex/core/java/verify-evidence.js';

const PRESETS = ['jdk17-boot3.5', 'jdk21-boot3.5', 'jdk21-boot4.0'];
const SCENARIOS = ['feature-stats', 'modify-completion-percent', 'fix-zero-rate'];

const JAVA_TEST = `package com.specgate.tasks;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.specgate.tasks.entity.Task;
import com.specgate.tasks.repository.TaskRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:stats;DB_CLOSE_DELAY=-1"
        })
@AutoConfigureMockMvc
class TaskStatsApiTest {
    @Autowired private MockMvc mvc;
    @Autowired private TaskRepository repository;

    @BeforeEach
    void cleanTasks() {
        repository.deleteAll();
    }

    @Test
    void statsCountsTasksByCompletion() throws Exception {
        repository.save(new Task("One", false));
        repository.save(new Task("Two", true));
        repository.save(new Task("Three", true));

        mvc.perform(get("/api/tasks/stats").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(3))
                .andExpect(jsonPath("$.data.completed").value(2))
                .andExpect(jsonPath("$.data.inProgress").value(1));
    }
}
`;

const JAVA_TEST_WITH_RATE = JAVA_TEST.replace(
  '.andExpect(jsonPath("$.data.inProgress").value(1));',
  `.andExpect(jsonPath("$.data.inProgress").value(1))
                .andExpect(jsonPath("$.data.completionPercent").value(66));`,
);

const JAVA_TEST_WITH_ZERO = JAVA_TEST_WITH_RATE.replace(
  `    }
}
`,
  `    }

    @Test
    void emptyRepositoryReturnsZeroCompletionRate() throws Exception {
        mvc.perform(get("/api/tasks/stats").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.completed").value(0))
                .andExpect(jsonPath("$.data.inProgress").value(0))
                .andExpect(jsonPath("$.data.completionPercent").value(0));
    }
}
`,
);

const STATS_VO = `package com.specgate.tasks.vo;

public class TaskStatsVO {
    private final long total;
    private final long completed;
    private final long inProgress;

    public TaskStatsVO(long total, long completed, long inProgress) {
        this.total = total;
        this.completed = completed;
        this.inProgress = inProgress;
    }

    public long getTotal() {
        return total;
    }

    public long getCompleted() {
        return completed;
    }

    public long getInProgress() {
        return inProgress;
    }
}
`;

const STATS_VO_WITH_RATE = `package com.specgate.tasks.vo;

public class TaskStatsVO {
    private final long total;
    private final long completed;
    private final long inProgress;
    private final int completionPercent;

    public TaskStatsVO(long total, long completed, long inProgress) {
        this.total = total;
        this.completed = completed;
        this.inProgress = inProgress;
        this.completionPercent =
                total == 0 ? 0 : (int) Math.floor((completed * 100.0) / total);
    }

    public long getTotal() {
        return total;
    }

    public long getCompleted() {
        return completed;
    }

    public long getInProgress() {
        return inProgress;
    }

    public int getCompletionPercent() {
        return completionPercent;
    }
}
`;

const STATS_VO_BROKEN_ZERO = STATS_VO_WITH_RATE.replace(
  'total == 0 ? 0 : (int) Math.floor((completed * 100.0) / total);',
  'total == 0 ? 100 : (int) Math.floor((completed * 100.0) / total);',
);

const STATS_SERVICE = `package com.specgate.tasks.service;

import com.specgate.tasks.repository.TaskRepository;
import com.specgate.tasks.vo.TaskStatsVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class TaskStatsService {
    private final TaskRepository repository;

    public TaskStatsService(TaskRepository repository) {
        this.repository = repository;
    }

    public TaskStatsVO stats() {
        long total = repository.count();
        long completed = repository.countByCompleted(true);
        return new TaskStatsVO(total, completed, total - completed);
    }
}
`;

const STATS_CONTROLLER = `package com.specgate.tasks.controller;

import com.specgate.tasks.common.ApiResponse;
import com.specgate.tasks.service.TaskStatsService;
import com.specgate.tasks.vo.TaskStatsVO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tasks/stats")
public class TaskStatsController {
    private final TaskStatsService service;

    public TaskStatsController(TaskStatsService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<TaskStatsVO> stats() {
        return ApiResponse.success(service.stats());
    }
}
`;

const REPOSITORY = `package com.specgate.tasks.repository;

import com.specgate.tasks.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskRepository
        extends JpaRepository<Task, Long>,
                org.springframework.data.jpa.repository.JpaSpecificationExecutor<Task> {
    long countByCompleted(boolean completed);
}
`;

function now() {
  return new Date().toISOString();
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function javaTestForPreset(preset, source) {
  return preset === 'jdk21-boot4.0'
    ? source.replace(
        'org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc',
        'org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc',
      )
    : source;
}

function run(root, command, args, { expectedSuccess = true } = {}) {
  const startedAt = now();
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    timeout: 10 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  const finishedAt = now();
  const receipt = {
    command: [command, ...args],
    cwd: root,
    startedAt,
    finishedAt,
    exitCode: result.status,
    stdout: String(result.stdout || '').slice(-20000),
    stderr: String(result.stderr || result.error?.message || '').slice(-20000),
  };
  if (expectedSuccess && result.status !== 0)
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(' ')}\n${receipt.stderr}`,
    );
  return receipt;
}

function git(root, args, options = {}) {
  return run(root, 'git', args, options);
}

function gitHead(root) {
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

function commit(root, message) {
  git(root, ['add', '--', 'backend', 'frontend', '.specgate/codex']);
  git(root, [
    '-c',
    'user.name=Pilot',
    '-c',
    'user.email=pilot@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--no-gpg-sign',
    '-q',
    '-m',
    message,
  ]);
  return gitHead(root);
}

function evidence({ command, acIds, commitSha, environmentFingerprint, startedAt, finishedAt }) {
  return {
    schemaVersion: 2,
    evidenceId: `pilot-${hashValue({ command, commitSha }).slice(0, 16)}`,
    type: 'automated-test',
    acIds,
    executor: 'pilot-harness',
    command,
    cwd: '.',
    commit: commitSha,
    startedAt,
    finishedAt,
    status: 'passed',
    exitCode: 0,
    artifacts: [],
    summary: 'Pilot command completed successfully.',
    environmentFingerprint,
  };
}

function changeContract({
  changeId,
  parentDeliveryId,
  type,
  request,
  details,
  requirements,
  baselineId,
}) {
  const built = buildChangeContract({
    changeId,
    parentDeliveryId,
    type,
    request,
    details,
    requirements,
    baselineId,
    status: 'H1_PENDING',
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.contract;
}

function copyDelivery(projectRoot, delivery, outputDirectory) {
  const source = path.join(projectRoot, `.specgate/codex/deliveries/${delivery.deliveryId}`);
  const destination = path.join(outputDirectory, delivery.deliveryId);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

async function runScenario({
  projectRoot,
  preset,
  scenario,
  type,
  acceptance,
  parentDelivery,
  baselineId,
  environmentFingerprint,
  maven,
  npm,
  evidenceRoot,
}) {
  const started = Date.now();
  const changeId = `${preset}-${scenario}`;
  const backend = path.join(projectRoot, 'backend');
  const frontend = path.join(projectRoot, 'frontend');
  const parentDeliveryId = parentDelivery?.deliveryId || null;
  const baselineCommit = parentDelivery?.deliveryCommit || gitHead(projectRoot);
  const receipts = [];
  let redReceipt = null;

  if (scenario === 'feature-stats') {
    write(
      projectRoot,
      'backend/src/test/java/com/specgate/tasks/TaskStatsApiTest.java',
      javaTestForPreset(preset, JAVA_TEST),
    );
    redReceipt = run(backend, maven, ['-B', '-ntp', '-Dtest=TaskStatsApiTest', 'test'], {
      expectedSuccess: false,
    });
    if (redReceipt.exitCode === 0)
      throw new Error('Feature test unexpectedly passed before implementation');
    write(
      projectRoot,
      'backend/src/main/java/com/specgate/tasks/repository/TaskRepository.java',
      REPOSITORY,
    );
    write(projectRoot, 'backend/src/main/java/com/specgate/tasks/vo/TaskStatsVO.java', STATS_VO);
    write(
      projectRoot,
      'backend/src/main/java/com/specgate/tasks/service/TaskStatsService.java',
      STATS_SERVICE,
    );
    write(
      projectRoot,
      'backend/src/main/java/com/specgate/tasks/controller/TaskStatsController.java',
      STATS_CONTROLLER,
    );
  }
  if (scenario === 'modify-completion-percent') {
    write(
      projectRoot,
      'backend/src/test/java/com/specgate/tasks/TaskStatsApiTest.java',
      javaTestForPreset(preset, JAVA_TEST_WITH_RATE),
    );
    redReceipt = run(backend, maven, ['-B', '-ntp', '-Dtest=TaskStatsApiTest', 'test'], {
      expectedSuccess: false,
    });
    if (redReceipt.exitCode === 0)
      throw new Error('Modify test unexpectedly passed before implementation');
    write(
      projectRoot,
      'backend/src/main/java/com/specgate/tasks/vo/TaskStatsVO.java',
      STATS_VO_WITH_RATE,
    );
  }
  if (scenario === 'fix-zero-rate') {
    write(
      projectRoot,
      'backend/src/main/java/com/specgate/tasks/vo/TaskStatsVO.java',
      STATS_VO_BROKEN_ZERO,
    );
    write(
      projectRoot,
      'backend/src/test/java/com/specgate/tasks/TaskStatsApiTest.java',
      javaTestForPreset(preset, JAVA_TEST_WITH_ZERO),
    );
    redReceipt = run(backend, maven, ['-B', '-ntp', '-Dtest=TaskStatsApiTest', 'test'], {
      expectedSuccess: false,
    });
    if (redReceipt.exitCode === 0)
      throw new Error('Regression test unexpectedly passed before fix');
    write(
      projectRoot,
      'backend/src/main/java/com/specgate/tasks/vo/TaskStatsVO.java',
      STATS_VO_WITH_RATE,
    );
  }

  receipts.push(run(backend, maven, ['-B', '-ntp', 'spotless:apply']));
  receipts.push(run(backend, maven, ['-B', '-ntp', '-Dtest=TaskStatsApiTest', 'test']));
  receipts.push(run(frontend, npm, ['run', 'test']));
  receipts.push(run(frontend, npm, ['run', 'build']));
  const deliveryCommit = commit(projectRoot, `pilot: ${scenario}`);
  const verificationEvidence = receipts.map((receipt) =>
    evidence({
      command: receipt.command,
      acIds: acceptance.map((entry) => entry.id),
      commitSha: deliveryCommit,
      environmentFingerprint,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
    }),
  );
  const verification = assessVerification({
    risk: 'yellow',
    independenceLevel: 'fresh-context',
    reviewMode: 'evidence-and-diff',
    commit: deliveryCommit,
    environmentFingerprint,
    acceptanceCriteria: acceptance,
    evidenceRequirements: acceptance.map((entry) => ({
      acId: entry.id,
      allowedTypes: ['automated-test'],
    })),
    evidence: verificationEvidence,
  });
  if (!verification.ok) throw new Error(JSON.stringify(verification));
  const contract = changeContract({
    changeId,
    parentDeliveryId,
    type,
    request:
      scenario === 'feature-stats'
        ? 'Add task completion statistics.'
        : scenario === 'modify-completion-percent'
          ? 'Add completion percentage to task statistics.'
          : 'Fix zero-task completion percentage regression.',
    details:
      type === 'fix'
        ? {
            expectedBehavior: 'An empty task set reports zero completion percent.',
            actualBehavior: 'An empty task set previously divided by zero.',
            reproduction: 'Delete all tasks and request task statistics.',
            scope: ['Task statistics'],
            nonGoals: ['Do not change non-empty task statistics.'],
          }
        : type === 'modify'
          ? {
              existingBehavior: 'Task statistics expose total, completed and in-progress counts.',
              desiredBehavior: 'Task statistics also expose an integer completion percentage.',
              compatibility: 'The existing count fields remain unchanged.',
              scope: ['Task statistics response'],
              nonGoals: ['Do not change task filtering.'],
            }
          : {
              scope: ['Task statistics endpoint'],
              nonGoals: ['Do not change task editing or filtering.'],
            },
    requirements: [
      {
        id: 'REQ-PILOT',
        acceptanceCriteria: acceptance,
      },
    ],
    baselineId,
  });

  if (parentDelivery) {
    const increment = createIncrementalPlan({
      projectId: parentDelivery.projectId,
      parent: parentDelivery,
      contract,
      impact: {
        affectedAcIds: acceptance.map((entry) => entry.id),
        reusedAcIds: [],
        invalidatedTestIds: [],
        regressionCommands: receipts.map((entry) => entry.command.join(' ')),
      },
    });
    if (!increment.ok) throw new Error(JSON.stringify(increment));
  }

  const delivery = createDeliveryRecord({
    projectId: parentDelivery?.projectId || loadProjectReadiness({ projectRoot }).profile.projectId,
    changeId,
    parentDeliveryId,
    baselineCommit,
    deliveryCommit,
    environmentFingerprint,
    reviewMode: 'evidence-and-diff',
    acceptance: acceptance.map((entry) => entry.id),
    evidence: verificationEvidence.map((entry) => entry.evidenceId),
    knownIssues: [],
    rollback: {
      code: `git revert ${deliveryCommit}`,
      data: 'No data migration.',
      forwardFix: 'Deliver a follow-up change from this accepted commit.',
    },
    push: { requested: false, remoteUrl: null, status: 'not-requested' },
  });
  if (!delivery.ok) throw new Error(JSON.stringify(delivery));
  const persisted = persistDelivery({
    projectRoot,
    delivery: delivery.delivery,
    internal: {
      scenario,
      contract,
      verification: verification.assessment,
      receipts,
      redReceipt,
    },
    customer: {
      title: contract.request,
      summary: 'Pilot customer delivery completed with real build and test evidence.',
      verification: receipts.map((entry) => entry.command.join(' ')),
      knownIssues: [],
      upgrade: `Deploy commit ${deliveryCommit}.`,
      rollback: delivery.delivery.rollback,
    },
  });
  if (!persisted.ok) throw new Error(JSON.stringify(persisted));
  copyDelivery(projectRoot, delivery.delivery, path.join(evidenceRoot, preset));
  return {
    scenario,
    type,
    status: 'passed',
    durationMs: Date.now() - started,
    baselineCommit,
    deliveryCommit,
    redFailureObserved: Boolean(redReceipt && redReceipt.exitCode !== 0),
    redExitCode: redReceipt?.exitCode ?? null,
    commands: receipts.map((entry) => ({
      command: entry.command,
      exitCode: entry.exitCode,
      durationMs: Date.parse(entry.finishedAt) - Date.parse(entry.startedAt),
    })),
    delivery: delivery.delivery,
    verification: verification.assessment,
  };
}

export async function runPilot({
  output = 'docs/verification/codex-delivery-assurance/pilot-20261022',
} = {}) {
  const evidenceRoot = path.resolve(output);
  if (fs.existsSync(evidenceRoot) && fs.readdirSync(evidenceRoot).length)
    throw new Error('Pilot evidence directory already exists and is not empty');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-delivery-pilot-'));
  const report = {
    schemaVersion: 1,
    scope: 'codex-delivery-assurance-real-project-pilot',
    startedAt: now(),
    workspace,
    presets: [],
    changes: [],
    unexecuted: [
      'No production deployment.',
      'No production database rollback.',
      'No push to a remote repository.',
      'Native user H1/H3 elicitation is covered by integration tests, not this autonomous pilot harness.',
    ],
  };
  const save = () =>
    fs.writeFileSync(path.join(evidenceRoot, 'pilot.json'), JSON.stringify(report, null, 2) + '\n');
  save();
  for (const preset of PRESETS) {
    const projectRoot = path.join(workspace, preset);
    const projectStarted = Date.now();
    process.stdout.write(JSON.stringify({ preset, phase: 'initialize' }) + '\n');
    const preview = previewInit({
      root: projectRoot,
      preset,
      company: 'specgate',
      business: 'tasks',
    });
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const generated = await executeInit({
      root: projectRoot,
      preset,
      company: 'specgate',
      business: 'tasks',
      previewHash: preview.previewHash,
    });
    if (!generated.ok) throw new Error(JSON.stringify(generated));
    process.stdout.write(JSON.stringify({ preset, phase: 'verify' }) + '\n');
    const verification = await verifyProject({ root: projectRoot, timeoutMs: 300000 });
    if (!verification.ok) throw new Error(JSON.stringify(verification));
    const verificationRecord = {
      ok: verification.ok,
      runId: verification.report.runId,
      sourceHash: verification.report.sourceHash,
      report: verification.report,
    };
    const recorded = recordNewProjectBaseline({ projectRoot, verification: verificationRecord });
    if (!recorded.ok) throw new Error(JSON.stringify(recorded));
    const metadataCommit = commit(projectRoot, 'chore: record project readiness');
    const readiness = loadProjectReadiness({ projectRoot });
    if (!readiness.ok) throw new Error(JSON.stringify(readiness));
    const environmentFingerprint = readiness.baseline.environmentFingerprint;
    const maven = verificationRecord.report.environment.maven.path;
    const npm = verificationRecord.report.environment.npm;
    const javaHome = verification.legacyReport?.toolchain?.javaHome;
    if (!javaHome) throw new Error('Verified project did not expose its selected JAVA_HOME');
    process.env.JAVA_HOME = javaHome;
    process.env.APP_ADMIN_PASSWORD = `pilot-admin-${hashValue(projectRoot).slice(0, 12)}`;
    process.env.APP_VIEWER_PASSWORD = `pilot-viewer-${hashValue(projectRoot).slice(12, 24)}`;
    report.presets.push({
      preset,
      status: 'ready',
      root: projectRoot,
      projectId: readiness.profile.projectId,
      baselineId: readiness.baseline.baselineId,
      baselineCommit: readiness.baseline.commit,
      metadataCommit,
      setupDurationMs: Date.now() - projectStarted,
      verificationRunId: verificationRecord.runId,
    });
    save();

    let parentDelivery = null;
    for (const [index, scenario] of SCENARIOS.entries()) {
      process.stdout.write(JSON.stringify({ preset, scenario, phase: 'change' }) + '\n');
      const type =
        scenario === 'feature-stats'
          ? 'feature'
          : scenario === 'modify-completion-percent'
            ? 'modify'
            : 'fix';
      const acceptance =
        scenario === 'feature-stats'
          ? [
              {
                id: 'AC-STATS',
                text: 'GET /api/tasks/stats returns total, completed and in-progress counts.',
              },
            ]
          : scenario === 'modify-completion-percent'
            ? [
                {
                  id: 'AC-RATE',
                  text: 'Task statistics add completionPercent while preserving existing count fields.',
                },
              ]
            : [
                {
                  id: 'AC-ZERO',
                  text: 'An empty task project returns zero completionPercent instead of failing.',
                },
              ];
      const result = await runScenario({
        projectRoot,
        preset,
        scenario,
        type,
        acceptance,
        parentDelivery,
        baselineId: readiness.baseline.baselineId,
        environmentFingerprint,
        maven,
        npm,
        evidenceRoot,
      });
      parentDelivery = result.delivery;
      report.changes.push(result);
      save();
      if (index === SCENARIOS.length - 1) {
        process.stdout.write(JSON.stringify({ preset, phase: 'final-verify' }) + '\n');
        const finalVerification = await verifyProject({ root: projectRoot, timeoutMs: 300000 });
        if (!finalVerification.ok) throw new Error(JSON.stringify(finalVerification));
        const presetReport = report.presets.find((entry) => entry.preset === preset);
        presetReport.finalVerification = {
          status: finalVerification.report.status,
          runId: finalVerification.report.runId,
          sourceHash: finalVerification.report.sourceHash,
        };
        save();
      }
    }
  }
  report.status = 'passed';
  report.endedAt = now();
  save();
  fs.writeFileSync(
    path.join(evidenceRoot, 'README.md'),
    [
      '# Delivery Assurance Real Project Pilot',
      '',
      '- Date: 2026-10-22',
      `- Projects: ${report.presets.length}`,
      `- Changes: ${report.changes.length}`,
      '- All changes executed real Java Maven tests, frontend Vitest tests, frontend builds and final runtime verification.',
      '- Feature and modify scenarios include an observed red test before implementation.',
      '- The fix scenario includes an observed failing regression before repair.',
      '',
      'See `pilot.json` for exact commands, commits, DeliveryRecords and timings.',
      '',
      'This pilot uses isolated generated Java/Vue applications and a server-owned harness for approvals.',
      'It does not claim customer production deployment or native interactive H1/H3 execution.',
      '',
    ].join('\n'),
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf('--output');
  const output =
    outputIndex >= 0
      ? process.argv[outputIndex + 1]
      : 'docs/verification/codex-delivery-assurance/pilot-20261022';
  runPilot({ output })
    .then((report) => {
      process.stdout.write(
        JSON.stringify({
          status: report.status,
          evidence: path.resolve(output),
          projects: report.presets.length,
          changes: report.changes.length,
        }) + '\n',
      );
    })
    .catch((error) => {
      process.stderr.write(String(error.stack || error) + '\n');
      process.exitCode = 1;
    });
}
