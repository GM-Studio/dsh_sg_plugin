import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(
  fs.readFileSync(new URL('../../.codex-plugin/plugin.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const SERVER_INFO = { name: manifest.name, version: manifest.version };

const descriptions = {
  health:
    'Check whether the local SpecGate Codex MCP adapter is responding. This does not verify a Java/Vue project.',
  version: 'Read Codex adapter, DSH package and supported MCP protocol versions.',
  status:
    'Inspect the P0 adapter status and whether the bound project has legacy state. Does not initialize, verify or advance a project.',
};

export const TOOLS = Object.entries(descriptions).map(([name, description]) => ({
  name,
  description,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}));

export function callDiagnostic(name, { projectRoot, protocolVersion }) {
  let data;
  switch (name) {
    case 'health':
      data = { ok: true, service: SERVER_INFO.name, stage: 'P0', transport: 'stdio' };
      break;
    case 'version':
      data = { ...SERVER_INFO, dshVersion: pkg.version, protocolVersion };
      break;
    case 'status':
      data = {
        stage: 'P0',
        projectRoot: path.resolve(projectRoot),
        workflow: { status: 'not-implemented' },
        verification: { status: 'not-run', scope: 'codex-project-workflow' },
        legacyStateDetected: fs.existsSync(path.join(projectRoot, '.specgate/state.json')),
        trustedApproval: { status: 'unavailable' },
      };
      break;
    default:
      throw new Error('Unknown diagnostic');
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  };
}
