import {
  BACKENDS,
  FRONTENDS,
  JAVA_JDKS,
  JAVA_BUILD_TOOLS,
  PYTHON_VERSIONS,
  NODE_VERSIONS,
  NODE_PACKAGE_MANAGERS,
  FRONTEND_LANGUAGES,
  applyDetailsToSide,
  defaultSideDetails,
  dependencyCatalog,
  findDependency,
  javaBootOptions,
  nodeLanguages,
  pythonFrameworks,
  pythonPackageManagers,
  resolveDependencies,
  sideLabel,
  validateSide,
} from './catalog.js';
import { resolveSelection } from './workspace.js';

function listOf(answer, index) {
  const item = answer?.answers?.[index];
  if (!item) return [];
  if (Array.isArray(item.selected)) return item.selected.map(String);
  if (typeof item.selected === 'string') return [item.selected];
  return [];
}

function oneOf(answer, index) {
  const values = listOf(answer, index);
  return values[0];
}

function customOf(answer, index) {
  const item = answer?.answers?.[index];
  return item && typeof item.custom === 'string' ? item.custom.trim() : '';
}

async function askOne({
  userQuestions,
  agent,
  signal,
  id,
  header,
  question,
  options,
  multi = false,
}) {
  const answer = await userQuestions.ask({
    questions: [
      {
        id,
        header,
        question,
        options,
        ...(multi ? { multi_select: true } : {}),
      },
    ],
    agent,
    signal,
  });
  return {
    selected: listOf(answer, 0),
    custom: customOf(answer, 0),
  };
}

function option(value, description) {
  return { label: String(value), description: description || '' };
}

function selectionFromInput(initial = {}, preset = null, backend = null, frontend = null) {
  if (preset) return resolveSelection({ preset });
  if (backend || frontend)
    return resolveSelection({ backend: backend || 'none', frontend: frontend || 'none' });
  if (initial.backend || initial.frontend) {
    return resolveSelection({
      backend: initial.backend || 'none',
      frontend: initial.frontend || 'none',
    });
  }
  return null;
}

async function askTopology({ userQuestions, agent, signal }) {
  const answer = await userQuestions.ask({
    questions: [
      {
        id: 'sg-v4-backend',
        header: '后端技术栈',
        question: '选择后端技术栈：node / python / java / none',
        options: BACKENDS.map((value) =>
          option(
            value,
            value === 'java' ? '推荐：Spring Boot 生态完整' : value === 'none' ? '只做前端' : '',
          ),
        ),
      },
      {
        id: 'sg-v4-frontend',
        header: '前端技术栈',
        question: '选择前端技术栈：vue / react / none',
        options: FRONTENDS.map((value) =>
          option(
            value,
            value === 'react' ? '推荐：Vite + TypeScript' : value === 'none' ? '只做后端' : '',
          ),
        ),
      },
    ],
    agent,
    signal,
  });
  return {
    backend: oneOf(answer, 0) || 'none',
    frontend: oneOf(answer, 1) || 'none',
  };
}

async function askJavaDetails({ userQuestions, agent, signal, side, initial = {} }) {
  let jdk = initial.jdk;
  if (!jdk) {
    const answer = await askOne({
      userQuestions,
      agent,
      signal,
      id: 'sg-v4-' + side.id + '-java-jdk',
      header: side.id + ' / Java JDK',
      question: '选择 JDK 版本（13 为非 LTS，仅兼容性保留）',
      options: JAVA_JDKS.map((value) =>
        option(
          value,
          value === '17' || value === '21'
            ? '推荐 LTS'
            : value === '13'
              ? '非 LTS，不推荐新项目'
              : '',
        ),
      ),
    });
    jdk = answer.selected[0] || initial.jdk || '17';
  }

  let buildTool = initial.buildTool;
  let bootVersion = initial.bootVersion;
  if (!buildTool || !bootVersion) {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-v4-' + side.id + '-java-build',
          header: side.id + ' / 构建工具',
          question: '选择构建工具',
          options: JAVA_BUILD_TOOLS.map((value) => option(value, value === 'maven' ? '推荐' : '')),
        },
        {
          id: 'sg-v4-' + side.id + '-java-boot',
          header: side.id + ' / Spring Boot',
          question:
            '选择 Spring Boot 版本线（JDK ' +
            jdk +
            ' 可选：' +
            javaBootOptions(jdk).join(' / ') +
            '）',
          options: javaBootOptions(jdk).map((value) =>
            option(value, value === '3.x' ? '推荐' : ''),
          ),
        },
      ],
      agent,
      signal,
    });
    buildTool = buildTool || oneOf(answer, 0) || 'maven';
    bootVersion = bootVersion || oneOf(answer, 1) || javaBootOptions(jdk)[0];
  }

  const details = {
    stack: 'java',
    framework: 'spring-boot',
    runtimeVersion: jdk,
    jdk,
    buildTool,
    bootVersion,
    language: 'java',
    packageManager: buildTool,
  };
  const checked = validateSide(details);
  if (!checked.ok) return checked;
  return { ok: true, details };
}

