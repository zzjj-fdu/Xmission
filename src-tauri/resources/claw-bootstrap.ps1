param([Parameter(Mandatory=$true)][string]$Runtime)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$runtimePath=[IO.Path]::GetFullPath($Runtime)
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$architecture=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}
$version='v24.16.0'
$archiveName="node-$version-win-$architecture.zip"
$nodeDirectory=Join-Path $runtimePath "node-$version-win-$architecture"
$nodeExe=Join-Path $nodeDirectory 'node.exe'
$npmCli=Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js'
$complete=Join-Path $nodeDirectory '.xmission-complete'
if(-not((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $npmCli) -and (Test-Path -LiteralPath $complete))){
  $archivePath=Join-Path $runtimePath $archiveName
  $sumsPath=Join-Path $runtimePath 'node-shasums.txt'
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt" -OutFile $sumsPath -UseBasicParsing
  $line=Get-Content -LiteralPath $sumsPath | Where-Object { $_.EndsWith("  $archiveName") } | Select-Object -First 1
  if(-not $line){throw 'Missing official Node checksum'}
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/$archiveName" -OutFile $archivePath -UseBasicParsing
  $actual=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -ne $line.Split(' ')[0]){throw 'Node checksum mismatch'}
  $stagingPath=[IO.Path]::GetFullPath((Join-Path $runtimePath "unpack-$version-$architecture"))
  $stagedNode=[IO.Path]::GetFullPath((Join-Path $stagingPath "node-$version-win-$architecture"))
  foreach($target in @($stagingPath,$stagedNode,$nodeDirectory)){
    if(-not([IO.Path]::GetFullPath($target).StartsWith($runtimePath+[IO.Path]::DirectorySeparatorChar))){throw 'Invalid runtime target'}
  }
  if(Test-Path -LiteralPath $stagingPath){Remove-Item -LiteralPath $stagingPath -Recurse -Force}
  Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingPath -Force
  $stagedExe=Join-Path $stagedNode 'node.exe'
  $stagedNpm=Join-Path $stagedNode 'node_modules/npm/bin/npm-cli.js'
  if(-not(Test-Path -LiteralPath $stagedNpm)){throw 'Incomplete npm runtime'}
  $actualVersion=& $stagedExe --version
  if($LASTEXITCODE -ne 0 -or $actualVersion -ne $version){throw 'Incomplete Node runtime'}
  & $stagedExe $stagedNpm --version | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Incomplete npm runtime'}
  Set-Content -LiteralPath (Join-Path $stagedNode '.xmission-complete') -Value $version
  if(Test-Path -LiteralPath $nodeDirectory){Remove-Item -LiteralPath $nodeDirectory -Recurse -Force}
  Move-Item -LiteralPath $stagedNode -Destination $nodeDirectory
}
Write-Output $nodeExe
