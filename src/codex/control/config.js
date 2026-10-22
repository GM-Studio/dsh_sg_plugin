import os from 'node:os';
import path from 'node:path';

const PORTABLE_ENV_NAMES = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TMP',
  'TEMP',
  'TMPDIR',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'ComSpec',
  'COMSPEC',
  'LANG',
  'LC_ALL',
  'TERM',
  'NO_COLOR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AWS_REGION',
  'AWS_PROFILE',
]);
const PORTABLE_ENV_PREFIXES = ['CODEX_', 'LC_', 'XDG_'];

export function resolveControlRoot({ env = process.env, homeDirectory = os.homedir() } = {}) {
  const explicit = env.SPECGATE_CONTROL_HOME;
  if (explicit) return path.resolve(explicit);
  const codexHome = env.CODEX_HOME || path.join(homeDirectory, '.codex');
  return path.resolve(codexHome, 'specgate-control');
}

export function controlExecutionEnvironment({
  env = process.env,
  projectRoot,
  controlRoot,
  workItemId,
} = {}) {
  const allowed = new Set(
    String(env.SPECGATE_CODEX_ENV_ALLOWLIST || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const output = {};
  for (const [key, value] of Object.entries(env)) {
    if (
      PORTABLE_ENV_NAMES.has(key) ||
      PORTABLE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
      allowed.has(key)
    )
      output[key] = value;
  }
  if (projectRoot) output.SPECGATE_PROJECT_ROOT = projectRoot;
  if (controlRoot) output.SPECGATE_CONTROL_HOME = controlRoot;
  if (workItemId) {
    output.SPECGATE_WORK_ITEM_ID = workItemId;
    output.SPECGATE_CONTROL_MODE = '1';
  }
  return output;
}

export function localControlEnvironment(env = process.env) {
  return {
    controlRoot: resolveControlRoot({ env }),
    ownerId: env.SPECGATE_OWNER_ID || 'local-owner',
    mfaSecret: env.SPECGATE_MFA_SECRET || null,
    feishuWebhookUrl: env.SPECGATE_FEISHU_WEBHOOK_URL || null,
    managementPort:
      env.SPECGATE_MANAGEMENT_PORT && Number.isSafeInteger(Number(env.SPECGATE_MANAGEMENT_PORT))
        ? Number(env.SPECGATE_MANAGEMENT_PORT)
        : 43120,
    managementPublicUrl:
      env.SPECGATE_MANAGEMENT_PUBLIC_URL ||
      `http://127.0.0.1:${
        env.SPECGATE_MANAGEMENT_PORT && Number.isSafeInteger(Number(env.SPECGATE_MANAGEMENT_PORT))
          ? Number(env.SPECGATE_MANAGEMENT_PORT)
          : 43120
      }`,
    codexCommand: env.SPECGATE_CODEX_COMMAND || 'codex',
    codexHome: env.SPECGATE_CODEX_HOME || null,
    codexSandbox: env.SPECGATE_CODEX_SANDBOX || 'workspace-write',
  };
}
