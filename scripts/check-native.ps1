$ErrorActionPreference = 'Stop'
cargo test --manifest-path (Join-Path $PSScriptRoot '../src-tauri/Cargo.toml') --lib --offline
exit $LASTEXITCODE
