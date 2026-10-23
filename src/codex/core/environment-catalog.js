// 固定版本与校验值来自 Node/Adoptium/Apache 官方元数据，更新时必须重新核验。
const java = {
  win32: {
    8: [
      '8u504b01',
      'jdk8u504-b01',
      'ea43d46ede95b51e44a12c66711706cddc762e0a766c54bccea18954e902b2aa',
    ],
    17: [
      '17.0.20.1_1',
      'jdk-17.0.20.1%2B1',
      'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0',
    ],
    21: [
      '21.0.12.1_1',
      'jdk-21.0.12.1%2B1',
      'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e',
    ],
  },
  linux: {
    8: [
      '8u504b01',
      'jdk8u504-b01',
      '9c70e102f527ac674ac2fe9c7d47b9a04e2d19842ba5ab8e9b33f368bbadfaea',
    ],
    17: [
      '17.0.20.1_1',
      'jdk-17.0.20.1%2B1',
      '3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e',
    ],
    21: [
      '21.0.12.1_1',
      'jdk-21.0.12.1%2B1',
      'ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94',
    ],
  },
};

export function componentArchive(
  id,
  { platform = process.platform, source = 'domestic', env = process.env } = {},
) {
  if (
    !['win32', 'linux'].includes(platform) ||
    !['domestic', 'official', 'custom'].includes(source)
  )
    throw new Error('不支持的平台或下载源');
  const windows = platform === 'win32',
    os = windows ? 'windows' : 'linux';
  const ext = windows ? 'zip' : 'tar.gz';
  let version,
    name,
    checksum,
    algorithm = 'sha256',
    official,
    domestic,
    metadata;
  if (id === 'node') {
    version = '22.22.0';
    name = `node-v${version}-${windows ? 'win' : 'linux'}-x64.${ext}`;
    checksum = windows
      ? 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a'
      : 'c33c39ed9c80deddde77c960d00119918b9e352426fd604ba41638d6526a4744';
    official = `https://nodejs.org/dist/v${version}/${name}`;
    domestic = `https://npmmirror.com/mirrors/node/v${version}/${name}`;
    metadata = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
  } else if (id === 'maven') {
    version = '3.9.11';
    name = `apache-maven-${version}-bin.${ext}`;
    algorithm = 'sha512';
    checksum = windows
      ? '03e2d65d4483a3396980629f260e25cac0d8b6f7f2791e4dc20bc83f9514db8d0f05b0479e699a5f34679250c49c8e52e961262ded468a20de0be254d8207076'
      : 'bcfe4fe305c962ace56ac7b5fc7a08b87d5abd8b7e89027ab251069faebee516b0ded8961445d6d91ec1985dfe30f8153268843c89aa392733d1a3ec956c9978';
    official = `https://archive.apache.org/dist/maven/maven-3/${version}/binaries/${name}`;
    domestic = `https://maven.aliyun.com/repository/public/org/apache/maven/apache-maven/${version}/${name}`;
    metadata = official + '.sha512';
  } else if (/^jdk(8|17|21)$/.test(id)) {
    const major = id.slice(3),
      [build, release, hash] = java[platform][major];
    version = build;
    name = `OpenJDK${major}U-jdk_x64_${os}_hotspot_${build}.${ext}`;
    checksum = hash;
    official = `https://github.com/adoptium/temurin${major}-binaries/releases/download/${release}/${name}`;
    domestic = `https://mirrors.nju.edu.cn/adoptium/${major}/jdk/x64/${os}/${name}`;
    metadata = official + '.sha256.txt';
  } else return null;
  let url = source === 'official' ? official : domestic;
  if (source === 'custom') {
    const base = env.SPECGATE_BINARY_MIRROR;
    if (!base) throw new Error('自定义源需要 SPECGATE_BINARY_MIRROR');
    url = `${base.replace(/\/$/, '')}/${id}/${name}`;
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('镜像必须是无凭据、查询参数和片段的 HTTPS 地址');
  return { id, version, name, algorithm, checksum, url, metadata, source };
}
