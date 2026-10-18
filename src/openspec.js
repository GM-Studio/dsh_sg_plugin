import fs from 'node:fs';
import path from 'node:path';
import {
  clearAllGates,
  gateRequiredForParadigm,
  invalidateFrom,
  readGate,
} from './gates.js';
import {
  isRequirementsProject,
  listRequirementChangeNames,
  requirementChangeDir,
  requirementsChangesDir,
  testPaths,
} from './requirements.js';
import { formatReportPath, reviewReportPath } from './format.js';
import {
  ensureDir,
  exists,
  listDir,
  readIfExists,
  walkFiles,
  writeFile,
} from './util.js';

export function changeDir(root, name) {
  return isRequirementsProject(root)
    ? requirementChangeDir(root, name)
    : path.join(root, 'openspec', 'changes', name);
}

export function listChangeNames(root) {
  if (isRequirementsProject(root)) return listRequirementChangeNames(root);
  const changesDir = path.join(root, 'openspec', 'changes');
  return listDir(changesDir)
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => entry.name)
    .sort();
}

function stateOfText(text, completedPatterns) {
  if (text === null) return 'not-started';
  return completedPatterns.every((re) => re.test(text)) ? 'completed' : 'drafting';
}

function specsStatus(changePath) {
  const specsDir = path.join(changePath, 'specs');
  if (!exists(specsDir)) return 'not-started';
  const specFiles = walkFiles(specsDir).filter((file) => /[\\/]spec\.md$/i.test(file));
  if (specFiles.length === 0) return 'drafting';
  const completed = specFiles.some((file) => {
    const text = readIfExists(file) || '';
    return /##\s+Requirements/i.test(text) && /Scenario:/i.test(text);
  });
  return completed ? 'completed' : 'drafting';
}

