fn main() {
    // Re-run this build script whenever .env changes so the injected
    // credentials are picked up without a manual `cargo clean`.
    println!("cargo:rerun-if-changed=.env");

    // Load a project-local .env file (if present) so the GitHub OAuth
    // credentials can be supplied at build time without hardcoding them in
    // source. The client_id is PUBLIC and safe to ship; the client_secret is
    // only needed when the OAuth App is registered as *confidential* and should
    // come from a gitignored .env (never committed). Tauri apps run on the
    // user's own machine, so baking in the builder's own app credentials for a
    // privately-distributed build is acceptable. For public releases, register
    // the app as a public client so no secret is required.
    if let Ok(contents) = std::fs::read_to_string(".env") {
        let mut id_done = false;
        let mut secret_done = false;
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                let val = v.trim().trim_matches('"');
                if key == "GH_OAUTH_CLIENT_ID" && !id_done {
                    let trimmed = val.trim();
                    if !trimmed.is_empty() {
                        println!("cargo:rustc-env=OSLER_GH_CLIENT_ID={}", trimmed);
                    }
                    id_done = true;
                } else if key == "GH_OAUTH_CLIENT_SECRET" && !secret_done {
                    let trimmed = val.trim();
                    if !trimmed.is_empty() {
                        println!("cargo:rustc-env=OSLER_GH_CLIENT_SECRET={}", trimmed);
                    }
                    secret_done = true;
                }
            }
            if id_done && secret_done {
                break;
            }
        }
    }
    // `option_env!` in github.rs handles the missing-var case gracefully, so no
    // fallback env injection is required here.

    tauri_build::build()
}
