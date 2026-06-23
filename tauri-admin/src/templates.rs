// templates.rs — HTML generators for quiz, bank, and index files
// Ported from admin-dashboard.py: create_quiz_html, create_bank_html, create_index_html

use serde_json::Value;

/// Number of `../` repetitions needed to reach the root from `folder_rel`.
pub fn relative_prefix(folder_rel: &str) -> String {
    if folder_rel.is_empty() || folder_rel == "." {
        return String::new();
    }
    let depth = folder_rel.split('/').filter(|p| !p.is_empty()).count();
    "../".repeat(depth)
}

/// Derive a slug-safe folder/stem combination for the UID.
pub fn snakeify(text: &str, default: &str) -> String {
    let slug: String = text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .split('_')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    if slug.is_empty() { default.to_string() } else { slug }
}

pub fn slugify(text: &str, default: &str) -> String {
    let slug: String = text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() { default.to_string() } else { slug }
}

pub fn derive_uid(folder: &str, stem: &str) -> String {
    let mut parts: Vec<&str> = if folder.is_empty() || folder == "." {
        vec![]
    } else {
        folder.split('/').filter(|s| !s.is_empty()).collect()
    };
    parts.push(stem);
    snakeify(&parts.join("_"), "quiz_file")
}

pub fn title_from_segment(segment: &str) -> String {
    segment
        .replace(['.', '-', '_'], " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().to_string() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

static FOUC_SCRIPT: &str = r#"(function(){var t=localStorage.getItem('quiz-theme')||'dark';var s=document.createElement('style');
s.textContent='html,body{background:'+(t==='light'?'#f3f0eb':'#0d1117')+';color:'+(t==='light'?'#1c1917':'#e6edf3')+';margin:0;padding:0;overflow:hidden;height:100%}';
document.head.appendChild(s)})();"#;

