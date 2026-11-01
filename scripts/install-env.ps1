# Standalone runtime launcher. --check and --plan never install or modify environment profiles.
$ErrorActionPreference = 'Stop'
$forward = @($args | Where-Object { $_ -ne '--bootstrap' })
$checkOnly = $args -contains '--check'
$planOnly = $args -contains '--plan'
$bootstrap = $args -contains '--bootstrap'
$expectedBootstrapHash=$null
foreach($argument in $args) {
  if($argument -match '^--expected-plan-hash=([a-f0-9]{64})$') { $expectedBootstrapHash=$Matches[1]; continue }
  if($argument -match '^--only=(.+)$') {
    foreach($id in ($Matches[1] -split ',')) { if($id.Trim() -cnotin @('git','node','python','go','jdk8','jdk17','jdk21','maven','gradle','pnpm','yarn','uv','poetry')) { throw 'Unsupported selected tool' } }
    continue
  }
  if($argument -match '^--(?:check|plan|json|bootstrap|no-env-write|help)$' -or $argument -eq '-h' -or $argument -match '^--method=(?:auto|portable)$' -or $argument -match '^--(?:project|toolchain-dir)=.+' -or $argument -match '^--source=(?:official|domestic)$' -or $argument -match '^--stack=(?:node|react|vue|python|go|java)$' -or $argument -match '^--(?:node-version|python-version|go-version|java-version|build-tool|frontend|package-manager|preset)=.{1,256}$') { continue }
  throw "Unsupported installer argument: $argument"
}
function Emit-Failure([string]$Code,[string]$Message,[int]$ExitCode=2) {
  @{ok=$false;environmentReady=$false;code=$Code;message=$Message;workflowVerification='not-run'} | ConvertTo-Json -Compress | Write-Output
  exit $ExitCode
}
if ($args -contains '--help' -or $args -contains '-h') {
  Write-Output 'SpecGate: --check is read-only; --plan shows a plan; --bootstrap permits an interactive exact-plan runtime confirmation. Set SPECGATE_NODE to reuse an existing Node executable. Remaining options are forwarded to install-env.mjs.'
  exit 0
}
function Absolute-Path([string]$Value) {
  if ($Value -match '[\r\n\x00-\x1f]') { throw 'Directory paths cannot contain control characters' }
  if ($Value -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') { throw 'Directories must be absolute paths' }
  return [IO.Path]::GetFullPath($Value)
}
$project = $PWD.ProviderPath
$cache = $env:SPECGATE_TOOLCHAINS
foreach ($argument in $forward) {
  if ($argument.StartsWith('--project=')) { $project = Absolute-Path $argument.Substring(10) }
  if ($argument.StartsWith('--toolchain-dir=')) { $cache = Absolute-Path $argument.Substring(16) }
}
if (-not $cache) { $cache = Join-Path $project '.specgate\toolchains' }
$cache = Absolute-Path $cache
function Test-Node([string]$Candidate) {
  if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf) -or [IO.Path]::GetExtension($Candidate) -ne '.exe') { return $false }
  if($Candidate -match '[\\/]\.?volta[\\/]bin[\\/]node\.exe$' -or ($env:VOLTA_HOME -and [IO.Path]::GetDirectoryName($Candidate) -eq (Join-Path $env:VOLTA_HOME 'bin'))) { return $false }
  $probe = New-Object Diagnostics.Process
  $probe.StartInfo.FileName = $Candidate
  $probe.StartInfo.Arguments = '-e "const v=process.versions.node.split(''.'').map(Number);process.exit(v[0]>20||(v[0]===20&&v[1]>=19)?0:1)"'
  $probe.StartInfo.UseShellExecute = $false
  $probe.StartInfo.CreateNoWindow = $true
  $probe.StartInfo.WindowStyle = 'Hidden'
  $probe.StartInfo.RedirectStandardOutput = $true
  $probe.StartInfo.RedirectStandardError = $true
  try {
    $null = $probe.Start()
    if (-not $probe.WaitForExit(5000)) { $probe.Kill(); $null=$probe.WaitForExit(1000); return $false }
    return $probe.ExitCode -eq 0
  } catch { return $false } finally { $probe.Dispose() }
}
function Run-Installer([string]$Node) {
  $privatePath = [IO.Path]::GetDirectoryName($Node)
  # Changes only this launcher and its child; no registry, profile or machine/user environment write.
  $priorPath=$env:PATH; $installerExit=1
  try { $env:PATH = $privatePath + ';' + $priorPath; & $Node (Join-Path $PSScriptRoot 'install-env.mjs') @forward; $installerExit=$LASTEXITCODE }
  finally { $env:PATH=$priorPath }
  exit $installerExit
}
$candidates = @($env:SPECGATE_NODE)
if($env:NVM_SYMLINK) { $candidates += Join-Path $env:NVM_SYMLINK 'node.exe' }
$voltaRoots=@($env:VOLTA_HOME)
if($env:LOCALAPPDATA) { $voltaRoots+=Join-Path $env:LOCALAPPDATA 'Volta' }
if($env:USERPROFILE) { $voltaRoots+=Join-Path $env:USERPROFILE '.volta' }
foreach($voltaRoot in ($voltaRoots | Where-Object { $_ } | Select-Object -Unique)) {
  $images=Join-Path $voltaRoot 'tools\image\node'
  if(Test-Path -LiteralPath $images -PathType Container) { foreach($entry in (Get-ChildItem -LiteralPath $images -Directory | Select-Object -First 16)) { $candidates+=(Join-Path $entry.FullName 'node.exe'),(Join-Path $entry.FullName 'bin\node.exe') } }
}
if($env:NVM_HOME -and (Test-Path -LiteralPath $env:NVM_HOME -PathType Container)) { foreach($entry in (Get-ChildItem -LiteralPath $env:NVM_HOME -Directory -Filter 'v*' | Select-Object -First 16)) { $candidates += Join-Path $entry.FullName 'node.exe' } }
$onPath = Get-Command node.exe -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }
$roots = @($cache)
if ($env:USERPROFILE) {
  $roots += Join-Path $env:USERPROFILE '.specgate\toolchains'
  $runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
  $candidates += (Join-Path $runtime 'node.exe'), (Join-Path $runtime 'node\bin\node.exe')
}
foreach ($base in @($env:ProgramFiles,$env:ProgramW6432)) { if ($base) { $candidates += Join-Path $base 'nodejs\node.exe' } }
foreach ($base in ($roots | Select-Object -Unique)) {
  $candidates += Join-Path $base 'node-current\node.exe'
  if (Test-Path -LiteralPath $base -PathType Container) {
    foreach ($entry in (Get-ChildItem -LiteralPath $base -Directory -Filter 'node-*' | Select-Object -First 16)) { $candidates += Join-Path $entry.FullName 'node.exe' }
  }
}
foreach ($candidate in ($candidates | Select-Object -Unique | Select-Object -First 40)) { if (Test-Node $candidate) { Run-Installer $candidate } }

