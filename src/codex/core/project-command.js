import fs from 'node:fs';
import path from 'node:path';
import { commandSpec } from './java/verify-evidence.js';

// Resolve only declared project launchers, using a bounded PATH search. Windows
// batch files need an absolute path so their own relative tool paths stay valid.
export function projectCommandSpec(command, args) {
  let executable = command;
  if (process.platform === 'win32') {
    if (/^(?:npm|npx|pnpm|yarn|mvn|mvnw|gradlew)$/i.test(executable)) executable += '.cmd';
    if (!/[\\/]/.test(executable) && /\.(cmd|bat)$/i.test(executable)) {
      const found = String(process.env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean)
        .slice(0, 128)
        .map((directory) => path.join(directory.replace(/^"|"$/g, ''), executable))
        .find((file) => {
          try {
            return fs.statSync(file).isFile();
          } catch {
            return false;
          }
        });
      if (found) executable = found;
    }
  }
  return commandSpec(executable, args);
}