pub fn create_quiz_html(config: &Value, questions: &Value) -> String {
    let title = config.get("title").and_then(|v| v.as_str()).unwrap_or("Quiz");
    let config_json = serde_json::to_string_pretty(config).unwrap_or_default();
    let questions_json = serde_json::to_string_pretty(questions).unwrap_or_default();
    format!(r##"<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>
{fouc}
</script>
<title>{title}</title>
</head>
<body>
<script>

/* [QUIZ_CONFIG_START] */
const QUIZ_CONFIG = {config_json};
/* [QUIZ_CONFIG_END] */

/* [QUESTIONS_START] */
const QUESTIONS = {questions_json};
/* [QUESTIONS_END] */

</script>
<script>
(function(){{
  window.__QUIZ_ENGINE_BASE='../'.repeat(Math.max(0,location.pathname.split('/').filter(Boolean).length-2));
  document.write('<scr'+'ipt src="'+window.__QUIZ_ENGINE_BASE+'engine-shared.js"><\/scr'+'ipt>');
  document.write('<scr'+'ipt src="'+window.__QUIZ_ENGINE_BASE+'quiz-engine.js"><\/scr'+'ipt>');
}})();
</script>
</body>
</html>
"##, fouc = FOUC_SCRIPT, title = title, config_json = config_json, questions_json = questions_json)
}

pub fn create_bank_html(config: &Value, questions: &Value) -> String {
    let title = config.get("title").and_then(|v| v.as_str()).unwrap_or("Bank");
    let config_json = serde_json::to_string_pretty(config).unwrap_or_default();
    let questions_json = serde_json::to_string_pretty(questions).unwrap_or_default();
    format!(r##"<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>
{fouc}
</script>
<title>{title}</title>
</head>
<body>
<script>

/* [BANK_CONFIG_START] */
const BANK_CONFIG = {config_json};
/* [BANK_CONFIG_END] */

/* [QUESTION_BANK_START] */
const QUESTION_BANK = {questions_json};
/* [QUESTION_BANK_END] */

</script>
<script>
(function(){{
  window.__QUIZ_ENGINE_BASE='../'.repeat(Math.max(0,location.pathname.split('/').filter(Boolean).length-2));
  document.write('<scr'+'ipt src="'+window.__QUIZ_ENGINE_BASE+'engine-shared.js"><\/scr'+'ipt>');
  document.write('<scr'+'ipt src="'+window.__QUIZ_ENGINE_BASE+'bank-engine.js"><\/scr'+'ipt>');
}})();
</script>
</body>
</html>
"##, fouc = FOUC_SCRIPT, title = title, config_json = config_json, questions_json = questions_json)
}

pub fn create_written_html(config: &Value, questions: &Value) -> String {
    let title = config.get("title").and_then(|v| v.as_str()).unwrap_or("Written Assessment");
    let config_json = serde_json::to_string_pretty(config).unwrap_or_default();
    let questions_json = serde_json::to_string_pretty(questions).unwrap_or_default();
    let ver = "2026-06-01-ai-fallback-ui";
    format!(r##"<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>
{fouc}
</script>
<title>{title}</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="favicon.svg">
<script>
if ('serviceWorker' in navigator) {{
  window.addEventListener('load', function () {{
    navigator.serviceWorker.register('sw.js').catch(function () {{}});
  }});
}}
</script>
</head>
<body>
<script>

/* [WRITTEN_CONFIG_START] */
const WRITTEN_CONFIG = {config_json};
/* [WRITTEN_CONFIG_END] */

/* [WRITTEN_QUESTIONS_START] */
const WRITTEN_QUESTIONS = {questions_json};
/* [WRITTEN_QUESTIONS_END] */

</script>
<script>
(function () {{
  window.__WRITTEN_ENGINE_BASE = '../'.repeat(Math.max(0, location.pathname.split('/').filter(Boolean).length - 2));
  window.__WRITTEN_ENGINE_VERSION = '{ver}';
  document.write('<scr' + 'ipt src="' + window.__WRITTEN_ENGINE_BASE + 'engine-shared.js' + '><\/scr' + 'ipt>');
  document.write('<scr' + 'ipt src="' + window.__WRITTEN_ENGINE_BASE + 'written-engine.js?v=' + window.__WRITTEN_ENGINE_VERSION + '"><\/scr' + 'ipt>');
}})();
</script>
</body>
</html>
"##, fouc = FOUC_SCRIPT, title = title, config_json = config_json, questions_json = questions_json, ver = ver)
}

pub fn create_flashcard_html(config: &Value, questions: &Value) -> String {
    let title = config.get("title").and_then(|v| v.as_str()).unwrap_or("Flashcards");
    let config_json = serde_json::to_string_pretty(config).unwrap_or_default();
    let questions_json = serde_json::to_string_pretty(questions).unwrap_or_default();
    format!(r##"<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>
{fouc}
</script>
<title>{title}</title>
</head>
<body>
<script>

/* [FLASHCARD_CONFIG_START] */
var BANK_CONFIG = {config_json};
/* [FLASHCARD_CONFIG_END] */

/* [FLASHCARD_BANK_START] */
var FLASHCARD_BANK = {questions_json};
/* [FLASHCARD_BANK_END] */

/* [CUSTOM_SCRIPT_START] */
/* [CUSTOM_SCRIPT_END] */

</script>
<script>
(function(){{
  window.__FLASHCARD_ENGINE_BASE='../'.repeat(Math.max(0,location.pathname.split('/').filter(Boolean).length-2));
  document.write('<scr'+'ipt src="'+window.__FLASHCARD_ENGINE_BASE+'engine-shared.js"><\/scr'+'ipt>');
  document.write('<scr'+'ipt src="'+window.__FLASHCARD_ENGINE_BASE+'flashcard-engine.js"><\/scr'+'ipt>');
}}}})();
</script>
</body>
</html>
"##, fouc = FOUC_SCRIPT, title = title, config_json = config_json, questions_json = questions_json)
}

struct IndexCtx {
    page_title: String,
    topbar_title: String,
    hero_title: String,
    hero_description: String,
    prefix: String,
    back_link: String,
}

fn build_index_ctx(folder_rel: &str, title: &str, description: &str) -> IndexCtx {
    let prefix = relative_prefix(folder_rel);
    let parts: Vec<&str> = if folder_rel.is_empty() || folder_rel == "." {
        vec![]
    } else {
        folder_rel.split('/').filter(|s| !s.is_empty()).collect()
    };

    if parts.is_empty() {
        IndexCtx {
            page_title: "MU61 Quiz".into(),
            topbar_title: "MU61 Quiz".into(),
            hero_title: "Select your <span>subject</span>".into(),
            hero_description: if description.is_empty() { "Choose a section to begin.".into() } else { description.into() },
            prefix,
            back_link: String::new(),
        }
    } else if parts.len() == 1 {
        let subject = if title.is_empty() { title_from_segment(parts[0]) } else { title.to_string() };
        let page_title = format!("MU61 Quiz - {}", subject);
        IndexCtx {
            topbar_title: page_title.clone(),
            page_title,
            hero_title: format!("Select your <span>{} exam</span>", subject),
            hero_description: if description.is_empty() { format!("{} quizzes and resources.", subject) } else { description.into() },
            prefix,
            back_link: r#"<a href="../index.html" class="icon-btn back-btn" title="Back">←</a>"#.into(),
        }
    } else {
        let subject = title_from_segment(parts[0]);
        let scope = if title.is_empty() {
            parts[1..].iter().map(|p| title_from_segment(p)).collect::<Vec<_>>().join(" ")
        } else { title.to_string() };
        let page_title = format!("MU61 Quiz - {} {}", subject, scope);
        IndexCtx {
            topbar_title: page_title.clone(),
            page_title,
            hero_title: format!("Select your <span>{} {}</span>", subject, scope),
            hero_description: if description.is_empty() { format!("{} quizzes and folders for {}.", scope, subject) } else { description.into() },
            prefix,
            back_link: r#"<a href="../index.html" class="icon-btn back-btn" title="Back">←</a>"#.into(),
        }
    }
}

static FOUC_SCRIPT_OPAQUE: &str = r##"(function(){var t=localStorage.getItem('quiz-theme')||'dark';var s=document.createElement('style');
s.textContent='html,body{background:'+(t==='light'?'#f3f0eb':'#0d1117')+';color:'+(t==='light'?'#1c1917':'#e6edf3')+';margin:0;padding:0;min-height:100%}';
document.head.appendChild(s)})();"##;