export function artifactStates(changePath) {
  const requirementChange = readIfExists(path.join(changePath, 'change.md'));
  if (requirementChange !== null) {
    const tests = testPaths(path.dirname(changePath), path.basename(changePath));
    return {
      proposal: stateOfText(requirementChange, [/##\s+Intent/i, /##\s+Scope/i]),
      specs: specsStatus(changePath),
      design: stateOfText(readIfExists(path.join(changePath, 'design.md')), [
        /##\s+Architecture/i,
        /##\s+Technical Approach/i,
      ]),
      tests: (() => {
        const cases = readIfExists(tests.cases);
        const matrix = readIfExists(tests.matrix);
        if (cases === null && matrix === null) return 'not-started';
        return cases && /^###\s+TC-\d+/im.test(cases) && matrix ? 'completed' : 'drafting';
      })(),
      tasks: (() => {
        const tasksText = readIfExists(path.join(changePath, 'tasks.md'));
        if (tasksText === null) return 'not-started';
        const done = (tasksText.match(/^\s*-\s*\[x\]/gim) || []).length;
        const open = (tasksText.match(/^\s*-\s*\[ \]/gim) || []).length;
        return done > 0 && open === 0 ? 'completed' : 'drafting';
      })(),
    };
  }
  const proposal = stateOfText(readIfExists(path.join(changePath, 'proposal.md')), [
    /##\s+Intent/i,
    /##\s+Scope/i,
  ]);
  const design = stateOfText(readIfExists(path.join(changePath, 'design.md')), [
    /##\s+Architecture/i,
    /##\s+Technical Approach/i,
  ]);
  const tasksText = readIfExists(path.join(changePath, 'tasks.md'));
  let tasks = 'not-started';
  if (tasksText !== null) {
    const done = (tasksText.match(/^\s*-\s*\[x\]/gim) || []).length;
    const open = (tasksText.match(/^\s*-\s*\[ \]/gim) || []).length;
    tasks = done > 0 && open === 0 ? 'completed' : 'drafting';
  }
  return {
    proposal,
    specs: specsStatus(changePath),
    design,
    tasks,
  };
}

export function changeState(artifacts) {
  if (artifacts.tasks === 'completed') return 'implementing';
  if (artifacts.design === 'completed') return 'tasking';
  if (artifacts.tests === 'completed') return 'designing';
  if (artifacts.specs === 'completed') return 'designing';
  if (artifacts.proposal === 'completed') return 'specing';
  if (artifacts.proposal === 'drafting') return 'proposing';
  return 'idle';
}

export function taskCounts(changePath) {
  const text = readIfExists(path.join(changePath, 'tasks.md'));
  if (!text) return { total: 0, done: 0, open: 0 };
  const done = (text.match(/^\s*-\s*\[x\]/gim) || []).length;
  const open = (text.match(/^\s*-\s*\[ \]/gim) || []).length;
  return { total: done + open, done, open };
}

export function inspectChange(root, name, paradigm) {
  const changePath = changeDir(root, name);
  const artifacts = artifactStates(changePath);
  const state = changeState(artifacts);
  const counts = taskCounts(changePath);
  return {
    name,
    path: changePath,
    artifacts,
    state,
    tasks: counts,
    nextStep: nextStepFor(root, name, artifacts, state, paradigm),
  };
}

export function listChanges(root, paradigm) {
  return listChangeNames(root).map((name) => inspectChange(root, name, paradigm));
}

export function nextStepFor(root, name, artifacts, state, paradigm) {
  const required = (gate) => gateRequiredForParadigm(gate, paradigm);
  const satisfied = (gate) => readGate(root, gate).satisfied || !required(gate);

  if (isRequirementsProject(root)) {
    if (!satisfied('G1')) {
      return { action: 'confirm-gate', gate: 'G1', text: '完成需求理解确认（G1）' };
    }
    if (!satisfied('G2')) {
      return { action: 'confirm-gate', gate: 'G2', text: '确认变更分类（G2）' };
    }
    if (artifacts.proposal === 'not-started') {
      return { action: 'create-change', text: '创建需求变更包：/sg-change <name>' };
    }
    if (artifacts.proposal !== 'completed') {
      return { action: 'complete-change', text: '补齐 change.md 的 ## Intent 与 ## Scope' };
    }
    if (!satisfied('G3')) {
      return { action: 'confirm-gate', gate: 'G3', text: '评审需求增量，确认 G3（确认后生成新版本）' };
    }
    if (artifacts.design === 'not-started') {
      return { action: 'create-design', text: '创建 design.md（需 G3 已确认）' };
    }
    if (artifacts.design !== 'completed') {
      return { action: 'complete-design', text: '补齐 design.md 的 ## Architecture 与 ## Technical Approach' };
    }
    if (!satisfied('G4')) {
      return { action: 'confirm-gate', gate: 'G4', text: '评审 design，确认 G4' };
    }
    if (artifacts.tests === 'not-started') {
      return { action: 'create-tests', text: '编写测试用例：/sg-test ' + name + ' plan' };
    }
    if (artifacts.tests !== 'completed') {
      return { action: 'complete-tests', text: '补齐 tests/cases.md 的 TC-* 用例与 tests/matrix.md' };
    }
    if (!satisfied('G5')) {
      return { action: 'confirm-gate', gate: 'G5', text: '评审测试计划/用例，确认 G5' };
    }
    if (artifacts.tasks === 'not-started') {
      return { action: 'create-tasks', text: '创建 tasks.md（需 G5 已确认）' };
    }
    if (!satisfied('G6')) {
      return { action: 'confirm-gate', gate: 'G6', text: '评审 tasks，确认 G6' };
    }
    if (!satisfied('G7')) {
      return { action: 'confirm-gate', gate: 'G7', text: '执行 critical review，确认 G7 后进入实施' };
    }
    if (artifacts.tasks !== 'completed' || state !== 'implementing') {
      return { action: 'implement', text: '按 tasks.md 实施，测试基线已冻结（RED → GREEN）' };
    }
    if (!satisfied('G7.5')) {
      const format = readIfExists(formatReportPath(root, name));
      if (!format) {
        return { action: 'run-format', text: '执行格式化/Lint：/sg-apply ' + name };
      }
      return { action: 'confirm-gate', gate: 'G7.5', text: '格式化/Lint 已通过，确认 G7.5' };
    }
    const report = readIfExists(testPaths(root, name).report);
    if (!report) {
      return { action: 'run-tests', text: '执行测试 Agent：/sg-apply ' + name };
    }
    if (!satisfied('G8')) {
      return { action: 'confirm-gate', gate: 'G8', text: '测试报告通过后确认 G8' };
    }
    if (!satisfied('G9')) {
      const review = readIfExists(reviewReportPath(root, name));
      if (!review) {
        return { action: 'run-review', text: '执行独立代码审查：/sg-apply ' + name };
      }
      return { action: 'confirm-gate', gate: 'G9', text: '审查通过后确认 G9 并提交' };
    }
    if (!satisfied('G10')) {
      return { action: 'confirm-gate', gate: 'G10', text: '启动验收测试，确认 G10' };
    }
    if (!satisfied('G11')) {
      return { action: 'confirm-gate', gate: 'G11', text: '处理分支/PR，确认 G11' };
    }
    return { action: 'archive', text: '归档 change：/sg-archive ' + name };
  }

  if (!satisfied('G1')) {
    return { action: 'confirm-gate', gate: 'G1', text: '完成需求理解确认（G1）' };
  }
  if (!satisfied('G2')) {
    return { action: 'confirm-gate', gate: 'G2', text: '确认变更分类（G2）' };
  }
  if (artifacts.proposal === 'not-started') {
    return { action: 'create-proposal', text: '创建 proposal.md（需 G1 需求确认、G2 分类确认）' };
  }
  if (artifacts.proposal !== 'completed') {
    return { action: 'complete-proposal', text: '补齐 proposal.md 的 ## Intent 与 ## Scope' };
  }
  if (!satisfied('G3')) {
    return { action: 'confirm-gate', gate: 'G3', text: '评审 proposal，确认 G3' };
  }
  if (artifacts.design === 'not-started') {
    return { action: 'create-design', text: '创建 design.md（需 G3 已确认）' };
  }
  if (artifacts.design !== 'completed') {
    return { action: 'complete-design', text: '补齐 design.md 的 ## Architecture 与 ## Technical Approach' };
  }
  if (!satisfied('G4')) {
    return { action: 'confirm-gate', gate: 'G4', text: '评审 design，确认 G4' };
  }
  if (artifacts.specs === 'not-started') {
    return { action: 'create-specs', text: '创建 specs/<capability>/spec.md（需 G4 已确认）' };
  }
  if (artifacts.specs !== 'completed') {
    return { action: 'complete-specs', text: '补齐 spec.md 的 ## Requirements 与 Scenario:' };
  }
  if (!satisfied('G5')) {
    return { action: 'confirm-gate', gate: 'G5', text: '评审 specs，确认 G5' };
  }
  if (artifacts.tasks === 'not-started') {
    return { action: 'create-tasks', text: '创建 tasks.md（需 G5 已确认）' };
  }
  if (!satisfied('G6')) {
    return { action: 'confirm-gate', gate: 'G6', text: '评审 tasks，确认 G6' };
  }
  if (!satisfied('G7')) {
    return { action: 'confirm-gate', gate: 'G7', text: '执行 critical review，确认 G7 后进入实施' };
  }
  if (artifacts.tasks !== 'completed' || state !== 'implementing') {
    return { action: 'implement', text: '按 tasks.md 实施，保持 TDD（RED → GREEN → REFACTOR）' };
  }
  if (!satisfied('G8')) {
    return { action: 'confirm-gate', gate: 'G8', text: '启动代码审查，确认 G8' };
  }
  if (!satisfied('G9')) {
    return { action: 'confirm-gate', gate: 'G9', text: '审查通过后确认 G9 并提交' };
  }
  if (!satisfied('G10')) {
    return { action: 'confirm-gate', gate: 'G10', text: '启动验收测试，确认 G10' };
  }
  if (!satisfied('G11')) {
    return { action: 'confirm-gate', gate: 'G11', text: '处理分支/PR，确认 G11' };
  }
  return { action: 'archive', text: '归档 change：/sg-archive ' + name };
}

export function projectState(root, changes) {
  if (changes.length === 0) {
    const archive = isRequirementsProject(root)
      ? path.join(requirementsChangesDir(root), 'archive')
      : path.join(root, 'openspec', 'changes', 'archive');
    const archived = listDir(archive).filter((e) => e.isDirectory());
    return archived.length > 0 ? 'completed' : 'idle';
  }
  if (changes.some((change) => change.state === 'implementing')) return 'developing';
  if (changes.some((change) => change.state === 'reviewing')) return 'reviewing';
  return 'planning';
}

export function validateChangeName(name) {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(name);
}

export function createChange(root, name, description = '') {
  if (!validateChangeName(name)) {
    throw new Error('Change 名称必须是 kebab-case：小写字母、数字、连字符，且以字母或数字开头');
  }
  const target = changeDir(root, name);
  if (exists(target)) throw new Error(`Change 已存在：${name}`);
  ensureDir(target);
  ensureDir(path.join(root, 'openspec', 'changes'));
  invalidateFrom(root, 'G3');
  const intent = description.trim() || '待补充：为什么要做这个变更。';
  const proposal = `# ${name}\n\n## Intent\n\n${intent}\n\n## Scope\n\n- 待补充：本次变更包含什么、不包含什么。\n\n## Impact\n\n- 待补充：影响的模块、接口、数据、用户。\n\n## Risks\n\n- 待补充：主要风险与缓解措施。\n`;
  writeFile(path.join(target, 'proposal.md'), proposal);
  return { name, path: target };
}

export function archiveChange(root, name) {
  const source = changeDir(root, name);
  if (!exists(source)) throw new Error(`Change 不存在：${name}`);
  const archiveRoot = isRequirementsProject(root)
    ? path.join(requirementsChangesDir(root), 'archive')
    : path.join(root, 'openspec', 'changes', 'archive');
  ensureDir(archiveRoot);
  const date = new Date().toISOString().slice(0, 10);
  const target = path.join(archiveRoot, `${date}-${name}`);
  if (exists(target)) throw new Error(`归档目标已存在：${target}`);
  fs.renameSync(source, target);
  clearAllGates(root);
  return { name, path: target };
}