# No usable runtime: construct the same data-only archive plan used by the MCP catalog.
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') { Emit-Failure 'ENV_PLATFORM_UNSUPPORTED' 'Native Node bootstrap supports Windows x64 only' }
$catalog = Join-Path $PSScriptRoot '..\src\codex\core\node-bootstrap.tsv'
if ((Get-Item -LiteralPath $catalog).Length -gt 4096) { Emit-Failure 'ENV_ARCHIVE_INVALID' 'Oversized Node catalog' }
$rows = @(Get-Content -LiteralPath $catalog | ForEach-Object { ,($_ -split '\|') } | Where-Object { $_[0] -eq 'win32' -and $_[1] -eq 'x64' })
if ($rows.Count -ne 1 -or $rows[0].Count -ne 8) { Emit-Failure 'ENV_ARCHIVE_INVALID' 'No unique supported Node archive' }
$row = $rows[0]; $version = $row[2]; $name = $row[3]; $url = $row[4]; $checksum = $row[6]
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $name -ne "node-v$version-win-x64.zip" -or $url -ne "https://nodejs.org/dist/v$version/$name" -or $row[5] -ne 'sha256' -or $checksum -notmatch '^[a-f0-9]{64}$') { Emit-Failure 'ENV_ARCHIVE_INVALID' 'Invalid Node archive identity' }
$target = Join-Path $cache "node-$version"
$material = "win32|x64|$version|$url|$checksum|$target"
$hasher = [Security.Cryptography.SHA256]::Create()
try { $planHash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($material)))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
$plan = @{ok=$false;environmentReady=$false;kind='node-runtime-bootstrap';code='NODE_RUNTIME_REQUIRED';platform='win32';arch='x64';version=$version;url=$url;algorithm='sha256';checksum=$checksum;location=$target;planHash=$planHash;workflowVerification='not-run'}
$plan | ConvertTo-Json -Depth 5 | Write-Output
if($expectedBootstrapHash -and $expectedBootstrapHash -cne $planHash) { Emit-Failure 'ENV_INSTALL_PLAN_CHANGED' 'The runtime plan differs from the reviewed hash; nothing installed' }
if ($checkOnly) { exit 2 }
if ($planOnly) { exit 0 }
if (-not $bootstrap -or [Console]::IsInputRedirected) { Emit-Failure 'ENV_INSTALL_CONSENT_REQUIRED' 'Use --bootstrap in an interactive terminal to confirm this exact plan, or reuse an existing runtime with SPECGATE_NODE' 3 }
$reply = Read-Host "Type INSTALL $planHash to approve, or press Enter to decline"
if ($reply -cne "INSTALL $planHash") { Emit-Failure 'ENV_INSTALL_CONSENT_REQUIRED' 'Installation declined; nothing installed' 3 }
$forward=@($forward | Where-Object { -not $_.StartsWith('--expected-plan-hash=') })

