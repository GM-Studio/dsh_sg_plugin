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

const PRESETS = ['jdk17-boot3.5', 'jdk21-boot3.5'];
const SCENARIOS = ['feature-audit-filter', 'modify-role-description', 'fix-user-status'];

// The pilot now exercises the domain-neutral `sys` admin scaffold (`com.specgate.tasks.sys`)
// instead of the task scenarios that are being removed from the generated template.
const SYS_JAVA = 'backend/src/main/java/com/specgate/tasks/sys';
const TEST_ROOT = 'backend/src/test/java/com/specgate/tasks/sys';
const AUDIT_CONTROLLER = `${SYS_JAVA}/controller/SysAuditLogController.java`;
const AUDIT_SERVICE = `${SYS_JAVA}/service/SysAuditLogService.java`;
const ROLE_SERVICE = `${SYS_JAVA}/service/SysRoleService.java`;
const USER_ENTITY = `${SYS_JAVA}/entity/SysUser.java`;

const AUDIT_FILTER_TEST = String.raw`package com.specgate.tasks.sys;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.specgate.tasks.sys.repository.SysAuditLogRepository;
import com.specgate.tasks.sys.service.SysAuditLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = {"spring.datasource.url=jdbc:h2:mem:pilot-audit-target;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysAuditTargetFilterApiTest {
    @Autowired private MockMvc mvc;
    @Autowired private SysAuditLogRepository auditLogs;
    @Autowired private SysAuditLogService audits;

    @BeforeEach
    void reset() {
        auditLogs.deleteAll();
    }

    @Test
    void filtersAuditLogsByTargetAndKeepsActorAndActionFilters() throws Exception {
        audits.record("alice", "SYS_USER_UPDATE", "user:1", "disabled user");
        audits.record("bob", "SYS_ROLE_UPDATE", "role:admin", "renamed role");
        audits.record("alice", "SYS_USER_UPDATE", "user:2", "enabled user");

        mvc.perform(get("/api/sys/audits?target=user:1").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.records[0].target").value("user:1"));
        mvc.perform(get("/api/sys/audits?target=ROLE:ADMIN").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/audits?actor=alice&target=user").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(2));
        mvc.perform(get("/api/sys/audits?action=ROLE_UPDATE&target=admin").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/sys/audits?target=%25").with(user("viewer")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
    }
}
`;

const ROLE_DESCRIPTION_TEST = String.raw`package com.specgate.tasks.sys;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.specgate.tasks.sys.repository.SysRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = {
            "spring.datasource.url=jdbc:h2:mem:pilot-role-description;DB_CLOSE_DELAY=-1"
        })
@AutoConfigureMockMvc
class SysRoleDescriptionApiTest {
    @Autowired private MockMvc mvc;
    @Autowired private SysRoleRepository roles;

    @BeforeEach
    void reset() {
        roles.deleteAll();
    }

    @Test
    void normalizesBlankDescriptionToNullAndPreservesNonBlankDescriptions() throws Exception {
        mvc.perform(
                        post("/api/sys/roles")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\"blank\",\"name\":\"Blank\","
                                                + "\"description\":\"   \",\"enabled\":true}"))
                .andExpect(status().isCreated());
        assertNull(roles.findByCode("blank").orElseThrow().getDescription());

        mvc.perform(
                        post("/api/sys/roles")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\"managed\",\"name\":\"Managed\","
                                                + "\"description\":\"  Managed role  \","
                                                + "\"enabled\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.description").value("Managed role"));
        assertEquals("Managed role", roles.findByCode("managed").orElseThrow().getDescription());
    }
}
`;

const USER_STATUS_TEST = String.raw`package com.specgate.tasks.sys;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.specgate.tasks.sys.entity.SysUser;
import com.specgate.tasks.sys.repository.SysUserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = {"spring.datasource.url=jdbc:h2:mem:pilot-user-status;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
class SysUserStatusRegressionApiTest {
    @Autowired private MockMvc mvc;
    @Autowired private SysUserRepository users;

    @BeforeEach
    void reset() {
        users.deleteAll();
    }

    @Test
    void disablingAndReEnablingAUserPersistsTheRequestedStatus() throws Exception {
        SysUser carol = users.saveAndFlush(new SysUser("carol", "Carol", "viewer", true));
        long id = carol.getId();

        mvc.perform(
                        post("/api/sys/users/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"username\":\"carol\",\"displayName\":\"Carol\","
                                                + "\"roleCode\":\"viewer\",\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.enabled").value(false));
        assertFalse(users.findById(id).orElseThrow().isEnabled());

        mvc.perform(
                        post("/api/sys/users/update")
                                .with(user("admin").roles("ADMIN"))
                                .with(csrf())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"id\":"
                                                + id
                                                + ",\"username\":\"carol\",\"displayName\":\"Carol\","
                                                + "\"roleCode\":\"viewer\",\"enabled\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.enabled").value(true));
        assertTrue(users.findById(id).orElseThrow().isEnabled());
    }
}
`;

