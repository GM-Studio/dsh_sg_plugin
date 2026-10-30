import { matchesVersion, versionTuple } from './env/version-range.js';

async function metadata(url, fetchImpl, signal) {
  const response = await fetchImpl(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    throw Object.assign(new Error('安装元数据读取失败 HTTP ' + response.status), {
      code: 'ENV_METADATA_FAILED',
    });
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('安装元数据超过上限');
  return JSON.parse(text);
}

// Metadata lookup is preparation-only. Read-only checks never perform network IO.
// Exact URL, version and checksum are resolved before requesting human consent.
export async function resolveToolArchive(
  id,
  { platform, source, constraints = [], fetchImpl = fetch, signal } = {},
) {
  if (!['go', 'python'].includes(id)) return null;
  if (source !== 'official')
    throw Object.assign(
      new Error(id + ' 自动安装目前仅提供官方源，请显式选择 source=official 后重试'),
      { code: 'ENV_SOURCE_UNSUPPORTED' },
    );
  const compatible = (version) =>
    constraints.every((constraint) => matchesVersion(version, constraint));
  if (id === 'go') {
    const releases = await metadata('https://go.dev/dl/?mode=json&include=all', fetchImpl, signal);
    for (const release of releases) {
      const version = String(release.version || '').replace(/^go/, '');
      if (!release.stable || !compatible(version)) continue;
      const file = release.files?.find(
        (entry) =>
          entry.os === (platform === 'win32' ? 'windows' : 'linux') &&
          entry.arch === 'amd64' &&
          entry.kind === 'archive',
      );
      if (file && /^[a-f0-9]{64}$/.test(file.sha256))
        return {
          id,
          version,
          name: file.filename,
          algorithm: 'sha256',
          checksum: file.sha256,
          url: 'https://go.dev/dl/' + file.filename,
          metadata: 'https://go.dev/dl/?mode=json&include=all',
          source,
        };
    }
  } else {
    const release = await metadata(
      'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest',
      fetchImpl,
      signal,
    );
    const suffix =
      platform === 'win32'
        ? 'x86_64-pc-windows-msvc-install_only.tar.gz'
        : 'x86_64-unknown-linux-gnu-install_only.tar.gz';
    const candidates = (release.assets || [])
      .filter(
        (entry) => entry.name?.endsWith(suffix) && /^sha256:[a-f0-9]{64}$/.test(entry.digest || ''),
      )
      .map((entry) => ({ entry, version: /^cpython-(\d+\.\d+\.\d+)\+/.exec(entry.name)?.[1] }))
      .filter(({ version }) => version && compatible(version));
    candidates.sort((a, b) => {
      const x = versionTuple(a.version),
        y = versionTuple(b.version);
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
      return 0;
    });
    const candidate = candidates[0];
    if (candidate)
      return {
        id,
        version: candidate.version,
        name: candidate.entry.name,
        algorithm: 'sha256',
        checksum: candidate.entry.digest.slice(7),
        url: candidate.entry.browser_download_url,
        metadata: release.html_url,
        source,
      };
  }
  throw Object.assign(new Error('未找到匹配项目版本约束的可信归档：' + id), {
    code: 'ENV_INSTALL_VERSION_UNAVAILABLE',
  });
}
