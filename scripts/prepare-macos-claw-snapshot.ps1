$ErrorActionPreference='Stop'
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$snapshotRoot=[IO.Path]::GetFullPath((Join-Path $sourceRoot '.release-tools/macos-claw-snapshot-20261012'))
if(-not $snapshotRoot.StartsWith($sourceRoot+[IO.Path]::DirectorySeparatorChar)){throw 'Snapshot must stay in this workspace'}
if(-not(Test-Path -LiteralPath (Join-Path $snapshotRoot '.git'))){throw 'Missing isolated build checkout'}
# Replace only application source/asset directories in the isolated checkout.
foreach($directory in @('src','public','scripts','src-tauri/src','src-tauri/resources','src-tauri/migrations','src-tauri/icons','src-tauri/capabilities')){
  $target=[IO.Path]::GetFullPath((Join-Path $snapshotRoot $directory))
  if(-not $target.StartsWith($snapshotRoot+[IO.Path]::DirectorySeparatorChar)){throw 'Invalid snapshot target'}
  if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination $target -Recurse
}
$files=@('package.json','package-lock.json','tsconfig.json','tsconfig.node.json','vite.config.ts','index.html','widget.html','bubble.html','pet.html','.gitignore','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/build.rs','src-tauri/tauri.conf.json','src-tauri/tauri.macos.conf.json','src-tauri/.cargo/config.toml','design/scenes/manifest.json','.github/workflows/macos-claw-test.yml')
foreach($file in $files){
  $from=Join-Path $sourceRoot $file
  if(Test-Path -LiteralPath $from){$to=Join-Path $snapshotRoot $file;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null;Copy-Item -LiteralPath $from -Destination $to -Force}
}
$excluded=Get-ChildItem -LiteralPath (Join-Path $snapshotRoot 'public') -Recurse -File | Where-Object { $_.Length -gt 100MB -or $_.Extension -in '.db','.sqlite','.mp4','.exe' }
if($excluded){throw 'Unexpected runtime data or oversized file in application assets'}
Write-Output 'Prepared application-only macOS build snapshot.'