// The `sys` audit log list already filters by `actor` and `action`; the feature
// adds an equivalent `target` filter to the controller and the specification.
const AUDIT_CONTROLLER_LIST_BEFORE = String.raw`    @GetMapping
    public ApiResponse<PageResult<SysAuditLogVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String action) {
        return ApiResponse.success(service.list(page, pageSize, actor, action));
    }
`;

const AUDIT_CONTROLLER_LIST_AFTER = String.raw`    @GetMapping
    public ApiResponse<PageResult<SysAuditLogVO>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String target) {
        return ApiResponse.success(service.list(page, pageSize, actor, action, target));
    }
`;

const AUDIT_SERVICE_LIST_SIGNATURE_BEFORE =
  'public PageResult<SysAuditLogVO> list(int page, int pageSize, String actor, String action) {';
const AUDIT_SERVICE_LIST_SIGNATURE_AFTER =
  'public PageResult<SysAuditLogVO> list(int page, int pageSize, String actor, String action, String target) {';
const AUDIT_SERVICE_FILTER_CALL_BEFORE = 'filter(actor, action),';
const AUDIT_SERVICE_FILTER_CALL_AFTER = 'filter(actor, action, target),';
const AUDIT_SERVICE_FILTER_SIGNATURE_BEFORE =
  'public Specification<SysAuditLog> filter(String actor, String action) {';
const AUDIT_SERVICE_FILTER_SIGNATURE_AFTER =
  'public Specification<SysAuditLog> filter(String actor, String action, String target) {';
const AUDIT_SERVICE_RETURN_BEFORE = 'return builder.and(predicates.toArray(new Predicate[0]));';
const AUDIT_SERVICE_RETURN_AFTER = String.raw`            if (target != null && !target.trim().isEmpty()) {
                String escaped =
                        target.trim()
                                .replace("\\", "\\\\")
                                .replace("%", "\\%")
                                .replace("_", "\\_")
                                .toLowerCase(Locale.ROOT);
                predicates.add(
                        builder.like(builder.lower(root.get("target")), "%" + escaped + "%", '\\'));
            }
            return builder.and(predicates.toArray(new Predicate[0]));`;

// Role descriptions currently keep a whitespace-only value as an empty string;
// the modify stores blank descriptions as null while keeping non-blank values.
const ROLE_DESCRIPTION_BEFORE = String.raw`    private static String trimmedDescription(SysRoleRequest request) {
        return request.getDescription() == null ? null : request.getDescription().trim();
    }
`;

const ROLE_DESCRIPTION_AFTER = String.raw`    private static String trimmedDescription(SysRoleRequest request) {
        String trimmed =
                request.getDescription() == null ? null : request.getDescription().trim();
        if (trimmed == null || trimmed.isEmpty()) {
            return null;
        }
        if (trimmed.length() > 255) {
            throw new BusinessException(
                    400,
                    "SYS_ROLE_DESCRIPTION_INVALID",
                    "description must be at most 255 characters");
        }
        return trimmed;
    }
`;

// The injected defect drops the requested enabled flag, so `SysUserService.update`
// silently keeps the old status; the fix restores the assignment.
const USER_UPDATE_BEFORE = String.raw`    public void update(String username, String displayName, String roleCode, boolean enabled) {
        this.username = username;
        this.displayName = displayName;
        this.roleCode = roleCode;
        this.enabled = enabled;
    }
`;

const USER_UPDATE_DEFECT = String.raw`    public void update(String username, String displayName, String roleCode, boolean enabled) {
        this.username = username;
        this.displayName = displayName;
        this.roleCode = roleCode;
    }
`;

const SCENARIO_SPECS = {
  'feature-audit-filter': {
    testClass: 'SysAuditTargetFilterApiTest',
    testSource: AUDIT_FILTER_TEST,
    type: 'feature',
    request: 'Add a target filter to the audit log list.',
    acceptance: [
      {
        id: 'AC-AUDIT-FILTER',
        text: 'GET /api/sys/audits filters audit logs by target in addition to actor and action.',
      },
    ],
    details: {
      scope: ['Audit log list endpoint /api/sys/audits'],
      nonGoals: ['Do not change audit log writes, ordering or the existing actor/action filters.'],
    },
  },
  'modify-role-description': {
    testClass: 'SysRoleDescriptionApiTest',
    testSource: ROLE_DESCRIPTION_TEST,
    type: 'modify',
    request: 'Normalize role descriptions and keep blank input out of the database.',
    acceptance: [
      {
        id: 'AC-ROLE-DESCRIPTION',
        text: 'Role create and update store blank descriptions as null and preserve non-blank descriptions.',
      },
    ],
    details: {
      existingBehavior:
        'Role create and update trim the description and store a whitespace-only value as an empty string.',
      desiredBehavior:
        'Role create and update trim the description, store blank input as null and reject trimmed descriptions longer than 255 characters.',
      compatibility:
        'Existing non-blank descriptions, role codes, names and enabled flags are unchanged.',
      scope: ['Role create and update description handling'],
      nonGoals: ['Do not change role code uniqueness, pagination or CSV import.'],
    },
  },
  'fix-user-status': {
    testClass: 'SysUserStatusRegressionApiTest',
    testSource: USER_STATUS_TEST,
    type: 'fix',
    request: 'Persist the requested enabled status when updating a user.',
    acceptance: [
      {
        id: 'AC-USER-STATUS',
        text: 'Updating a user persists the requested enabled or disabled status.',
      },
    ],
    details: {
      expectedBehavior:
        'Updating a user persists the requested enabled or disabled status in the database.',
      actualBehavior:
        'Updating a user ignored the requested enabled flag and kept the previous status.',
      reproduction: 'Create an enabled user and update it with enabled=false.',
      scope: ['User update enabled flag /api/sys/users/update'],
      nonGoals: ['Do not change user creation, deletion, filtering or audit logging.'],
    },
  },
};

