import fs from 'node:fs';

// This bounded, data-only catalog is shared with native wrappers which cannot require Node.
export function nodeBootstrapArchive({ platform = process.platform, arch = process.arch } = {}) {
  const bytes = fs.readFileSync(new URL('./node-bootstrap.tsv', import.meta.url));
  if (bytes.length > 4096) throw new Error('Node bootstrap catalog is oversized');
  const rows = bytes
    .toString('utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split('|'));
  const matches = rows.filter((row) => row[0] === platform && row[1] === arch);
  if (matches.length !== 1)
    throw Object.assign(new Error('No supported Node bootstrap archive'), {
      code: 'ENV_PLATFORM_UNSUPPORTED',
    });
  const [, , , name, url, algorithm, checksum, metadata] = matches[0],
    version = matches[0][2];
  if (
    matches[0].length !== 8 ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    name !==
      `node-v${version}-${platform === 'win32' ? 'win' : 'linux'}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}` ||
    url !== `https://nodejs.org/dist/v${version}/${name}` ||
    algorithm !== 'sha256' ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    metadata !== `https://nodejs.org/dist/v${version}/SHASUMS256.txt`
  )
    throw new Error('Invalid Node bootstrap catalog');
  return { id: 'node', version, name, url, algorithm, checksum, metadata, source: 'official' };
}
