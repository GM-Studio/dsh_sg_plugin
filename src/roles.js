const DEVELOPMENT_ROLES = ['architect', 'ddd', 'developer'];

const KEYWORDS = {
  architect: [
    /architect/i,
    /architecture/i,
    /module/i,
    /interface/i,
    /boundary/i,
    /system design/i,
    /架构/,
    /模块/,
    /接口/,
    /边界/,
    /系统设计/,
    /分层/,
  ],
  ddd: [
    /ddd/i,
    /domain/i,
    /aggregate/i,
    /bounded context/i,
    /entity/i,
    /value object/i,
    /领域/,
    /聚合/,
    /限界上下文/,
    /实体/,
    /值对象/,
  ],
  developer: [
    /implement/i,
    /implementation/i,
    /code/i,
    /fix/i,
    /feature/i,
    /page/i,
    /api/i,
    /实现/,
    /开发/,
    /修复/,
    /功能/,
    /页面/,
    /接口/,
    /编写/,
  ],
};

function scoreText(role, text, weight = 2) {
  return (KEYWORDS[role] || []).reduce(
    (score, pattern) => score + (pattern.test(text) ? weight : 0),
    0,
  );
}

function scoreFiles(role, files) {
  let score = 0;
  for (const file of files) {
    const path = String(file).replace(/\\/g, '/');
    if (role === 'architect' && (/^docs\//.test(path) || /\.md$/i.test(path))) score += 2;
    if (role === 'ddd' && /(^|\/)(domain|domains|model|models|aggregate|aggregates)(\/|$)/i.test(path)) {
      score += 2;
    }
    if (role === 'developer' && /(^|\/)(src|lib|app|tests?|test)(\/|$)/i.test(path)) score += 2;
  }
  return score;
}

function cleanContext(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^#/.test(line.trim()) &&
        !/待补充|影响的(需求|模块)|风险：|包含：|不包含：|Requirement delta|change\.json|change\.md|Architecture|Technical Approach/.test(
          line,
        ),
    )
    .join('\n');
}

/**
 * Infer only development-side roles. Explicit `role:` always wins.
 * A low-confidence result is returned with `role: null` so the caller can stop
 * before creating any Agent and ask the user to add `role:`.
 */
export function inferTaskRole(task, contextText = '') {
  if (task.role) {
    return {
      role: task.role,
      explicit: true,
      confidence: 1,
      scores: { [task.role]: 1 },
      reason: 'tasks.md 显式指定 role',
    };
  }
  const localText = `${task.title || ''}\n${task.text || ''}`;
  const context = cleanContext(contextText);
  const scores = Object.fromEntries(
    DEVELOPMENT_ROLES.map((role) => [
      role,
      scoreText(role, localText, 2) +
        scoreFiles(role, task.files || []) +
        scoreText(role, context, 1),
    ]),
  );
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [topRole, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  const confident = topScore >= 2 && topScore - secondScore >= 1;
  return {
    role: confident ? topRole : null,
    explicit: false,
    confidence: confident ? topScore : 0,
    scores,
    candidates: ranked,
    reason: confident
      ? `关键词/文件信号匹配 ${topRole}`
      : '角色推断置信度不足',
  };
}

export function inferTaskRoles(tasks, contextText = '') {
  const results = tasks.map((task) => ({ task, ...inferTaskRole(task, contextText) }));
  return {
    results,
    unresolved: results.filter((result) => !result.role && !result.task.done),
  };
}

export function rolesToPrompt(unresolved) {
  return unresolved
    .map((result) => {
      const candidates = (result.candidates || [])
        .map(([role, score]) => `${role}(${score})`)
        .join(', ');
      return `${result.task.id}: 无法确定角色。候选：${candidates}。请在 tasks.md 添加 role: architect|ddd|developer`;
    })
    .join('\n');
}

export { DEVELOPMENT_ROLES };
