import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyJavaPreset } from './java-versions.js';

const source = fileURLToPath(new URL('../../../../assets/java-vue/template/', import.meta.url));

/** One readable source tree; generation never executes commands or connects to the network. */
export function javaFullstackFiles(options = {}) {
  const files = {};
  function read(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) read(path.join(directory, entry.name), name + '/');
      else if (entry.isFile() && name.endsWith('.tpl')) {
        files[name.slice(0, -4)] = fs
          .readFileSync(path.join(directory, entry.name), 'utf8')
          .replace(/\r\n/g, '\n');
      }
    }
  }
  read(source);
  const out = options.preset ? applyJavaPreset(files, options.preset) : files;
  const samples = Object.keys(out).filter((name) =>
    /^(backend\/src\/|frontend\/(src|test)\/|docs\/(api|style)\.md|backend\/(pom|checkstyle)\.xml|frontend\/(package\.json|vite\.config\.ts))/.test(
      name,
    ),
  );
  out['.specgate/template-style.json'] =
    JSON.stringify(
      {
        schemaVersion: 1,
        version: 'java-vue-admin-1',
        preset: options.preset?.id || 'jdk8-boot2.7',
        samples: Object.fromEntries(
          samples.sort().map((name) => {
            const reference = '.specgate/examples/java-vue-admin-1/' + name;
            out[reference] = out[name];
            return [reference, createHash('sha256').update(out[name]).digest('hex')];
          }),
        ),
        coverage: { lines: 80, branches: 70 },
      },
      null,
      2,
    ) + '\n';
  return out;
}
