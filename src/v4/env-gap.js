import fs from 'node:fs';
import path from 'node:path';
import { exists } from '../v3/util/fsx.js';

/** 已安装工具链的 env.json（只读）；存在时作为质量阶段的基础环境。 */
export function installedEnv(environment) {
  const payload = environment?.toolchain?.env;
  if (!payload) return null;
  const vars = payload.vars && typeof payload.vars === 'object' ? payload.vars : {};
  const bin = Array.isArray(payload.bin) ? payload.bin : [];
  return { vars, bin };
}

/** 只有“零缺口”才构造质量阶段可用的 toolchain；否则返回 null 并跳过质量。 */
export function toolchainFromPlan(plan, environment) {
  if (!plan || plan.ok === false) return null;
  if ((plan.actions || []).length) return null;
  const tools = { ...(plan.tools || {}) };
  const installed = installedEnv(environment);
  if (installed) {
    tools.extraEnv = installed.vars;
    tools.extraBin = installed.bin;
  }
  return tools;
}

export function gapsOf(plan) {
  if (!plan || plan.ok === false) return [];
  return plan.actions || [];
}

export function gapText(gaps) {
  return gaps.map((item) => item.tool + ' ' + item.version).join(' / ');
}

export function gapReason(plan) {
  if (!plan) return '环境未知（未扫描）';
  if (plan.ok === false) return plan.message || '环境未知';
  const gaps = gapsOf(plan);
  if (!gaps.length) return '环境未就绪';
  return '环境缺口：' + gapText(gaps) + '；执行 /sg-env install 后重跑 /sg-init 补跑质量';
}

/** 审批页的环境摘要：只描述复用与缺口，不承诺安装。 */
export function approvalEnvironmentText(plan) {
  if (!plan) return '未扫描环境（无问答通道）；质量阶段将跳过';
  if (plan.ok === false) {
    return '环境未知：' + plan.message + '；初始化不下载，质量阶段将跳过';
  }
  const reuse = [];
  if (plan.tools?.node) reuse.push('node ' + (plan.tools.node.version || ''));
  if (plan.tools?.pnpm) reuse.push('pnpm ' + (plan.tools.pnpm.version || ''));
  if (plan.tools?.python) reuse.push('python ' + (plan.tools.python.version || ''));
  if (plan.tools?.java) reuse.push('java ' + (plan.tools.java.version || ''));
  if (plan.tools?.maven) reuse.push('maven ' + (plan.tools.maven.version || ''));
  if (plan.tools?.gradle) reuse.push('gradle ' + (plan.tools.gradle.version || ''));
  if (plan.tools?.uv) reuse.push('uv ' + (plan.tools.uv.version || ''));
  const gaps = gapsOf(plan);
  const lines = [];
  if (reuse.length) lines.push('复用：' + reuse.join(' / '));
  if (gaps.length) {
    lines.push('缺口：' + gapText(gaps));
    lines.push('初始化不下载/不安装；补齐后重跑 /sg-init 补跑质量');
  } else {
    lines.push('环境就绪：可执行质量阶段');
  }
  return lines.join('\n');
}

function readSideQuality(sideRoot) {
  const file = path.join(sideRoot, '.specgate', 'init-report.json');
  if (!exists(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).quality || null;
  } catch {
    return null;
  }
}

/** 上次因环境缺口跳过质量、且当前环境可能已补齐的 side。 */
export function staleQualitySides(root, sides) {
  return sides.filter((side) => {
    const quality = readSideQuality(path.join(root, side.path));
    if (!quality) return false;
    if (quality.status === 'passed') return false;
    return /^环境缺口/.test(String(quality.message || ''));
  });
}
