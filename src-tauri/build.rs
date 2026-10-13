fn main() {
    // `capabilities/webdriver/` joins the capabilities only when the
    // `webdriver` feature is on: its one permission names a plugin no other
    // build contains, and Tauri refuses a capability naming an unknown plugin.
    // Tauri's default pattern, `capabilities/**/*`, would read the folder in
    // every build, so both arms name their pattern.
    println!("cargo:rerun-if-changed=capabilities");
    let pattern = if std::env::var_os("CARGO_FEATURE_WEBDRIVER").is_some() {
        "./capabilities/**/*"
    } else {
        "./capabilities/*"
    };
    tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(pattern))
        .expect("failed to run the Tauri build script");
}