# All mutations are after exact-plan consent. Preserve unknown existing targets and symlink parents.
for ($ancestor=$cache; $ancestor; $ancestor=[IO.Path]::GetDirectoryName($ancestor)) {
  if (Test-Path -LiteralPath $ancestor) {
    $item=Get-Item -LiteralPath $ancestor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Emit-Failure 'ENV_TARGET_CONFLICT' 'Toolchain parent is a file or reparse point; preserved' }
  }
}
if (Test-Path -LiteralPath $target) { Emit-Failure 'ENV_TARGET_CONFLICT' 'Existing Node target was not usable; preserved' }
$null=New-Item -ItemType Directory -Path $cache -Force
$stage=Join-Path $cache ('sg-bootstrap-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $stage
try {
  Add-Type -AssemblyName System.Net.Http
  $client=New-Object Net.Http.HttpClient
  $client.Timeout=[TimeSpan]::FromSeconds(120)
  $response=$null; $inputStream=$null; $outputStream=$null
  $archive=Join-Path $stage $name
  try {
    $response=$client.GetAsync($url,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $null=$response.EnsureSuccessStatusCode()
    $inputStream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $outputStream=[IO.File]::Open($archive,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $buffer=New-Object byte[] 65536; $total=0; $watch=[Diagnostics.Stopwatch]::StartNew()
    while ($true) {
      $read=$inputStream.ReadAsync($buffer,0,$buffer.Length)
      if (-not $read.Wait(10000) -or $watch.Elapsed.TotalSeconds -gt 120) { throw 'Node download timed out' }
      $count=$read.Result
      if ($count -eq 0) { break }
      $total+=$count
      if ($total -gt 134217728) { throw 'Node archive exceeds size limit' }
      $outputStream.Write($buffer,0,$count)
    }
  } finally {
    if ($outputStream) { $outputStream.Dispose() }; if ($inputStream) { $inputStream.Dispose() }; if ($response) { $response.Dispose() }; $client.Dispose()
  }
  $actual=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -cne $checksum) { throw 'ENV_CHECKSUM_FAILED: Node archive checksum differs from approved plan' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($archive)
  $package="node-v$version-win-x64"
  try {
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName -notlike "$package/*" -or $entry.FullName -match '(^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$))' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'ENV_ARCHIVE_INVALID: Unsafe Node zip entry' }
    }
  } finally { $zip.Dispose() }
  $extract=Join-Path $stage 'extracted'
  [IO.Compression.ZipFile]::ExtractToDirectory($archive,$extract)
  $sdkHome=Join-Path $extract $package
  $node=Join-Path $sdkHome 'node.exe'
  if (-not (Test-Node $node) -or (& $node --version) -cne "v$version") { throw 'ENV_VERIFICATION_FAILED: Extracted Node version differs' }
  $promotionAttempts=0
  while($true) {
    $promotionAttempts++
    try { [IO.Directory]::Move($sdkHome,$target); break }
    catch {
      if(Test-Path -LiteralPath $target) { throw 'ENV_TARGET_CONFLICT: target appeared during promotion; preserved' }
      $cause=$_.Exception.GetBaseException()
      $nativeCode=$cause.HResult -band 65535
      if($promotionAttempts -ge 100 -or $nativeCode -notin @(5,32,33)) { throw }
      Start-Sleep -Milliseconds 100
    }
  }
  $receipt=@{id='node';version=$version;url=$url;algorithm='sha256';checksum=$actual;location=$target;planHash=$planHash;consent='interactive-confirmation-of-plan-hash';method='native-bootstrap';promotionAttempts=$promotionAttempts;output=(& (Join-Path $target 'node.exe') --version)}
  [IO.File]::WriteAllText((Join-Path $target 'bootstrap-receipt.json'),($receipt | ConvertTo-Json -Depth 5)+[Environment]::NewLine)
} catch { Emit-Failure 'ENV_BOOTSTRAP_FAILED' $_.Exception.Message 1 }
finally {
  $resolvedStage=[IO.Path]::GetFullPath($stage)
  $resolvedCache=[IO.Path]::GetFullPath($cache).TrimEnd('\')+'\'
  if ($resolvedStage.StartsWith($resolvedCache,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolvedStage) -match '^sg-bootstrap-[a-f0-9]{32}$' -and (Test-Path -LiteralPath $resolvedStage)) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
Run-Installer (Join-Path $target 'node.exe')
