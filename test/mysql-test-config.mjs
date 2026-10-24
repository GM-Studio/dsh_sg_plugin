import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localConfig = path.join(projectRoot, '.runtime', 'mysql-test', 'config.json');

export async function readMysqlTestOptions() {
  const configPath = process.env.SPECGATE_MYSQL_TEST_CONFIG || localConfig;
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw Object.assign(
        new Error(
          'A real MySQL test instance is required. Set SPECGATE_MYSQL_TEST_CONFIG or create .runtime/mysql-test/config.json.',
        ),
        { code: 'MYSQL_TEST_CONFIG_REQUIRED' },
      );
    }
    throw error;
  }
  let options;
  try {
    options = JSON.parse(content);
  } catch {
    throw Object.assign(new Error('MySQL test configuration is not valid JSON'), {
      code: 'MYSQL_TEST_CONFIG_INVALID',
    });
  }
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    typeof options.host !== 'string' ||
    !options.host.trim() ||
    !Number.isSafeInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535 ||
    typeof options.user !== 'string' ||
    !options.user.trim() ||
    (options.password !== undefined && typeof options.password !== 'string')
  ) {
    throw Object.assign(new Error('MySQL test configuration is invalid'), {
      code: 'MYSQL_TEST_CONFIG_INVALID',
    });
  }
  return { ...options };
}
