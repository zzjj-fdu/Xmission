$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture=Join-Path $project '.release-tools/claw-test/runtime'
$runtime=Join-Path $project '.release-tools/claw-runtime-retry-check'
$version='node-v24.16.0-win-x64'
$nodeDir=Join-Path $runtime $version
New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
# Simulate the observable result of cancellation halfway through extraction.
Copy-Item -LiteralPath (Join-Path $fixture "$version/node.exe") -Destination (Join-Path $nodeDir 'node.exe') -Force
$cli=Join-Path $nodeDir 'node_modules/npm/bin/npm-cli.js'
$marker=Join-Path $nodeDir '.xmission-complete'
if(Test-Path -LiteralPath $marker){Remove-Item -LiteralPath $marker}
if(Test-Path -LiteralPath $cli){Remove-Item -LiteralPath $cli}
$bootstrapDownloads=[System.Collections.Generic.List[string]]::new()
function Invoke-WebRequest {
  param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing)
  $bootstrapDownloads.Add($Uri)
  $file=if($Uri.EndsWith('SHASUMS256.txt')){'node-shasums.txt'}else{'node-v24.16.0-win-x64.zip'}
  Copy-Item -LiteralPath (Join-Path $fixture $file) -Destination $OutFile -Force
}
$node=& (Join-Path $project 'src-tauri/resources/claw-bootstrap.ps1') -Runtime $runtime
if(-not((Test-Path -LiteralPath $marker) -and (Test-Path -LiteralPath $cli))){throw 'Retry did not repair partial extraction'}
if($bootstrapDownloads.Count -ne 2){throw 'Partial runtime was incorrectly reused'}
$bootstrapDownloads.Clear()
$cached=& (Join-Path $project 'src-tauri/resources/claw-bootstrap.ps1') -Runtime $runtime
if($cached -ne $node -or $bootstrapDownloads.Count -ne 0){throw 'Complete runtime should be reused without downloading'}
Write-Output 'PASS real Node/npm extraction repairs cancelled preparation; verified cache reuses offline.'