async function askPythonDetails({ userQuestions, agent, signal, side, initial = {} }) {
  let pythonVersion = initial.pythonVersion || initial.runtimeVersion;
  if (!pythonVersion) {
    const answer = await askOne({
      userQuestions,
      agent,
      signal,
      id: 'sg-v4-' + side.id + '-python-version',
      header: side.id + ' / Python',
      question: '选择 Python 版本（2.7 已 EOL，仅旧版 Flask/Django）',
      options: PYTHON_VERSIONS.map((value) =>
        option(value, value === '3.12' ? '推荐' : value === '2.7' ? 'EOL，仅兼容性保留' : ''),
      ),
    });
    pythonVersion = answer.selected[0] || '3.12';
  }

  let framework = initial.framework;
  let packageManager = initial.packageManager;
  if (!framework || !packageManager) {
    const frameworks = pythonFrameworks(pythonVersion);
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-v4-' + side.id + '-python-framework',
          header: side.id + ' / Python 框架',
          question:
            '选择 Web 框架（Python ' + pythonVersion + ' 可选：' + frameworks.join(' / ') + '）',
          options: frameworks.map((value) =>
            option(
              value,
              value === 'fastapi' ? '推荐：异步 + OpenAPI' : value === 'django' ? '全家桶' : '轻量',
            ),
          ),
        },
        {
          id: 'sg-v4-' + side.id + '-python-packaging',
          header: side.id + ' / 依赖管理',
          question: '选择包管理器与依赖文件',
          options: pythonPackageManagers(pythonVersion).map((value) =>
            option(
              value,
              value === 'pip'
                ? '推荐：requirements.txt'
                : value === 'poetry'
                  ? 'pyproject.toml + poetry.lock'
                  : 'pyproject.toml + uv.lock',
            ),
          ),
        },
      ],
      agent,
      signal,
    });
    framework = framework || oneOf(answer, 0) || frameworks[0];
    packageManager = packageManager || oneOf(answer, 1) || 'pip';
  }

  const details = {
    stack: 'python',
    framework,
    runtimeVersion: pythonVersion,
    pythonVersion,
    packageManager,
    language: 'python',
  };
  const checked = validateSide(details);
  if (!checked.ok) return checked;
  return { ok: true, details };
}

async function askNodeDetails({ userQuestions, agent, signal, side, initial = {} }) {
  let nodeVersion = initial.nodeVersion || initial.runtimeVersion;
  let packageManager = initial.packageManager;
  if (!nodeVersion || !packageManager) {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-v4-' + side.id + '-node-version',
          header: side.id + ' / Node',
          question: '选择 Node LTS 版本',
          options: NODE_VERSIONS.map((value) => option(value, value === '22' ? '推荐 LTS' : '')),
        },
        {
          id: 'sg-v4-' + side.id + '-node-package-manager',
          header: side.id + ' / 包管理器',
          question: '选择包管理器',
          options: NODE_PACKAGE_MANAGERS.map((value) =>
            option(value, value === 'pnpm' ? '推荐' : ''),
          ),
        },
      ],
      agent,
      signal,
    });
    nodeVersion = nodeVersion || oneOf(answer, 0) || '22';
    packageManager = packageManager || oneOf(answer, 1) || 'pnpm';
  }

  let framework = initial.framework;
  if (!framework) {
    const answer = await askOne({
      userQuestions,
      agent,
      signal,
      id: 'sg-v4-' + side.id + '-node-framework',
      header: side.id + ' / Node 框架',
      question: '选择后端框架',
      options: [
        option('express', '推荐：生态最大'),
        option('fastify', '推荐：高性能 + Schema'),
        option('nestjs', '推荐：TypeScript 企业级'),
      ],
    });
    framework = answer.selected[0] || 'express';
  }

  let language = initial.language;
  if (!language) {
    const languages = nodeLanguages(framework);
    const answer = await askOne({
      userQuestions,
      agent,
      signal,
      id: 'sg-v4-' + side.id + '-node-language',
      header: side.id + ' / 语言',
      question: '选择语言（' + framework + ' 可选：' + languages.join(' / ') + '）',
      options: languages.map((value) => option(value, value === 'typescript' ? '推荐' : '')),
    });
    language = answer.selected[0] || languages[0];
  }

  const details = {
    stack: 'node',
    framework,
    runtimeVersion: nodeVersion,
    nodeVersion,
    packageManager,
    language,
    jsLanguage: language,
  };
  const checked = validateSide(details);
  if (!checked.ok) return checked;
  return { ok: true, details };
}

