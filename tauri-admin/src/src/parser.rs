// parser.rs — File metadata extraction and validation
// Ported 1:1 from admin-dashboard.py

use regex::Regex;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum FileType { Quiz, Bank, Index, Html, Flashcard, Written, Osce }

impl FileType {
    pub fn as_str(&self) -> &'static str {
        match self {
            FileType::Quiz => "quiz",
            FileType::Bank => "bank",
            FileType::Index => "index",
            FileType::Html => "html",
            FileType::Flashcard => "flashcard",
            FileType::Written => "written",
            FileType::Osce => "osce",
        }
    }
}

pub fn extract_assigned_literal(content: &str, const_name: &str, open_char: char, close_char: char) -> Option<String> {
    let pattern = format!(r"(?:const|let|var)\s+{}\s*=\s*{}", regex::escape(const_name), regex::escape(&open_char.to_string()));
    let re = Regex::new(&pattern).ok()?;
    let m = re.find(content)?;
    let start_idx = content[m.start()..].find(open_char)? + m.start();

    let mut depth = 0i32;
    let mut end_idx = None;
    let mut in_string = false;
    let mut string_quote = ' ';
    let mut escape_next = false;
    for (idx, ch) in content[start_idx..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if in_string {
            if ch == string_quote {
                in_string = false;
            }
            continue;
        }
        // Not inside a string
        if ch == '"' || ch == '\'' {
            in_string = true;
            string_quote = ch;
        } else if ch == open_char {
            depth += 1;
        } else if ch == close_char {
            depth -= 1;
            if depth == 0 {
                end_idx = Some(start_idx + idx + ch.len_utf8());
                break;
            }
        }
    }

    end_idx.map(|end| content[start_idx..end].to_string())
}

/// Lightweight count of top-level items in a JS const array (`const NAME = [...]`).
/// Skips string values entirely (O(1) per byte of string content), making it
/// dramatically faster than `extract_assigned_literal` + `serde_json::from_str`
/// for files with embedded base64 data where string values dominate file size.
pub fn count_array_items(content: &str, const_name: &str) -> usize {
    let pattern = format!(r"(?:const|let|var)\s+{}\s*=\s*\[", regex::escape(const_name));
    let re = match Regex::new(&pattern) {
        Ok(r) => r,
        Err(_) => return 0,
    };
    let m = match re.find(content) {
        Some(m) => m,
        None => return 0,
    };
    let bytes = content[m.end() - 1..].as_bytes();
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut string_quote = 0u8;
    let mut escape = false;
    let mut count = 0usize;
    for &b in bytes {
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            if b == b'\\' {
                escape = true;
            } else if b == string_quote {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' | b'\'' => {
                in_string = true;
                string_quote = b;
            }
            b'[' | b'{' => {
                if depth == 1 && b == b'{' {
                    count += 1;
                }
                depth += 1;
            }
            b']' | b'}' => {
                depth -= 1;
                if b == b']' && depth == 0 {
                    break;
                }
            }
            _ => {}
        }
    }
    count
}

