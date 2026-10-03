fn main() {
    tauri_build::build();
    // Tauri normally links its Windows manifest only into application binaries.
    // The GNU lib test harness also imports TaskDialogIndirect and needs Common Controls v6.
    // Also link the resource for ordinary `cargo test --lib`, without an opt-in flag.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu") {
        let resource = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("libresource.a");
        println!("cargo:rustc-link-arg={}", resource.display());
    }
}
