# SpecGate 环境一键安装引导（Windows）：确保可用的 Node >= 20.19 后执行 install-env.mjs。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\install-env.ps1 [--check|--json|--only=...|--reinstall|--method=...]
$ErrorActionPreference = 'Stop'
$installerArgs = $args

function Test-NodeUsable {
  param([string]$NodePath)
  if (-not $NodePath -or -not (Test-Path $NodePath)) { return $false }
  try {
    & $NodePath -e 'const v = process.versions.node.split(".").map(Number); process.exit(v[0] > 20 || (v[0] === 20 && v[1] >= 19) ? 0 : 1);' | Out-Null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Get-NodeCandidate {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Invoke-Installer {
  param([string]$NodePath)
  & $NodePath (Join-Path $PSScriptRoot 'install-env.mjs') @installerArgs
  exit $LASTEXITCODE
}

$candidate = Get-NodeCandidate
if (Test-NodeUsable $candidate) { Invoke-Installer $candidate }

$toolchains = if ($env:SPECGATE_TOOLCHAINS) { $env:SPECGATE_TOOLCHAINS } else { Join-Path $HOME '.specgate\toolchains' }
$portableNode = Join-Path $toolchains 'node-current\node.exe'
if (Test-NodeUsable $portableNode) { Invoke-Installer $portableNode }

Write-Host '[SpecGate] 未找到可用 Node（>= 20.19），尝试 winget / choco 安装...'
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
}
$candidate = Get-NodeCandidate
if (-not (Test-NodeUsable $candidate)) {
  $choco = Get-Command choco -ErrorAction SilentlyContinue
  if ($choco) { choco install nodejs-lts -y --no-progress | Out-Null }
}
# 刷新 PATH 后复查（安装器写入的是机器/用户级环境变量）。
$env:PATH = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$candidate = Get-NodeCandidate
if (Test-NodeUsable $candidate) { Invoke-Installer $candidate }
if (Test-NodeUsable $portableNode) { Invoke-Installer $portableNode }

# 便携下载官方 Node（无需管理员权限）。
$nodeVersion = 'v22.12.0'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$packageName = "node-$nodeVersion-win-$arch"
New-Item -ItemType Directory -Force -Path $toolchains | Out-Null
$zip = Join-Path $toolchains "$packageName.zip"
$url = "https://nodejs.org/dist/$nodeVersion/$packageName.zip"
Write-Host "[SpecGate] 下载 $url"
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($curl) {
  curl.exe -fL --retry 2 --connect-timeout 30 -o $zip $url
} else {
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $url -OutFile $zip
}
$extractRoot = Join-Path $toolchains "$packageName-extract"
if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
tar -xf $zip -C $toolchains
$extracted = Join-Path $toolchains $packageName
if (Test-Path $extracted) { Move-Item $extracted $extractRoot }
if (Test-NodeUsable (Join-Path $extractRoot 'node.exe')) {
  Write-Host "[SpecGate] 已准备便携 Node：$extractRoot\node.exe"
  Invoke-Installer (Join-Path $extractRoot 'node.exe')
}
Write-Host '[SpecGate] Node 自动准备失败；请手动安装 Node >= 20.19 后重试。'
exit 1
