param([string]$Target = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if (-not $Target) {
        $hostLine = (& rustc -vV | Select-String '^host: ').ToString()
        $Target = $hostLine.Substring(6).Trim()
    }
    if ($Target -notin @('x86_64-pc-windows-gnu','x86_64-pc-windows-msvc')) {
        throw 'Choose an installed Windows x64 Rust target (GNU or MSVC).'
    }
    # Tauri must receive the Rust target explicitly. Otherwise a Windows GNU
    # host can be classified as MSVC during bundling and omit WebView2Loader.dll.
    & npm.cmd run tauri -- build --target $Target --bundles nsis --ci -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'Windows release build failed' }
    $targetBase = Join-Path $projectRoot 'src-tauri/target'
    if ($env:CARGO_TARGET_DIR) {
        $targetBase = if ([IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) {
            [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)
        } else {
            [IO.Path]::GetFullPath((Join-Path "$projectRoot/src-tauri" $env:CARGO_TARGET_DIR))
        }
    }
    & node scripts/check-windows-release.mjs (Join-Path $targetBase "$Target/release")
    if ($LASTEXITCODE -ne 0) { throw 'Installer dependency check failed; do not publish this build' }
} finally { Pop-Location }