async function askFrontendDetails({ userQuestions, agent, signal, side, initial = {} }) {
  let language = initial.language;
  if (!language) {
    const answer = await askOne({
      userQuestions,
      agent,
      signal,
      id: 'sg-v4-' + side.id + '-frontend-language',
      header: side.id + ' / 前端语言',
      question: '选择 TypeScript 还是 JavaScript（构建工具固定 Vite）',
      options: FRONTEND_LANGUAGES.map((value) =>
        option(value, value === 'typescript' ? '推荐' : ''),
      ),
    });
    language = answer.selected[0] || 'typescript';
  }
  const details = {
    stack: side.stack,
    framework: side.stack,
    runtimeVersion: null,
    buildTool: 'vite',
    language,
  };
  const checked = validateSide(details);
  if (!checked.ok) return checked;
  return { ok: true, details };
}

async function askDependencies({ userQuestions, agent, signal, side, details, initial = {} }) {
  const merged = { ...side, ...details };
  const catalog = dependencyCatalog(merged);
  let preset = initial.preset;
  if (!preset) {
    const options = [
      option('minimal', '只含运行/测试/格式/检查的最小集合'),
      option('recommended', '推荐组合（默认）'),
      option('full', '目录内全部兼容可选项'),
    ];
    if (catalog.optional.length) options.push(option('custom', '逐项勾选可选依赖'));
    const answer = await askOne({
      userQuestions,
      agent,
      signal,
      id: 'sg-v4-' + side.id + '-deps-preset',
      header: side.id + ' / 依赖预设',
      question:
        '选择依赖预设。必选依赖已锁定；可选依赖可按 minimal / recommended / full' +
        (catalog.optional.length ? ' 或逐项 custom' : '') +
        '。',
      options,
    });
    preset = answer.selected[0] || 'recommended';
  }

  let custom = Array.isArray(initial.optional) ? initial.optional : null;
  if (preset === 'custom' && !catalog.optional.length) {
    preset = 'minimal';
    custom = [];
  }
  if (preset === 'custom' && !custom) {
    const answer = await askOne({
      userQuestions,
      agent,
      signal,
      id: 'sg-v4-' + side.id + '-deps-optional',
      header: side.id + ' / 可选依赖',
      question: '勾选可选依赖（可多选；互斥组只能选一个）',
      multi: true,
      options: catalog.optional.map((item) =>
        option(item.id, item.label + (item.description ? '：' + item.description : '')),
      ),
    });
    custom = answer.selected.length
      ? answer.selected
      : answer.custom
        ? answer.custom
            .split(/[,，\n]/)
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
  }

  const resolved = resolveDependencies(merged, preset, custom);
  return { ...resolved, preset };
}

function detailsOf(sides) {
  return {
    sides: Object.fromEntries(
      sides.map((side) => [
        side.id,
        {
          stack: side.stack,
          framework: side.framework,
          runtimeVersion: side.runtimeVersion,
          buildTool: side.buildTool,
          bootVersion: side.bootVersion,
          packageManager: side.packageManager,
          language: side.language,
          preset: side.dependencies?.preset,
          optional: side.dependencies?.optional || [],
        },
      ]),
    ),
  };
}