pub fn sanitize_jsonish(block: &str) -> String {
    let bytes = block.as_bytes();
    let mut out = Vec::with_capacity(block.len() + 32);
    let mut i = 0;

    // State machine for parsing JS-like content into valid JSON.
    // States:
    //   0 = outside string
    //   1 = inside "..." string
    //   2 = inside '...' string  (will be converted to "...")
    //   3 = inside /* ... */ comment
    //   4 = inside // ... comment
    let mut state = 0u8;
    let mut last_non_ws: u8 = 0; // last non-whitespace emitted char; 0 = start of input

    macro_rules! emit_byte {
        ($b:expr) => {{
            let b = $b;
            out.push(b);
            if !(b == b' ' || b == b'\t' || b == b'\n' || b == b'\r') {
                last_non_ws = b;
            }
        }};
    }

    while i < bytes.len() {
        let b = bytes[i];

        // ── Inside block comment ───────────────────────────────
        if state == 3 {
            if b == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                state = 0;
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }

        // ── Inside line comment ────────────────────────────────
        if state == 4 {
            if b == b'\n' {
                state = 0;
                emit_byte!(b'\n');
            }
            i += 1;
            continue;
        }

        // ── Inside strings ─────────────────────────────────────
        if state == 1 || state == 2 {
            // Track escape sequences
            if b == b'\\' && i + 1 < bytes.len() {
                let next = bytes[i + 1];
                // Inside single-quoted strings, \' stays as \'
                // Inside double-quoted strings, \" stays as \"
                out.push(b'\\');
                out.push(next);
                i += 2;
                continue;
            }
            if state == 1 && b == b'"' {
                state = 0;  // close double string
                emit_byte!(b'"');
                i += 1;
                continue;
            }
            if state == 2 && b == b'\'' {
                state = 0;  // close single string → converted to double
                emit_byte!(b'"');
                i += 1;
                continue;
            }
            out.push(b);
            i += 1;
            continue;
        }

        // ── Outside any string / comment ───────────────────────

        // Skip BOM
        if b == 0xEF && i + 2 < bytes.len() && bytes[i+1] == 0xBB && bytes[i+2] == 0xBF {
            i += 3;
            continue;
        }

        // Block comment start
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            state = 3;
            i += 2;
            continue;
        }

        // Line comment start — skip if preceded by : (avoids http:// etc.)
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            let is_protocol = i > 0 && bytes[i - 1] == b':';
            if !is_protocol {
                state = 4;
                i += 2;
                continue;
            }
        }

        // Double-quoted string
        if b == b'"' {
            state = 1;
            emit_byte!(b'"');
            i += 1;
            continue;
        }

        // Single-quoted string → convert to double-quoted
        if b == b'\'' {
            state = 2;
            emit_byte!(b'"');
            i += 1;
            continue;
        }

        // Unquoted key: `identifier:` → `"identifier":`
        // Must be preceded by `{` `,` or start of input
        if b.is_ascii_alphabetic() || b == b'_' {
            // Check if preceded by { , or start (after skipping whitespace)
            let is_key_start = last_non_ws == 0
                || last_non_ws == b'{'
                || last_non_ws == b',';
            if is_key_start {
                // Collect identifier and peek for `:`
                let mut j = i;
                while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                    j += 1;
                }
                // Skip whitespace before `:`
                let mut k = j;
                while k < bytes.len() && bytes[k] == b' ' {
                    k += 1;
                }
                if k < bytes.len() && bytes[k] == b':' {
                    // Emit quoted key
                    out.push(b'"');
                    out.extend_from_slice(&bytes[i..j]);
                    out.push(b'"');
                    out.push(b':');
                    last_non_ws = b':';
                    i = k + 1;
                    continue;
                }
            }
            // Not a key — emit as-is
            emit_byte!(b);
            i += 1;
            continue;
        }

        // Trailing comma before `]` or `}` → remove
        if b == b',' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b']' || bytes[j] == b'}') {
                // skip the comma
                i += 1;
                continue;
            }
            emit_byte!(b',');
            i += 1;
            continue;
        }

        emit_byte!(b);
        i += 1;
    }

    String::from_utf8(out).unwrap_or_else(|_| block.to_string())
}

pub fn parse_literal(content: &str, const_name: &str, open_char: char, close_char: char) -> Option<Value> {
    let block = extract_assigned_literal(content, const_name, open_char, close_char)?;
    serde_json::from_str::<Value>(&block).ok()
        .or_else(|| serde_json::from_str::<Value>(&sanitize_jsonish(&block)).ok())
}

#[derive(Debug, Clone)]
pub struct FileMeta {
    pub file_type: FileType,
    pub uid: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub hero_title: Option<String>,
    pub question_count: usize,
    pub config: Option<Value>,
    pub questions: Option<Value>,
    pub quizzes: Option<Value>,
}

impl FileMeta {
    pub fn to_json(&self) -> Value {
        let mut map = serde_json::Map::new();
        map.insert("type".into(), Value::String(self.file_type.as_str().to_string()));
        map.insert("uid".into(), self.uid.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::Null));
        map.insert("title".into(), self.title.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::Null));
        map.insert("description".into(), self.description.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::String(String::new())));
        map.insert("icon".into(), self.icon.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::Null));
        map.insert("hero_title".into(), self.hero_title.as_ref().map(|s| Value::String(s.clone())).unwrap_or(Value::String(String::new())));
        map.insert("question_count".into(), Value::Number(self.question_count.into()));
        if let Some(ref c) = self.config { map.insert("config".into(), c.clone()); }
        if let Some(ref q) = self.questions { map.insert("questions".into(), q.clone()); }
        if let Some(ref qz) = self.quizzes { map.insert("quizzes".into(), qz.clone()); }
        Value::Object(map)
    }
}

