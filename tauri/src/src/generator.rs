// QuizTool — Project ZIP Generator (pure Rust, ported from generate_project.py)
// =============================================================================
// Builds a full quiz project ZIP with engines, hub pages, SW, workflows, etc.
// All engine files are embedded at compile time via the `engines` module.

use std::collections::HashMap;
use std::io::{Cursor, Write};
use zip::{write::FileOptions, ZipWriter};
use sha2::{Sha256, Digest};
use serde::{Deserialize, Serialize};
use crate::engines;

// ── Data structures ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizEntry {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub url: String,
    #[serde(default)]
    pub uid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderConfig {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub quizzes: Vec<QuizEntry>,
    #[serde(default)]
    pub subfolders: Vec<FolderConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub project_name: String,
    #[serde(default)]
    pub topbar_title: String,
    #[serde(default)]
    pub hero_title: String,
    #[serde(default)]
    pub hero_description: String,
    #[serde(default)]
    pub default_theme: String,
    #[serde(default)]
    pub folders: Vec<FolderConfig>,
    #[serde(default)]
    pub dropped_files: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct ProjectStats {
    pub total_folders: usize,
    pub total_quizzes: usize,
    pub estimated_files: usize,
}

// ── Manifest JSON generator ──────────────────────────────────────────────────

fn make_manifest(name: &str) -> String {
    format!(r##"{{
    "name": "{} Quiz",
    "short_name": "{} Quiz",
    "description": "{} Interactive Quiz. Test your knowledge.",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#0d1117",
    "theme_color": "#0d1117",
    "icons": [
        {{"src": "favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"}},
        {{"src": "icon-48.png", "sizes": "48x48", "type": "image/png", "purpose": "any"}},
        {{"src": "icon-72.png", "sizes": "72x72", "type": "image/png", "purpose": "any"}},
        {{"src": "icon-96.png", "sizes": "96x96", "type": "image/png", "purpose": "any"}},
        {{"src": "icon-144.png", "sizes": "144x144", "type": "image/png", "purpose": "any"}},
        {{"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"}},
        {{"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}}
    ]
}}"##, name, name, name)
}

// ── Service Worker generator ─────────────────────────────────────────────────

fn generate_sw_js(project_name: &str, all_file_paths: &[String]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_name.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let cache_hash = &hash[..10];
    let prefix = project_name.to_lowercase().replace(' ', "-");

    let paths_json = serde_json::to_string_pretty(all_file_paths).unwrap_or_default();

    format!(r#"/* {name} — generated precache manifest. */
const CACHE_VERSION = 'quiz-cache-{hash}';
const CACHE_NAME = '{prefix}-cache-' + CACHE_VERSION;

const GOOGLE_FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap';
const HTML2PDF_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

var PRECACHE_REL_PATHS = {paths};

function hrefFromScope(scope, relPath) {{
  var s = scope.endsWith('/') ? scope : scope + '/';
  return new URL(relPath, s).href;
}}
function shouldStore(res) {{
  return res && (res.ok || res.type === 'opaque');
}}

function precacheGoogleFonts(cache) {{
  return fetch(GOOGLE_FONT_CSS, {{ mode: 'cors', credentials: 'omit' }})
    .then(function (res) {{
      if (!res.ok) return;
      return cache.put(GOOGLE_FONT_CSS, res.clone()).then(function () {{ return res.text(); }});
    }})
    .then(function (txt) {{
      if (!txt) return;
      var re = /url\s*\(\s*([^)]+)\s*\)/g, m, jobs = [];
      while ((m = re.exec(txt)) !== null) {{
        var raw = m[1].replace(/["']/g, '').trim();
        if (!raw || raw.indexOf('data:') === 0) continue;
        var fontUrl = new URL(raw, GOOGLE_FONT_CSS).href;
        (function (u) {{
          jobs.push(fetch(u, {{ mode: 'cors', credentials: 'omit' }}).then(function (r) {{
            if (r.ok) return cache.put(u, r);
          }}));
        }})(fontUrl);
      }}
      return Promise.all(jobs.map(function (j) {{ return j.catch(function ({{}})); }}));
    }})
    .catch(function ({{}}));
}}

function precacheHtml2Pdf(cache) {{
  return fetch(HTML2PDF_CDN, {{ mode: 'cors', credentials: 'omit' }})
    .then(function (res) {{ if (res.ok) return cache.put(HTML2PDF_CDN, res); }})
    .catch(function ({{}}));
}}

self.addEventListener('install', function (event) {{
  event.waitUntil((async function () {{
    var scope = self.registration.scope;
    var cache = await caches.open(CACHE_NAME);
    var REQUIRED = [
      'quiz-engine.js', 'bank-engine.js', 'flashcard-engine.js', 'written-engine.js',
      'index-engine.js', 'search-engine.js', 'sync-engine.js',
      'index-engine.css', 'index.html', 'tracker-map.json', 'manifest.webmanifest', 'favicon.svg'
    ];
    await Promise.all(REQUIRED.map(function (rel) {{
      return cache.add(hrefFromScope(scope, rel));
    }}));
    var others = PRECACHE_REL_PATHS.filter(function (p) {{ return REQUIRED.indexOf(p) === -1; }});
    await Promise.all(others.map(function (rel) {{
      return cache.add(hrefFromScope(scope, rel)).catch(function ({{}}));
    }}));
    await precacheGoogleFonts(cache);
    await precacheHtml2Pdf(cache);
    await self.skipWaiting();
  }})());
}});

self.addEventListener('activate', function (event) {{
  event.waitUntil((async function () {{
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) {{
      return k !== CACHE_NAME ? caches.delete(k) : Promise.resolve();
    }}));
    await self.clients.claim();
  }})());
}});

self.addEventListener('fetch', function (event) {{
  if (event.request.method !== 'GET') return;
  var req = event.request;
  var isNav = req.mode === 'navigate';
  try {{
    var u = new URL(req.url);
    if (u.origin !== self.location.origin) isNav = false;
  }} catch (e) {{ isNav = false; }}
  event.respondWith(isNav ? handleNavigate(event, req) : handleAsset(event, req));
}});

async function handleNavigate(event, request) {{
  var cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  var netRes = null;
  try {{
    var res = await fetch(request, {{ signal: controller.signal }});
    clearTimeout(timeoutId);
    if (res && res.ok) {{
      try {{ await cache.put(request, res.clone()); }} catch (_) {{}}
      return res;
    }}
    netRes = res;
  }} catch (err) {{ clearTimeout(timeoutId); }}
  var cached = await cache.match(request);
  if (cached) return cached;
  var url = new URL(request.url);
  var cleanUrl = url.origin + url.pathname;
  cached = await cache.match(cleanUrl);
  if (cached) return cached;
  if (url.pathname.endsWith('/') || !url.pathname.split('/').pop().includes('.')) {{
    var idxUrl = cleanUrl.endsWith('/') ? cleanUrl + 'index.html' : cleanUrl + '/index.html';
    cached = await cache.match(idxUrl);
    if (cached) return cached;
  }}
  var fb = await cache.match(hrefFromScope(self.registration.scope, 'index.html'));
  if (fb) return fb;
  if (netRes) return netRes;
  throw new Error('No cache match and network failed');
}}

async function handleAsset(event, request) {{
  var cache = await caches.open(CACHE_NAME);
  var cached = await cache.match(request);
  if (!cached) {{
    var url = new URL(request.url);
    var scope = self.registration.scope;
    if (url.origin === self.location.origin && url.href.indexOf(scope) === 0) {{
      var filename = url.pathname.split('/').pop();
      var SHARED = [
        'quiz-engine.js', 'bank-engine.js', 'flashcard-engine.js', 'written-engine.js',
        'index-engine.js', 'search-engine.js', 'sync-engine.js',
        'index-engine.css', 'manifest.webmanifest', 'favicon.svg',
        'icon-48.png', 'icon-72.png', 'icon-96.png', 'icon-144.png', 'icon-192.png', 'icon-512.png',
        'tracker-map.json'
      ];
      if (SHARED.indexOf(filename) !== -1) {{
        cached = await cache.match(hrefFromScope(scope, filename));
      }}
    }}
  }}
  if (cached) return cached;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {{
    var res = await fetch(request, {{ signal: controller.signal }});
    clearTimeout(timeoutId);
    if (shouldStore(res)) {{
      try {{ await cache.put(request, res.clone()); }} catch (_) {{}}
    }}
    return res;
  }} catch (err) {{
    clearTimeout(timeoutId);
    var cleanUrl = request.url.split('?')[0].split('#')[0];
    var cachedClean = await cache.match(cleanUrl);
    if (cachedClean) return cachedClean;
    throw err;
  }}
}}
"#, name = project_name, hash = cache_hash, prefix = prefix, paths = paths_json)
}

// ── Index HTML Generator ─────────────────────────────────────────────────────

fn gen_index_html(
    topbar_title: &str,
    hero_title: &str,
    hero_desc: &str,
    quizzes: &[serde_json::Value],
    engine_prefix: &str,
    parent_path: Option<&str>,
) -> String {
    let q_json = serde_json::to_string_pretty(quizzes).unwrap_or_default();
    let sw_path = format!("{}sw.js", engine_prefix);
    let manifest_path = format!("{}manifest.webmanifest", engine_prefix);
    let favicon_path = format!("{}favicon.svg", engine_prefix);
    let engine_path = format!("{}index-engine.js", engine_prefix);
    let css_path = format!("{}index-engine.css", engine_prefix);

    let back_btn = if let Some(pp) = parent_path {
        format!(
            r#"<a href="{}/index.html" class="icon-btn back-btn" title="Back to Parent">←</a>
    "#, pp)
    } else if !engine_prefix.is_empty() {
        let parent = engine_prefix.trim_end_matches('/').trim_end_matches('\\');
        format!(
            r#"<a href="{}/index.html" class="icon-btn back-btn" title="Back to Home">←</a>
    "#, parent)
    } else {
        String::new()
    };

    format!(r##"<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{topbar_title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{css_path}">
<meta name="description" content="{topbar_title} Interactive Quiz">
<meta name="theme-color" content="#0d1117">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="{manifest_path}">
<link rel="icon" href="{favicon_path}" type="image/svg+xml">
<link rel="apple-touch-icon" href="{favicon_path}">
</head>
<body>

  <div class="topbar">
    {back_btn}<div class="topbar-title">{topbar_title}</div>
    <button class="icon-btn btn-tracker" onclick="openTrackerDashboard()" title="Question Tracker">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/></svg>
      <span class="tracker-badge" id="tracker-badge-count"></span>
    </button>
    <button class="icon-btn btn-sync" onclick="openSyncModal()" title="Sync Progress">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
    </button>
    <button class="icon-btn" id="theme-toggle" onclick="toggleTheme()" title="Toggle theme">☀</button>
  </div>

  <div class="container">
    <header class="hero">
      <h1>{hero_title}</h1>
      <p>{hero_desc}</p>
    </header>
    <div class="quiz-grid" id="quiz-grid"></div>
    <div class="footer-note">{footer}</div>
  </div>

<script>
const QUIZZES = {q_json};
</script>

<script src="{engine_path}"></script>
<script>
(function(){{var s=localStorage.getItem('quiz-theme');if(s)document.documentElement.setAttribute('data-theme',s);if(window.__updateThemeIcon)window.__updateThemeIcon();if(window.renderQuizzes)window.renderQuizzes();}})();
</script>
<script>
if('serviceWorker' in navigator){{window.addEventListener('load',function(){{navigator.serviceWorker.register('{sw_path}').catch(function(){{}});}});}}
</script>

</body>
</html>"##,
        topbar_title = topbar_title,
        hero_title = hero_title,
        hero_desc = hero_desc,
        css_path = css_path,
        manifest_path = manifest_path,
        favicon_path = favicon_path,
        back_btn = back_btn,
        footer = engines::FOOTER_NOTE,
        q_json = q_json,
        engine_path = engine_path,
        sw_path = sw_path,
    )
}

// ── Icon data (PNG bytes embedded at compile time via include_bytes!) ────────
// These reference the actual icon files in the repo root.
// They are embedded into the binary, so no runtime file reads needed.

fn icon_png_data(size: u32) -> Option<&'static [u8]> {
    match size {
        48 => Some(include_bytes!("../../icon-48.png")),
        72 => Some(include_bytes!("../../icon-72.png")),
        96 => Some(include_bytes!("../../icon-96.png")),
        144 => Some(include_bytes!("../../icon-144.png")),
        192 => Some(include_bytes!("../../icon-192.png")),
        512 => Some(include_bytes!("../../icon-512.png")),
        _ => None,
    }
}

// ── Main ZIP builder ─────────────────────────────────────────────────────────

pub fn build_project_zip(config: &ProjectConfig) -> Result<Vec<u8>, String> {
    let buf = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buf);
    let opts = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let project_name = &config.project_name;
    let mut all_file_paths: Vec<String> = vec![
        "index-engine.js".into(),
        "index-engine.css".into(),
        "quiz-engine.js".into(),
        "bank-engine.js".into(),
        "flashcard-engine.js".into(),
        "written-engine.js".into(),
        "sync-engine.js".into(),
        "tracker-map.json".into(),
        "favicon.svg".into(),
        "manifest.webmanifest".into(),
        "netlify.toml".into(),
        "vercel.json".into(),
        "icon-48.png".into(),
        "icon-72.png".into(),
        "icon-96.png".into(),
        "icon-144.png".into(),
        "icon-192.png".into(),
        "icon-512.png".into(),
    ];

    // Collect folder structure for root index
    struct FolderPathInfo {
        path: String,
        folder: FolderConfig,
    }
    let mut all_folder_paths: Vec<FolderPathInfo> = Vec::new();

    fn collect_folders(folders: &[FolderConfig], current_path: &str, out: &mut Vec<FolderPathInfo>) {
        for folder in folders {
            let folder_path = if current_path.is_empty() {
                folder.name.clone()
            } else {
                format!("{}/{}", current_path, folder.name)
            };
            out.push(FolderPathInfo {
                path: folder_path.clone(),
                folder: folder.clone(),
            });
            // Add index.html for this folder
            // (will be added to all_file_paths after processing)
            if !folders.is_empty() {
                // subfolders add their index.html entries
            }
            // Process subfolders
            if !folder.subfolders.is_empty() {
                collect_folders(&folder.subfolders, &folder_path, out);
            }
        }
    }
    collect_folders(&config.folders, "", &mut all_folder_paths);

    // Add folder index.html files
    for fpi in &all_folder_paths {
        all_file_paths.push(format!("{}/index.html", fpi.path));
        // Add quiz files
        for quiz in &fpi.folder.quizzes {
            if !quiz.url.is_empty() && !quiz.url.starts_with("http") {
                all_file_paths.push(format!("{}/{}", fpi.path, quiz.url));
            }
        }
    }

    // Add dropped files
    for filename in config.dropped_files.keys() {
        let placed = all_folder_paths.iter().any(|fpi| {
            fpi.folder.quizzes.iter().any(|q| q.url == *filename)
        });
        if placed {
            // File will be placed in its folder; ensure path is tracked
            for fpi in &all_folder_paths {
                for quiz in &fpi.folder.quizzes {
                    if quiz.url == *filename {
                        let p = format!("{}/{}", fpi.path, filename);
                        if !all_file_paths.contains(&p) {
                            all_file_paths.push(p);
                        }
                    }
                }
            }
        } else {
            if !all_file_paths.contains(filename) {
                all_file_paths.push(filename.clone());
            }
        }
    }

    // Root index.html always first
    all_file_paths.sort();
    if !all_file_paths.contains(&"index.html".to_string()) {
        all_file_paths.insert(0, "index.html".into());
    }

    // ── Write root-level files ──
    let add_str = |zip: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, content: &str| {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    };

    let add_bytes = |zip: &mut ZipWriter<Cursor<Vec<u8>>>, name: &str, data: &[u8]| {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(data).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    };

    // Engine files
    add_str(&mut zip, "index-engine.js", engines::INDEX_ENGINE_JS)?;
    add_str(&mut zip, "index-engine.css", engines::INDEX_ENGINE_CSS)?;
    add_str(&mut zip, "search-engine.js", engines::SEARCH_ENGINE_JS)?;
    add_str(&mut zip, "engine-shared.js", engines::ENGINE_SHARED_JS)?;
    add_str(&mut zip, "engine-shared.css", engines::ENGINE_SHARED_CSS)?;
    add_str(&mut zip, "engine-tracker.js", engines::ENGINE_TRACKER_JS)?;
    add_str(&mut zip, "quiz-engine.js", engines::QUIZ_ENGINE_JS)?;
    add_str(&mut zip, "bank-engine.js", engines::BANK_ENGINE_JS)?;
    add_str(&mut zip, "sync-engine.js", engines::SYNC_ENGINE_JS)?;
    add_str(&mut zip, "flashcard-engine.js", engines::FLASHCARD_ENGINE_JS)?;
    add_str(&mut zip, "written-engine.js", engines::WRITTEN_ENGINE_JS)?;
    add_str(&mut zip, "osce-engine.js", engines::OSCE_ENGINE_JS)?;
    add_str(&mut zip, "ai-assistant-engine.js", engines::AI_ASSISTANT_ENGINE_JS)?;

    // Static assets
    add_str(&mut zip, "favicon.svg", engines::FAVICON_SVG)?;
    add_str(&mut zip, "netlify.toml", engines::NETLIFY_TOML)?;
    add_str(&mut zip, "vercel.json", engines::VERCEL_JSON)?;
    add_str(&mut zip, "manifest.webmanifest", &make_manifest(project_name))?;

    // .gitignore
    add_str(&mut zip, ".gitignore", engines::GITIGNORE_CONTENT)?;

    // GitHub workflows
    let _ = zip.add_directory(".github/", opts);
    let _ = zip.add_directory(".github/workflows/", opts);
    add_str(&mut zip, ".github/workflows/sync-quiz-assets.yml", engines::SYNC_WORKFLOW_YML)?;
    add_str(&mut zip, ".github/workflows/jekyll-gh-pages.yml", engines::DEPLOY_WORKFLOW_YML)?;

    // Scripts directory
    let _ = zip.add_directory("scripts/", opts);
    add_str(&mut zip, "scripts/sync_quiz_assets.py", engines::SYNC_SCRIPT)?;
    add_str(&mut zip, "scripts/standardize_quiz_files.py", engines::STANDARDIZE_SCRIPT)?;

    // Native Admin App — bundled so users can launch tauri-admin from their project
    let admin_filename = if cfg!(target_os = "windows") {
        "QuizTool-Admin.exe"
    } else if cfg!(target_os = "macos") {
        "QuizTool-Admin.dmg"
    } else if cfg!(target_os = "linux") {
        "QuizTool-Admin.AppImage"
    } else {
        "QuizTool-Admin"
    };
    add_bytes(&mut zip, admin_filename, engines::QUIZTOOL_ADMIN_BINARY)?;

    // Service worker with all paths
    let sw_content = generate_sw_js(project_name, &all_file_paths);
    add_str(&mut zip, "sw.js", &sw_content)?;

    // Tracker map
    let mut tracker_map = serde_json::Map::new();
    for fpi in &all_folder_paths {
        for quiz in &fpi.folder.quizzes {
            if let Some(ref uid) = quiz.uid {
                let mut entry = serde_json::Map::new();
                entry.insert("path".into(), serde_json::Value::String(format!("{}/{}", fpi.path, quiz.url)));
                entry.insert("folderPath".into(), serde_json::Value::String(format!("{}/", fpi.path)));
                tracker_map.insert(uid.clone(), serde_json::Value::Object(entry));
            }
        }
    }
    let tm_json = serde_json::to_string(&tracker_map).unwrap_or_default();
    add_str(&mut zip, "tracker-map.json", &tm_json)?;

    // Icon files (PNG)
    for size in &[48u32, 72, 96, 144, 192, 512] {
        if let Some(data) = icon_png_data(*size) {
            let fname = format!("icon-{}.png", size);
            add_bytes(&mut zip, &fname, data)?;
        }
    }

    // ── Build root index page ──
    let root_quizzes: Vec<serde_json::Value> = all_folder_paths.iter()
        .filter(|fpi| !fpi.path.contains('/'))
        .map(|fpi| {
            serde_json::json!({
                "title": format!("{} {}", fpi.folder.icon, fpi.folder.name),
                "description": fpi.folder.description,
                "icon": fpi.folder.icon,
                "tags": ["Folder"],
                "url": format!("{}/index.html", fpi.path)
            })
        })
        .collect();

    let topbar_title = if config.topbar_title.is_empty() {
        project_name
    } else {
        &config.topbar_title
    };
    let hero_title = if config.hero_title.is_empty() {
        "Select Your <span>Subject</span>"
    } else {
        &config.hero_title
    };
    let hero_desc = if config.hero_description.is_empty() {
        "Test your knowledge across various subjects. Choose a subject below to begin."
    } else {
        &config.hero_description
    };

    let root_html = gen_index_html(topbar_title, hero_title, hero_desc, &root_quizzes, "", None);
    add_str(&mut zip, "index.html", &root_html)?;

    // ── Folder index pages ──
    fn create_folder_indexes(
        zip: &mut ZipWriter<Cursor<Vec<u8>>>,
        opts: &FileOptions<()>,
        folders: &[FolderConfig],
        parent_path: &str,
        topbar_title: &str,
        config: &ProjectConfig,
    ) -> Result<(), String> {
        for folder in folders {
            let folder_path = if parent_path.is_empty() {
                folder.name.clone()
            } else {
                format!("{}/{}", parent_path, folder.name)
            };

            // Collect quizzes for this folder
            let mut all_quizzes: Vec<serde_json::Value> = Vec::new();

            // Add subfolder links
            for sub in &folder.subfolders {
                all_quizzes.push(serde_json::json!({
                    "title": format!("{} {}", sub.icon, sub.name),
                    "description": sub.description,
                    "icon": sub.icon,
                    "tags": ["Folder"],
                    "url": format!("{}/index.html", sub.name)
                }));
            }

            // Add quiz entries
            for quiz in &folder.quizzes {
                all_quizzes.push(serde_json::json!({
                    "title": quiz.title,
                    "description": quiz.description,
                    "icon": quiz.icon,
                    "tags": quiz.tags,
                    "url": quiz.url
                }));
            }

            // Calculate engine prefix
            let depth = folder_path.matches('/').count() + 1;
            let engine_prefix = "../".repeat(depth);

            // Calculate parent path
            let path_parts: Vec<&str> = folder_path.split('/').collect();
            let folder_parent_path = if path_parts.len() > 1 {
                path_parts[..path_parts.len()-1].join("/")
            } else {
                String::new()
            };

            let f_hero_title = format!("Select your <span>{}</span> exam", folder.name);
            let f_hero_desc = format!("Test your knowledge across various {} topics. Choose an exam below to begin.",
                folder.name.to_lowercase());
            let f_topbar_title = format!("{} - {}", topbar_title, folder_path.replace('/', " / "));

            let folder_html = gen_index_html(
                &f_topbar_title,
                &f_hero_title,
                &f_hero_desc,
                &all_quizzes,
                &engine_prefix,
                if folder_parent_path.is_empty() { None } else { Some(&folder_parent_path) },
            );

            zip.start_file(format!("{}/index.html", folder_path), *opts).map_err(|e| e.to_string())?;
            zip.write_all(folder_html.as_bytes()).map_err(|e| e.to_string())?;

            // Recursively process subfolders
            if !folder.subfolders.is_empty() {
                create_folder_indexes(zip, opts, &folder.subfolders, &folder_path, topbar_title, config)?;
            }
        }
        Ok(())
    }

    create_folder_indexes(&mut zip, &opts, &config.folders, "", topbar_title, config)?;

    // ── Include dropped quiz/bank files ──
    let title_re = regex::Regex::new(r"<title>.*?</title>").unwrap();
    for (filename, file_content) in &config.dropped_files {
        let mut placed = false;
        // Check if this file belongs to any folder
        for fpi in &all_folder_paths {
            for quiz in &fpi.folder.quizzes {
                if quiz.url == *filename {
                    let full_path = format!("{}/{}", fpi.path, filename);
                    let modified = title_re.replace(file_content, |_: &regex::Captures| {
                        format!("<title>{} - {}</title>", topbar_title, quiz.title)
                    });
                    add_str(&mut zip, &full_path, &modified)?;
                    placed = true;
                    break;
                }
            }
            if placed { break; }
        }
        if !placed {
            add_str(&mut zip, filename, file_content)?;
        }
    }

    // Finish
    let buf = zip.finish().map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

/// Calculate project stats without building the full ZIP
#[allow(dead_code)]
pub fn preview_project(config: &ProjectConfig) -> ProjectStats {
    fn count_items(folders: &[FolderConfig]) -> (usize, usize) {
        let mut total_folders = 0;
        let mut total_quizzes = 0;
        for folder in folders {
            total_folders += 1;
            total_quizzes += folder.quizzes.len();
            if !folder.subfolders.is_empty() {
                let (sf, sq) = count_items(&folder.subfolders);
                total_folders += sf;
                total_quizzes += sq;
            }
        }
        (total_folders, total_quizzes)
    }
    let (total_folders, total_quizzes) = count_items(&config.folders);
    let estimated_files = 18 + total_folders + total_quizzes;
    ProjectStats { total_folders, total_quizzes, estimated_files }
}