function buildStaticSelection(selection, initial = {}) {
  const sides = [];
  for (const rawSide of selection.sides) {
    const sideInitial = initial.sides?.[rawSide.id] || {};
    const details = { ...defaultSideDetails(rawSide.stack, sideInitial.framework), ...sideInitial };
    const checked = validateSide(details);
    if (!checked.ok) return checked;
    const dependencies = resolveDependencies(
      { ...rawSide, ...details },
      sideInitial.preset || undefined,
      sideInitial.optional || undefined,
    );
    sides.push(applyDetailsToSide(rawSide, details, dependencies));
  }
  return {
    ok: true,
    backend: selection.backend,
    frontend: selection.frontend,
    preset: selection.preset || null,
    sides,
    interactive: false,
    details: detailsOf(sides),
  };
}

export async function askWizard({
  userQuestions,
  agent,
  signal,
  initial = {},
  preset = null,
  backend = null,
  frontend = null,
}) {
  const canAsk = Boolean(userQuestions && typeof userQuestions.ask === 'function');
  let selection = selectionFromInput(initial, preset, backend, frontend);
  let interactive = false;
  if (!selection && canAsk) {
    const picked = await askTopology({ userQuestions, agent, signal });
    selection = resolveSelection(picked);
    interactive = true;
  }
  if (!selection) {
    selection = resolveSelection({
      backend: initial.backend || backend || 'node',
      frontend: initial.frontend || frontend || 'none',
    });
  }
  if (!selection.ok) return selection;
  if (!canAsk) return buildStaticSelection(selection, initial);
  interactive = true;

  const sides = [];
  for (const rawSide of selection.sides) {
    const sideInitial = initial.sides?.[rawSide.id] || {};
    let detailResult;
    if (rawSide.stack === 'java') {
      detailResult = await askJavaDetails({
        userQuestions,
        agent,
        signal,
        side: rawSide,
        initial: sideInitial,
      });
    } else if (rawSide.stack === 'python') {
      detailResult = await askPythonDetails({
        userQuestions,
        agent,
        signal,
        side: rawSide,
        initial: sideInitial,
      });
    } else if (rawSide.stack === 'node') {
      detailResult = await askNodeDetails({
        userQuestions,
        agent,
        signal,
        side: rawSide,
        initial: sideInitial,
      });
    } else {
      detailResult = await askFrontendDetails({
        userQuestions,
        agent,
        signal,
        side: rawSide,
        initial: sideInitial,
      });
    }
    if (!detailResult.ok) return detailResult;

    const dependencies = await askDependencies({
      userQuestions,
      agent,
      signal,
      side: rawSide,
      details: detailResult.details,
      initial: sideInitial,
    });
    sides.push(applyDetailsToSide(rawSide, detailResult.details, dependencies));
  }

  return {
    ok: true,
    backend: selection.backend,
    frontend: selection.frontend,
    preset: selection.preset || preset || null,
    sides,
    interactive,
    details: {
      backend: selection.backend,
      frontend: selection.frontend,
      sides: Object.fromEntries(
        sides.map((side) => [
          side.id,
          {
            stack: side.stack,
            framework: side.framework,
            runtimeVersion: side.runtimeVersion,
            buildTool: side.buildTool,
            bootVersion: side.bootVersion,
            packageManager: side.packageManager,
            language: side.language,
            preset: side.dependencies?.preset,
            optional: side.dependencies?.optional || [],
          },
        ]),
      ),
    },
  };
}

export function summarizeSelection(selection) {
  if (!selection || !selection.sides) return '（无技术栈选择）';
  return selection.sides
    .map((side) => {
      const parts = ['- ' + side.id + '：' + sideLabel(side)];
      const deps = side.dependencies || {};
      const required = (deps.required || []).map((id) => {
        const item = findDependency(side, id);
        return item ? item.label : id;
      });
      const optional = (deps.optional || []).map((id) => {
        const item = findDependency(side, id);
        return item ? item.label : id;
      });
      if (required.length) parts.push('  必选：' + required.join('、'));
      if (optional.length) parts.push('  可选：' + optional.join('、'));
      if (deps.dropped?.length) {
        parts.push(
          '  已取消：' + deps.dropped.map((item) => item.id + '（' + item.reason + '）').join('；'),
        );
      }
      return parts.join('\n');
    })
    .join('\n');
}

export function selectionFromInitial(initial = {}) {
  return askWizard({ userQuestions: null, initial });
}
