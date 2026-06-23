use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let out_dir = env::var("OUT_DIR").unwrap();
    
    let project_dir = PathBuf::from(manifest_dir);
    let quiztool_root = project_dir.parent().unwrap();
    let dest_dir = PathBuf::from(out_dir).join("engines");

    fs::create_dir_all(&dest_dir).unwrap();

    let engine_files = [
        "quiz-engine.js",
        "bank-engine.js",
        "flashcard-engine.js",
        "written-engine.js",
        "ai-assistant-engine.js",
        "osce-engine.js",
        "index-engine.js",
        "search-engine.js",
        "sync-engine.js",
        "engine-shared.js",
        "engine-shared.css",
        "engine-tracker.js",
    ];

    for file in &engine_files {
        let src = quiztool_root.join("engines").join(file);
        let dest = dest_dir.join(file);
        if src.exists() {
            fs::copy(&src, &dest).unwrap_or_else(|_| panic!("Failed to copy {}", file));
            println!("cargo:rerun-if-changed={}", src.display());
        }
    }

    let root_files = [
        "favicon.svg",
        "sw.js",
        "manifest.webmanifest",
        "index-engine.css",
        "pdf-exporter.html",
    ];

    for file in &root_files {
        let src = if *file == "pdf-exporter.html" {
            project_dir.join("frontend/pdf-exporter.html")
        } else if *file == "index-engine.css" {
            quiztool_root.join("engines").join(file)
        } else {
            quiztool_root.join(file)
        };
        let dest = dest_dir.join(file);
        if src.exists() {
            fs::copy(&src, &dest).unwrap_or_else(|_| panic!("Failed to copy {}", file));
            println!("cargo:rerun-if-changed={}", src.display());
        }
    }

    tauri_build::build()
}