function now() {
  return new Date().toISOString();
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// Apply one or more targeted edits to a generated file. Each `from` block is
// matched on its token sequence (whitespace-insensitive) so the patch survives
// any formatting a previous scenario already applied to the file.
function tokenPattern(from) {
  const tokens = from.trim().split(/\s+/);
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('\\s+'), 'g');
}

function patch(root, relative, edits) {
  const target = path.join(root, relative);
  let content = fs.readFileSync(target, 'utf8');
  for (const { from, to } of edits) {
    const pattern = tokenPattern(from);
    const matches = content.match(pattern);
    if (!matches || matches.length !== 1)
      throw new Error(`Patch anchor for ${relative} matched ${matches?.length ?? 0} times`);
    content = content.replace(pattern, () => to);
  }
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
  const spec = SCENARIO_SPECS[scenario];
  const testClass = spec.testClass;
  const testPath = `${TEST_ROOT}/${testClass}.java`;

  if (scenario === 'feature-audit-filter') {
    write(projectRoot, testPath, javaTestForPreset(preset, spec.testSource));
    redReceipt = run(backend, maven, ['-B', '-ntp', `-Dtest=${testClass}`, 'test'], {
      expectedSuccess: false,
    });
    if (redReceipt.exitCode === 0)
      throw new Error('Feature test unexpectedly passed before implementation');
    patch(projectRoot, AUDIT_CONTROLLER, [
      { from: AUDIT_CONTROLLER_LIST_BEFORE, to: AUDIT_CONTROLLER_LIST_AFTER },
    ]);
    patch(projectRoot, AUDIT_SERVICE, [
      { from: AUDIT_SERVICE_LIST_SIGNATURE_BEFORE, to: AUDIT_SERVICE_LIST_SIGNATURE_AFTER },
      { from: AUDIT_SERVICE_FILTER_CALL_BEFORE, to: AUDIT_SERVICE_FILTER_CALL_AFTER },
      { from: AUDIT_SERVICE_FILTER_SIGNATURE_BEFORE, to: AUDIT_SERVICE_FILTER_SIGNATURE_AFTER },
      { from: AUDIT_SERVICE_RETURN_BEFORE, to: AUDIT_SERVICE_RETURN_AFTER },
    ]);
  }
  if (scenario === 'modify-role-description') {
    write(projectRoot, testPath, javaTestForPreset(preset, spec.testSource));
    redReceipt = run(backend, maven, ['-B', '-ntp', `-Dtest=${testClass}`, 'test'], {
      expectedSuccess: false,
    });
    if (redReceipt.exitCode === 0)
      throw new Error('Modify test unexpectedly passed before implementation');
    patch(projectRoot, ROLE_SERVICE, [
      { from: ROLE_DESCRIPTION_BEFORE, to: ROLE_DESCRIPTION_AFTER },
    ]);
  }
  if (scenario === 'fix-user-status') {
    patch(projectRoot, USER_ENTITY, [{ from: USER_UPDATE_BEFORE, to: USER_UPDATE_DEFECT }]);
    write(projectRoot, testPath, javaTestForPreset(preset, spec.testSource));
    redReceipt = run(backend, maven, ['-B', '-ntp', `-Dtest=${testClass}`, 'test'], {
      expectedSuccess: false,
    });
    if (redReceipt.exitCode === 0)
      throw new Error('Regression test unexpectedly passed before fix');
    patch(projectRoot, USER_ENTITY, [{ from: USER_UPDATE_DEFECT, to: USER_UPDATE_BEFORE }]);
  }

  receipts.push(run(backend, maven, ['-B', '-ntp', 'spotless:apply']));
  receipts.push(run(backend, maven, ['-B', '-ntp', `-Dtest=${testClass}`, 'test']));
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
    request: spec.request,
    details: spec.details,
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
    sdkDownloads: false,
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
      const spec = SCENARIO_SPECS[scenario];
      const result = await runScenario({
        projectRoot,
        preset,
        scenario,
        type: spec.type,
        acceptance: spec.acceptance,
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
      '- Scenarios exercise the domain-neutral sys admin scaffold: audit log filtering, role description handling and user enable/disable status.',
      '- All changes executed real Java Maven tests, frontend Vitest tests, frontend builds and final runtime verification.',
      '- The feature and modify scenarios include an observed red test before implementation.',
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
