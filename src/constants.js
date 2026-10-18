/**
 * SpecGate DSH plugin constants.
 *
 * The gate order follows templates/qoder/rules/gate-control.md. The paradigm
 * semantics follow src/core/flows/index.ts and AGENTS.md:
 *   L1 = requirement-driven (heaviest)
 *   L2 = technical implementation
 *   L3 = defect fix (lightest; proposal/design/specs can be skipped)
 */

export const GATE_ORDER = [
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  'G6.5',
  'G7',
  'G8',
  'G9',
  'G10',
  'G11',
];

export const GATES = {
  G1: {
    id: 'G1',
    name: '需求理解确认',
    nameEn: 'Requirements confirmation',
    ask: '需求理解是否正确？是否可以进入变更分类？',
    askEn: 'Is the requirement understood correctly? May we move to change classification?',
  },
  G2: {
    id: 'G2',
    name: '变更分类确认',
    nameEn: 'Change classification',
    ask: '当前变更判定为 {paradigm}，对应流程强度为 {strength}，是否确认？',
    askEn: 'This change is classified as {paradigm} with {strength} process. Confirm?',
  },
  G3: {
    id: 'G3',
    name: 'proposal 评审',
    nameEn: 'Proposal review',
    ask: 'proposal 已创建，是否通过评审？',
    askEn: 'The proposal is ready. Does it pass review?',
  },
  G4: {
    id: 'G4',
    name: 'design 评审',
    nameEn: 'Design review',
    ask: 'design 已创建，是否通过评审？',
    askEn: 'The design is ready. Does it pass review?',
  },
  G5: {
    id: 'G5',
    name: 'specs 评审',
    nameEn: 'Specs review',
    ask: 'specs 是否按垂直切片组织？是否覆盖所有需求？是否需要补充？',
    askEn: 'Are specs organized as vertical slices, covering every requirement? Any gaps?',
  },
  G6: {
    id: 'G6',
    name: 'tasks 评审',
    nameEn: 'Tasks review',
    ask: 'tasks 拆分是否合理？粒度是否合适？',
    askEn: 'Are tasks split sensibly with the right granularity?',
  },
  'G6.5': {
    id: 'G6.5',
    name: 'Brief 生成检查',
    nameEn: 'Brief check',
    ask: '当前变更规模符合 Brief 生成条件，是否现在生成 Agent Brief？',
    askEn: 'This change is large enough for a Brief. Generate the Agent Brief now?',
  },
  G7: {
    id: 'G7',
    name: '批判性审核 / 进入实施',
    nameEn: 'Critical review / implementation',
    ask: '是否确认进入实施阶段？',
    askEn: 'Confirm entering implementation?',
  },
  G8: {
    id: 'G8',
    name: '代码审查',
    nameEn: 'Code review',
    ask: '是否启动代码审查？',
    askEn: 'Start code review?',
  },
  G9: {
    id: 'G9',
    name: '审查通过 / 提交',
    nameEn: 'Review passed / commit',
    ask: '审查通过，是否提交代码？',
    askEn: 'Review passed. Commit the code?',
  },
  G10: {
    id: 'G10',
    name: '功能验收',
    nameEn: 'Acceptance',
    ask: '是否启动验收测试？',
    askEn: 'Start acceptance testing?',
  },
  G11: {
    id: 'G11',
    name: '分支处理',
    nameEn: 'Branch handling',
    ask: '是否合并分支 / 创建 PR？',
    askEn: 'Merge the branch or create a PR?',
  },
};

/**
 * Gate prerequisites. A gate can only be confirmed when its prerequisites are
 * already satisfied (confirmed or waived).
 */
export const GATE_REQUIRES = {
  G1: [],
  G2: ['G1'],
  G3: ['G1', 'G2'],
  G4: ['G1', 'G2', 'G3'],
  G5: ['G1', 'G2', 'G3', 'G4'],
  G6: ['G1', 'G2', 'G3', 'G4', 'G5'],
  'G6.5': ['G6'],
  G7: ['G6'],
  G8: ['G7'],
  G9: ['G8'],
  G10: ['G9'],
  G11: ['G10'],
};

/**
 * Gate requirements for writing a given artifact/source kind.
 * These are intentionally stricter than the legacy Qoder hook for proposal:
 * G2 must be confirmed before proposal, because the flow requires classification
 * before artifact creation.
 */
export const ARTIFACT_REQUIREMENTS = {
  proposal: ['G1', 'G2'],
  design: ['G1', 'G2', 'G3'],
  specs: ['G1', 'G2', 'G3', 'G4'],
  tasks: ['G1', 'G2', 'G3', 'G4', 'G5'],
  test: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
  source: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
};

export const PARADIGM_LABELS = {
  L1: '需求驱动（全量流程）',
  L2: '技术实现（标准流程）',
  L3: '缺陷修复（简化流程）',
};

export const PARADIGM_LABELS_EN = {
  L1: 'Requirement-driven (full process)',
  L2: 'Technical implementation (standard process)',
  L3: 'Defect fix (streamlined process)',
};

export const PARADIGM_GATE_EXEMPTIONS = {
  L1: [],
  L2: [],
  L3: ['G1', 'G3', 'G4', 'G5', 'G6.5'],
};

export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.rs',
  '.rb',
  '.php',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.kt',
  '.swift',
  '.vue',
  '.svelte',
  '.scala',
  '.sh',
  '.ps1',
]);

export const TEST_PATH_PATTERNS = [
  /(^|[\\/])__tests__([\\/]|$)/,
  /(^|[\\/])tests?([\\/]|$)/i,
  /\.(test|spec)\.[^.\\/]+$/i,
  /(^|[\\/])test_[^\\/]+$/i,
  /_test\.[^.\\/]+$/i,
];

export const ARTIFACT_PATTERNS = [
  { kind: 'tasks', re: /(^|[\\/])openspec[\\/]changes[\\/][^\\/]+[\\/]tasks\.md$/i },
  { kind: 'design', re: /(^|[\\/])openspec[\\/]changes[\\/][^\\/]+[\\/]design\.md$/i },
  { kind: 'proposal', re: /(^|[\\/])openspec[\\/]changes[\\/][^\\/]+[\\/]proposal\.md$/i },
  { kind: 'specs', re: /(^|[\\/])openspec[\\/]changes[\\/][^\\/]+[\\/]specs[\\/]/i },
];

export const DEFAULT_CONFIG = {
  version: 1,
  enabled: true,
  enforcement: 'hybrid',
  paradigm: null,
  language: 'zh',
  git: true,
  minimal: false,
  maxConcurrency: 4,
  materializeSkills: true,
  materializeAgents: true,
};