pub fn parse_file_metadata(content: &str) -> FileMeta {
    if let Some(cfg) = parse_literal(content, "QUIZ_CONFIG", '{', '}') {
        if cfg.is_object() {
            let questions = parse_literal(content, "QUESTIONS", '[', ']');
            let qc = questions.as_ref().and_then(|v| v.as_array()).map(|a| a.len())
                .unwrap_or_else(|| count_array_items(content, "QUESTIONS"));
            return FileMeta {
                file_type: FileType::Quiz,
                uid: cfg.get("uid").and_then(|v| v.as_str()).map(String::from),
                title: cfg.get("title").and_then(|v| v.as_str()).map(String::from),
                description: cfg.get("description").and_then(|v| v.as_str()).map(String::from),
                icon: None, hero_title: None, question_count: qc,
                config: Some(cfg), questions, quizzes: None,
            };
        }
    }
    if let Some(cfg) = parse_literal(content, "OSCE_CONFIG", '{', '}') {
        if cfg.is_object() {
            // Multi-case array: const OSCE_CASES = [ ... ]
            if let Some(cases) = parse_literal(content, "OSCE_CASES", '[', ']') {
                let qc = cases.as_array().map(|a| a.len()).unwrap_or(0);
                return FileMeta {
                    file_type: FileType::Osce,
                    uid: cfg.get("uid").and_then(|v| v.as_str()).map(String::from),
                    title: cfg.get("title").and_then(|v| v.as_str()).map(String::from),
                    description: cfg.get("description").and_then(|v| v.as_str()).map(String::from),
                    icon: cfg.get("icon").and_then(|v| v.as_str()).map(String::from),
                    hero_title: None, question_count: qc,
                    config: Some(cfg), questions: Some(cases), quizzes: None,
                };
            }
            // Single-case object: const OSCE_CASE = { ... }
            if let Some(block) = extract_assigned_literal(content, "OSCE_CASE", '{', '}') {
                if let Ok(case_val) = serde_json::from_str::<Value>(&block)
                    .or_else(|_| serde_json::from_str(&sanitize_jsonish(&block)))
                {
                    if case_val.is_object() {
                        return FileMeta {
                            file_type: FileType::Osce,
                            uid: cfg.get("uid").and_then(|v| v.as_str()).map(String::from),
                            title: cfg.get("title").and_then(|v| v.as_str()).map(String::from),
                            description: cfg.get("description").and_then(|v| v.as_str()).map(String::from),
                            icon: cfg.get("icon").and_then(|v| v.as_str()).map(String::from),
                            hero_title: None, question_count: 1,
                            config: Some(cfg), questions: Some(Value::Array(vec![case_val])), quizzes: None,
                        };
                    }
                }
            }
            // Fallback — config found but cases unparseable (e.g. truncated content).
            // Lightweight count for OSCE_CASES array.
            let qc = count_array_items(content, "OSCE_CASES");
            return FileMeta {
                file_type: FileType::Osce,
                uid: cfg.get("uid").and_then(|v| v.as_str()).map(String::from),
                title: cfg.get("title").and_then(|v| v.as_str()).map(String::from),
                description: cfg.get("description").and_then(|v| v.as_str()).map(String::from),
                icon: cfg.get("icon").and_then(|v| v.as_str()).map(String::from),
                hero_title: None, question_count: qc,
                config: Some(cfg), questions: None, quizzes: None,
            };
        }
    }
    if let Some(cfg) = parse_literal(content, "WRITTEN_CONFIG", '{', '}') {
        if cfg.is_object() {
            let questions = parse_literal(content, "WRITTEN_QUESTIONS", '[', ']');
            let qc = questions.as_ref().and_then(|v| v.as_array()).map(|a| a.len())
                .unwrap_or_else(|| count_array_items(content, "WRITTEN_QUESTIONS"));
            return FileMeta {
                file_type: FileType::Written,
                uid: cfg.get("uid").and_then(|v| v.as_str()).map(String::from),
                title: cfg.get("title").and_then(|v| v.as_str()).map(String::from),
                description: cfg.get("description").and_then(|v| v.as_str()).map(String::from),
                icon: cfg.get("icon").and_then(|v| v.as_str()).map(String::from),
                hero_title: None, question_count: qc,
                config: Some(cfg), questions, quizzes: None,
            };
        }
    }
    if (content.contains("/* [FLASHCARD_BANK_START] */") || content.contains("FLASHCARD_BANK"))
        && content.contains("BANK_CONFIG")
    {
        if let Some(cfg) = parse_literal(content, "BANK_CONFIG", '{', '}') {
            if cfg.is_object() {
                let questions = parse_literal(content, "FLASHCARD_BANK", '[', ']');
                let qc = questions.as_ref().and_then(|v| v.as_array()).map(|a| a.len())
                    .unwrap_or_else(|| count_array_items(content, "FLASHCARD_BANK"));
                return FileMeta {
                    file_type: FileType::Flashcard,
                    uid: cfg.get("uid").and_then(|v| v.as_str()).map(String::from),
                    title: cfg.get("title").and_then(|v| v.as_str()).map(String::from),
                    description: cfg.get("description").and_then(|v| v.as_str()).map(String::from),
                    icon: cfg.get("icon").and_then(|v| v.as_str()).map(String::from),
                    hero_title: None, question_count: qc,
                    config: Some(cfg), questions, quizzes: None,
                };
            }
        }
    }
    if let Some(cfg) = parse_literal(content, "BANK_CONFIG", '{', '}') {
        if cfg.is_object() {
            let questions = parse_literal(content, "QUESTION_BANK", '[', ']');
            let qc = questions.as_ref().and_then(|v| v.as_array()).map(|a| a.len())
                .unwrap_or_else(|| count_array_items(content, "QUESTION_BANK"));
            return FileMeta {
                file_type: FileType::Bank,
                uid: cfg.get("uid").and_then(|v| v.as_str()).map(String::from),
                title: cfg.get("title").and_then(|v| v.as_str()).map(String::from),
                description: cfg.get("description").and_then(|v| v.as_str()).map(String::from),
                icon: cfg.get("icon").and_then(|v| v.as_str()).map(String::from),
                hero_title: None, question_count: qc,
                config: Some(cfg), questions, quizzes: None,
            };
        }
    }
    if let Some(quizzes) = parse_literal(content, "QUIZZES", '[', ']') {
        if quizzes.is_array() {
            let title = Regex::new(r"(?i)<title>(.*?)</title>").ok()
                .and_then(|re| re.captures(content))
                .and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string());
            let (hero_title, description) = Regex::new(r#"(?is)<header class="hero">\s*<h1>(.*?)</h1>\s*<p>(.*?)</p>"#).ok()
                .and_then(|re| re.captures(content))
                .map(|c| (
                    c.get(1).map(|m| m.as_str().trim().to_string()),
                    c.get(2).map(|m| m.as_str().trim().to_string()),
                ))
                .unwrap_or((None, None));
            let qc = quizzes.as_array().map(|a| a.len()).unwrap_or(0);
            return FileMeta {
                file_type: FileType::Index,
                uid: None, title, description, icon: None, hero_title,
                question_count: qc, config: None, questions: None, quizzes: Some(quizzes),
            };
        }
    }
    FileMeta {
        file_type: FileType::Html, uid: None, title: None, description: None,
        icon: None, hero_title: None, question_count: 0, config: None, questions: None, quizzes: None,
    }
}

