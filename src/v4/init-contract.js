import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const approvals = new WeakMap();
const ignoredDirectories = new Set(['node_modules', '.venv', 'toolchains', 'm2repo', 'objects']);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Read-only observation; never follow links or run project commands before approval. */
export function observeInitTarget(root) {
  const rows = [];
  let bytes = 0;
  let ancestor = path.resolve(root);
  for (;;) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink())
      throw new Error('初始化目标的祖先路径为符号链接：' + ancestor);
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  function visit(file, relative) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      throw new Error('初始化目标包含符号链接，需先明确安全范围：' + relative);
    }
    if (stat.isDirectory()) {
      rows.push([relative, 'directory']);
      if (relative && ignoredDirectories.has(path.basename(file))) {
        rows.push([relative, 'excluded', stat.mtimeMs]);
        return;
      }
      for (const name of fs.readdirSync(file).sort())
        visit(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (rows.length > 50000 || bytes > 128 * 1024 * 1024) {
        throw new Error('目标目录过大，无法安全核对初始化变更；请缩小目标范围');
      }
      rows.push([relative, 'file', digest(fs.readFileSync(file))]);
    } else {
      throw new Error('目标目录包含不支持的特殊文件：' + relative);
    }
  }
  if (fs.existsSync(root)) {
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('初始化目标不能是符号链接');
    visit(root, '');
  } else {
    let parent = path.dirname(root);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    rows.push(['missing', root, fs.realpathSync(parent)]);
  }
  return digest(JSON.stringify(rows));
}

export function createInitContract({
  root,
  selection,
  profile,
  operation = 'create',
  requirements = {},
  environment = '',
}) {
  const contract = JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      root: path.resolve(root),
      profile,
      operation,
      selection,
      requirements,
      environment,
      observation: observeInitTarget(root),
      scope: {
        storage: 'memory',
        persistence: false,
        globalEnvironmentChanges: false,
        toolchainDownloads: false,
        verification:
          profile === 'minimal' ? 'deferred' : 'install-format-lint-build-test-start-http-crud',
        excluded: ['正式业务规则', '鉴权', '生产部署', '持久化'],
      },
    }),
  );
  contract.id = digest(JSON.stringify(contract));
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  return freeze(contract);
}

/** A receipt is minted only by the question-service boundary, never from tool arguments. */
export async function requestInitApproval({
  contract,
  userQuestions,
  agent,
  signal,
  text,
  minimal = false,
}) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') return { decision: 'cancelled' };
  const executeLabel = '确认方案 ' + contract.id.slice(0, 12) + ' 并开始初始化';
  try {
    const answer = await userQuestions.ask({
      questions: [
        {
          id: minimal ? 'sg-v4-minimal-confirm' : 'sg-v4-quality-approval',
          header: '执行批准（确认前零变更）',
          question: text,
          options: [
            { label: '返回修改', description: '只修改方案，不执行项目操作' },
            { label: '暂不执行', description: '不写文件、不安装依赖、不创建 Git 基线' },
            {
              label: executeLabel,
              description: '仅授权本页展示的目标、范围和命令；实质变更重新确认',
            },
          ],
        },
      ],
      agent,
      signal,
    });
    if (signal?.aborted) return { decision: 'cancelled' };
    const item =
      answer?.answers?.find(
        (entry) => entry.id === (minimal ? 'sg-v4-minimal-confirm' : 'sg-v4-quality-approval'),
      ) || answer?.answers?.[0];
    const selected = Array.isArray(item?.selected) ? item.selected : [item?.selected];
    if (selected.length !== 1) return { decision: 'cancelled' };
    if (selected[0] === '返回修改') return { decision: 'modify' };
    if (selected[0] !== executeLabel) return { decision: 'cancelled' };
    const receipt = Object.freeze({ contractId: contract.id });
    approvals.set(receipt, contract);
    return { decision: 'approved', receipt };
  } catch {
    return { decision: 'cancelled' };
  }
}

export function consumeInitApproval(contract, receipt, signal) {
  const approved = receipt && approvals.get(receipt);
  if (receipt) approvals.delete(receipt);
  if (signal?.aborted || approved !== contract) {
    return {
      ok: false,
      code: 'APPROVAL_REQUIRED',
      message: '没有本版方案的有效执行批准；未变更项目',
    };
  }
  try {
    if (observeInitTarget(contract.root) !== contract.observation) {
      return {
        ok: false,
        code: 'TARGET_CHANGED',
        message: '确认期间目标目录发生变化；旧批准失效，请重新澄清确认',
      };
    }
  } catch (error) {
    return { ok: false, code: 'TARGET_UNREADABLE', message: error.message };
  }
  return { ok: true };
}

/** These requirements describe the supported scaffold, not an invented product. */
export async function clarifyInitRequirements({ userQuestions, agent, signal, profile }) {
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return {
      ok: false,
      code: 'APPROVAL_REQUIRED',
      message: '需要交互式问答澄清并批准；未变更项目',
    };
  }
  const defaults = {
    functional:
      profile === 'minimal'
        ? '仅接入工程契约与 Git 基线'
        : '通用 Item CRUD 示例（不包含正式业务规则）',
    nonFunctional:
      profile === 'minimal' ? '暂不生成或验证运行代码' : '内存存储、基本校验和测试；重启丢失数据',
    constraints: '不覆盖已有业务代码，不修改全局环境，不自动下载工具链',
  };
  const result = {};
  try {
    for (const [key, value] of Object.entries(defaults)) {
      const answer = await userQuestions.ask({
        questions: [
          {
            id: 'sg-v4-init-' + key,
            header:
              key === 'functional'
                ? '初始化功能范围'
                : key === 'nonFunctional'
                  ? '非功能需求与数据行为'
                  : '初始化约束',
            question:
              value + '。使用此最小范围，或填写不同要求（超出模板能力时先停止设计，不自动降级）。',
            options: [
              { label: '使用上述范围', description: value },
              { label: '暂不执行', description: '停止澄清，不变更项目' },
            ],
          },
        ],
        agent,
        signal,
      });
      if (signal?.aborted) return { ok: false, code: 'CANCELLED', message: '用户取消；未变更项目' };
      const item =
        answer?.answers?.find((entry) => entry.id === 'sg-v4-init-' + key) || answer?.answers?.[0];
      const custom = String(item?.custom || '').trim();
      const selected = Array.isArray(item?.selected) ? item.selected : [item?.selected];
      if (custom) {
        return {
          ok: false,
          code: 'NEEDS_DESIGN',
          message: '要求超出当前标准初始化契约，请先完善方案：' + custom,
          draft: { ...result, [key]: custom },
        };
      }
      if (selected.length !== 1 || selected[0] !== '使用上述范围') {
        return { ok: false, code: 'CANCELLED', message: '需求尚未确认；未变更项目' };
      }
      result[key] = value;
    }
    return { ok: true, requirements: result };
  } catch {
    return { ok: false, code: 'QUESTIONS_UNAVAILABLE', message: '问答不可用；未变更项目' };
  }
}
