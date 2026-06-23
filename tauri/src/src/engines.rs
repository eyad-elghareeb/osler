// QuizTool — Embeds core engine files as Rust constants.
// These are bundled into the binary at compile time and written into
// generated project ZIPs. No external files needed at runtime.

pub const INDEX_ENGINE_JS: &str = include_str!("../../engines/index-engine.js");
pub const INDEX_ENGINE_CSS: &str = include_str!("../../engines/index-engine.css");
pub const SEARCH_ENGINE_JS: &str = include_str!("../../engines/search-engine.js");
pub const QUIZ_ENGINE_JS: &str = include_str!("../../engines/quiz-engine.js");
pub const BANK_ENGINE_JS: &str = include_str!("../../engines/bank-engine.js");
pub const SYNC_ENGINE_JS: &str = include_str!("../../engines/sync-engine.js");
pub const FLASHCARD_ENGINE_JS: &str = include_str!("../../engines/flashcard-engine.js");
pub const WRITTEN_ENGINE_JS: &str = include_str!("../../engines/written-engine.js");
pub const OSCE_ENGINE_JS: &str = include_str!("../../engines/osce-engine.js");
pub const AI_ASSISTANT_ENGINE_JS: &str = include_str!("../../engines/ai-assistant-engine.js");
pub const ENGINE_SHARED_JS: &str = include_str!("../../engines/engine-shared.js");
pub const ENGINE_SHARED_CSS: &str = include_str!("../../engines/engine-shared.css");
pub const ENGINE_TRACKER_JS: &str = include_str!("../../engines/engine-tracker.js");

pub const FAVICON_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#0d1117"/>
  <circle cx="50" cy="50" r="28" fill="none" stroke="#f0a500" stroke-width="3.5"/>
  <rect x="44" y="32" width="12" height="36" rx="2" fill="#f0a500"/>
  <rect x="32" y="44" width="36" height="12" rx="2" fill="#f0a500"/>
</svg>"##;

pub const FOOTER_NOTE: &str = "Made By: <a href=\"https://github.com/eyad-elghareeb/QuizTool\" target=\"_blank\" rel=\"noopener noreferrer\">QuizTool</a>";

pub const GITIGNORE_CONTENT: &str = "# Compiled and build artifacts\n*.pyc\n__pycache__/\n*.o\n*.obj\n*.class\n*.exe\n*.dll\n*.so\n*.a\n*.out\n\nnode_modules/\nvenv/\n.venv/\n.env\n.env.local\n.env.*\n\n*.log\n*.tmp\n*.swp\n*.swo\n\n.vscode/\n.idea/\n\n.DS_Store\nThumbs.db\n\ncoverage/\nhtmlcov/\n.coverage\n\ndist/\nbuild/\ntarget/\n.gradle/\n\n.mypy_cache/\n.pytest_cache/\n\n*.zip\n*.gz\n*.tar\n*.tgz\n*.bz2\n*.xz\n*.7z\n*.rar\n\n.quiztool/\n.qwen/\n";

pub const NETLIFY_TOML: &str = "[build]\n  publish = \".\"\n  command = \"\"\n\n[[headers]]\n  for = \"/sw.js\"\n  [headers.values]\n    Cache-Control = \"no-cache\"\n\n[[headers]]\n  for = \"/manifest.webmanifest\"\n  [headers.values]\n    Content-Type = \"application/manifest+json\"\n";

pub const VERCEL_JSON: &str = r#"{
  "version": 2,
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache" }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        { "key": "Content-Type", "value": "application/manifest+json" }
      ]
    }
  ]
}"#;

pub const SYNC_WORKFLOW_YML: &str = r#"name: Sync Quiz Assets

on:
  push:
    branches: ["main"]
    paths:
      - "**/*.html"
      - "**/*.js"
      - "**/*.css"
      - "**/*.svg"
      - "**/*.png"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.x"
      - name: Update generated quiz assets
        run: python scripts/sync_quiz_assets.py
      - name: Commit generated changes
        run: |
          if git diff --quiet; then
            echo "No generated changes to commit."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -- ':!scripts/'
          if git diff --cached --quiet; then
            echo "No changes to commit (scripts changes excluded)."
            exit 0
          fi
          git commit -m "chore: sync quiz assets"
          git push
"#;

pub const DEPLOY_WORKFLOW_YML: &str = r#"name: Deploy to GitHub Pages

on:
  workflow_run:
    workflows: ["Sync Quiz Assets"]
    types:
      - completed
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    if: github.event_name == 'push' || github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event_name == 'workflow_run' && 'refs/heads/main' || github.ref }}
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Build with Jekyll
        uses: actions/jekyll-build-pages@v1
        with:
          source: ./
          destination: ./_site
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
  deploy:
    if: github.event_name == 'push' || github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main')
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
"#;

pub const SYNC_SCRIPT: &str = include_str!("../../scripts/sync_quiz_assets.py");
pub const STANDARDIZE_SCRIPT: &str = include_str!("../../scripts/standardize_quiz_files.py");

// Platform-specific Tauri admin binary bundled into generated project ZIPs
// so users can launch the native admin dashboard from their project folder.
#[cfg(target_os = "windows")]
pub const QUIZTOOL_ADMIN_BINARY: &[u8] = include_bytes!("../../tauri-admin/target/release/quiztool-admin.exe");

#[cfg(target_os = "macos")]
pub const QUIZTOOL_ADMIN_BINARY: &[u8] = include_bytes!("../../tauri-admin/target/release/quiztool-admin.dmg");

#[cfg(target_os = "linux")]
pub const QUIZTOOL_ADMIN_BINARY: &[u8] = include_bytes!("../../tauri-admin/target/release/quiztool-admin.AppImage");

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub const QUIZTOOL_ADMIN_BINARY: &[u8] = &[];

// Frontend HTML embedded at compile time — extracted to disk at startup
// so Tauri can find it relative to the executable.
pub const FRONTEND_HTML: &str = include_str!("../frontend/index.html");