pub fn infer_icon(ft: &FileType, filename: &str) -> &'static str {
    match ft {
        FileType::Index => "🏠",
        FileType::Quiz => "📝",
        FileType::Bank => "🗃️",
        FileType::Flashcard => "🃏",
        FileType::Written => "✍️",
        FileType::Osce => "🩺",
        FileType::Html => if filename == "index.html" { "🏠" } else { "📄" },
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ValidationIssue {
    pub level: String,
    pub message: String,
    pub field: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ValidationResult {
    pub meta: Value,
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

fn mk_err(msg: &str, field: &str, code: &str, idx: Option<usize>) -> ValidationIssue {
    ValidationIssue { level: "error".into(), message: msg.to_string(), field: field.to_string(), code: Some(code.to_string()), index: idx }
}
fn mk_warn(msg: &str, field: &str, code: &str, idx: Option<usize>) -> ValidationIssue {
    ValidationIssue { level: "warning".into(), message: msg.to_string(), field: field.to_string(), code: Some(code.to_string()), index: idx }
}

fn validate_question_list(questions: &Value, prefix: &str, is_flashcard: bool) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let arr = match questions.as_array() {
        Some(a) => a,
        None => { issues.push(mk_err("Question list could not be parsed.", prefix, "questions_invalid", None)); return issues; }
    };
    if arr.is_empty() {
        issues.push(mk_warn("This file has no questions yet.", prefix, "questions_empty", None));
        return issues;
    }
    if is_flashcard {
        for (i, q) in arr.iter().enumerate() {
            let front = q.get("front").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if front.is_empty() { issues.push(mk_err(&format!("Card {} is missing front text.", i+1), &format!("{}.{}.front", prefix, i), "card_missing_front", Some(i))); }
        }
    } else {
        for (i, q) in arr.iter().enumerate() {
            let text = q.get("question").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let opts: Vec<String> = q.get("options").and_then(|v| v.as_array())
                .map(|a| a.iter().map(|o| o.as_str().unwrap_or("").trim().to_string()).collect())
                .unwrap_or_default();
            let correct = q.get("correct").and_then(|v| v.as_i64()).unwrap_or(0) as usize;
            if text.is_empty() { issues.push(mk_err(&format!("Question {} is missing its prompt.", i+1), &format!("{}.{}.question", prefix, i), "question_missing_text", Some(i))); }
            if opts.len() < 2 { issues.push(mk_err(&format!("Question {} needs at least 2 options.", i+1), &format!("{}.{}.options", prefix, i), "question_too_few_options", Some(i))); }
            else if opts.iter().any(|o| o.is_empty()) { issues.push(mk_warn(&format!("Question {} has blank option text.", i+1), &format!("{}.{}.options", prefix, i), "question_blank_option", Some(i))); }
            if correct >= opts.len().max(1) { issues.push(mk_err(&format!("Question {} has an invalid correct answer.", i+1), &format!("{}.{}.correct", prefix, i), "question_invalid_correct", Some(i))); }
        }
    }
    issues
}

pub fn validate_dashboard_content(_rel_path: &str, content: &str, original_uid: &str) -> ValidationResult {
    let meta = parse_file_metadata(content);
    let meta_json = meta.to_json();
    let mut issues: Vec<ValidationIssue> = Vec::new();
    match meta.file_type {
        FileType::Quiz => {
            if !content.contains("/* [QUIZ_CONFIG_START] */") { issues.push(mk_err("Quiz config markers are missing.", "config", "quiz_config_markers", None)); }
            if !content.contains("/* [QUESTIONS_START] */") { issues.push(mk_err("Question markers are missing.", "questions", "quiz_question_markers", None)); }
            let uid = meta.uid.as_deref().unwrap_or("").trim().to_string();
            if uid.is_empty() { issues.push(mk_err("Quiz UID is required.", "uid", "uid_missing", None)); }
            else if !original_uid.is_empty() && original_uid != uid { issues.push(mk_warn("UID changed from the saved file. This can orphan learner progress.", "uid", "uid_changed", None)); }
            if let Some(ref q) = meta.questions { issues.extend(validate_question_list(q, "questions", false)); }
        }
        FileType::Bank => {
            if !content.contains("/* [BANK_CONFIG_START] */") { issues.push(mk_err("Bank config markers are missing.", "config", "bank_config_markers", None)); }
            if !content.contains("/* [QUESTION_BANK_START] */") { issues.push(mk_err("Question bank markers are missing.", "questions", "bank_question_markers", None)); }
            let uid = meta.uid.as_deref().unwrap_or("").trim().to_string();
            if uid.is_empty() { issues.push(mk_err("Bank UID is required.", "uid", "uid_missing", None)); }
            else if !original_uid.is_empty() && original_uid != uid { issues.push(mk_warn("UID changed from the saved file. This can orphan learner progress.", "uid", "uid_changed", None)); }
            if let Some(ref q) = meta.questions { issues.extend(validate_question_list(q, "questions", false)); }
        }
        FileType::Flashcard => {
            if !content.contains("/* [FLASHCARD_CONFIG_START] */") { issues.push(mk_err("Flashcard config markers are missing.", "config", "flashcard_config_markers", None)); }
            if !content.contains("/* [FLASHCARD_BANK_START] */") { issues.push(mk_err("Flashcard bank markers are missing.", "questions", "flashcard_bank_markers", None)); }
            let uid = meta.uid.as_deref().unwrap_or("").trim().to_string();
            if uid.is_empty() { issues.push(mk_err("Flashcard UID is required.", "uid", "uid_missing", None)); }
            else if !original_uid.is_empty() && original_uid != uid { issues.push(mk_warn("UID changed from the saved file. This can orphan learner progress.", "uid", "uid_changed", None)); }
            if let Some(ref q) = meta.questions { issues.extend(validate_question_list(q, "questions", true)); }
        }
        FileType::Osce => {
            if !content.contains("/* [OSCE_CONFIG_START] */") { issues.push(mk_err("OSCE config markers are missing.", "config", "osce_config_markers", None)); }
            if !content.contains("/* [OSCE_CASES_START] */") && !content.contains("/* [OSCE_CASE_START] */") {
                issues.push(mk_err("OSCE cases markers are missing.", "cases", "osce_cases_markers", None));
            }
            let uid = meta.uid.as_deref().unwrap_or("").trim().to_string();
            if uid.is_empty() { issues.push(mk_err("OSCE UID is required.", "uid", "uid_missing", None)); }
            else if !original_uid.is_empty() && original_uid != uid { issues.push(mk_warn("UID changed from the saved file. This can orphan learner progress.", "uid", "uid_changed", None)); }
            if let Some(ref q) = meta.questions {
                let arr = q.as_array();
                if arr.is_none() {
                    issues.push(mk_err("OSCE cases could not be parsed.", "cases", "osce_cases_invalid", None));
                } else if arr.unwrap().is_empty() {
                    issues.push(mk_warn("This file has no OSCE cases yet.", "cases", "osce_cases_empty", None));
                } else {
                    for (i, item) in arr.unwrap().iter().enumerate() {
                        let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                        if title.is_empty() {
                            issues.push(mk_err(&format!("OSCE case {} is missing its title.", i+1), &format!("cases.{}.title", i), "osce_case_missing_title", Some(i)));
                        }
                        if item.get("patient").and_then(|v| v.as_object()).is_none() {
                            issues.push(mk_err(&format!("OSCE case {} is missing patient info.", i+1), &format!("cases.{}.patient", i), "osce_case_missing_patient", Some(i)));
                        }
                    }
                }
            }
        }
        FileType::Written => {
            if !content.contains("/* [WRITTEN_CONFIG_START] */") { issues.push(mk_err("Written config markers are missing.", "config", "written_config_markers", None)); }
            if !content.contains("/* [WRITTEN_QUESTIONS_START] */") { issues.push(mk_err("Written questions markers are missing.", "questions", "written_question_markers", None)); }
            let uid = meta.uid.as_deref().unwrap_or("").trim().to_string();
            if uid.is_empty() { issues.push(mk_err("Written assessment UID is required.", "uid", "uid_missing", None)); }
            else if !original_uid.is_empty() && original_uid != uid { issues.push(mk_warn("UID changed from the saved file. This can orphan learner progress.", "uid", "uid_changed", None)); }
            if let Some(ref q) = meta.questions {
                let arr = q.as_array();
                if arr.is_none() {
                    issues.push(mk_err("Written questions could not be parsed.", "questions", "written_questions_invalid", None));
                } else if arr.unwrap().is_empty() {
                    issues.push(mk_warn("This file has no written questions yet.", "questions", "written_questions_empty", None));
                } else {
                    for (i, item) in arr.unwrap().iter().enumerate() {
                        let text = item.get("question").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                        if text.is_empty() {
                            issues.push(mk_err(&format!("Written question {} is missing its prompt.", i+1), &format!("questions.{}.question", i), "written_question_missing_text", Some(i)));
                        }
                    }
                }
            }
        }
        FileType::Index => {
            if meta.quizzes.as_ref().and_then(|v| v.as_array()).is_none() {
                issues.push(mk_err("QUIZZES could not be parsed.", "quizzes", "index_cards_invalid", None));
            } else if let Some(arr) = meta.quizzes.as_ref().and_then(|v| v.as_array()) {
                for (i, quiz) in arr.iter().enumerate() {
                    if !quiz.is_object() { issues.push(mk_err(&format!("Card {} is invalid.", i+1), &format!("quizzes.{}", i), "index_card_invalid", Some(i))); continue; }
                    let url = quiz.get("url").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                    if url.is_empty() { issues.push(mk_warn(&format!("Card {} is missing a URL.", i+1), &format!("quizzes.{}.url", i), "index_url_missing", Some(i))); }
                }
            }
        }
        FileType::Html => {}
    }
    let errors: Vec<_> = issues.iter().filter(|i| i.level == "error").cloned().collect();
    let warnings: Vec<_> = issues.iter().filter(|i| i.level == "warning").cloned().collect();
    ValidationResult { meta: meta_json, errors, warnings }
}