pub fn create_osce_html(config: &Value, cases: &Value) -> String {
    let title = config.get("title").and_then(|v| v.as_str()).unwrap_or("OSCE Virtual Patients");
    let config_json = serde_json::to_string_pretty(config).unwrap_or_default();
    // Use singular OSCE_CASE object format (matching generated project convention)
    // when there's exactly one case; fall back to plural OSCE_CASES array for 0 or 2+.
    let (cases_const, cases_body, cases_marker) = match cases.as_array() {
        Some(arr) if arr.len() == 1 => ("OSCE_CASE", serde_json::to_string_pretty(&arr[0]).unwrap_or_default(), "OSCE_CASE"),
        Some(_) => ("OSCE_CASES", serde_json::to_string_pretty(cases).unwrap_or_default(), "OSCE_CASES"),
        None => ("OSCE_CASE", "{}".to_string(), "OSCE_CASE"),
    };
    format!(r##"<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>
{fouc}
</script>
<title>{title}</title>
</head>
<body>
<script>

/* [OSCE_CONFIG_START] */
const OSCE_CONFIG = {config_json};
/* [OSCE_CONFIG_END] */

/* [{cases_marker}_START] */
const {cases_const} = {cases_body};
/* [{cases_marker}_END] */

</script>
<script>
(function(){{
  window.__OSCE_ENGINE_BASE='../'.repeat(Math.max(0,location.pathname.split('/').filter(Boolean).length-2));
  document.write('<scr'+'ipt src="'+window.__OSCE_ENGINE_BASE+'engine-shared.js"><\/scr'+'ipt>');
  document.write('<scr'+'ipt src="'+window.__OSCE_ENGINE_BASE+'osce-engine.js"><\/scr'+'ipt>');
}})();
</script>
</body>
</html>
"##, fouc = FOUC_SCRIPT, title = title, config_json = config_json,
cases_const = cases_const, cases_body = cases_body, cases_marker = cases_marker)
}

pub fn create_index_html(folder_rel: &str, title: &str, description: &str) -> String {
    let ctx = build_index_ctx(folder_rel, title, description);
    let prefix = &ctx.prefix;
    format!(r##"<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>
{fouc}
</script>
<title>{page_title}</title>
<meta name="theme-color" content="#0d1117">
<link rel="icon" type="image/svg+xml" href="{prefix}favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{prefix}index-engine.css">
<link rel="manifest" href="{prefix}manifest.webmanifest">
</head>
<body>
  <div class="topbar">
    {back_link}
    <div class="topbar-title">{topbar_title}</div>
    <button class="icon-btn btn-tracker" onclick="openTrackerDashboard()" title="Question Tracker">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/></svg>
      <span class="tracker-badge" id="tracker-badge-count"></span>
    </button>
    <button class="icon-btn" id="theme-toggle" onclick="toggleTheme()" title="Toggle theme">☀</button>
  </div>

  <div class="container">
    <header class="hero">
      <h1>{hero_title}</h1>
      <p>{hero_description}</p>
    </header>
    <div class="quiz-grid" id="quiz-grid"></div>
    <div class="footer-note">Made By: <a href="https://github.com/eyad-elghareeb/QuizTool">QuizTool</a></div>
  </div>

<script src="{prefix}index-engine.js"></script>
<script>
const QUIZZES = [];
(function(){{
  var s=localStorage.getItem('quiz-theme');
  if(s) document.documentElement.setAttribute('data-theme', s);
  if(window.__updateThemeIcon) window.__updateThemeIcon();
  if(window.renderQuizzes) window.renderQuizzes();
}})();
</script>
<script>
if ('serviceWorker' in navigator) {{
  window.addEventListener('load', function () {{
    navigator.serviceWorker.register('{prefix}sw.js').catch(function () {{}});
  }});
}}
</script>
</body>
</html>
"##,
        fouc = FOUC_SCRIPT_OPAQUE,
        page_title = ctx.page_title,
        prefix = prefix,
        back_link = ctx.back_link,
        topbar_title = ctx.topbar_title,
        hero_title = ctx.hero_title,
        hero_description = ctx.hero_description,
    )
}
