// ═══════════════════════════════════════════════════════════════════════════════
//  pdf.rs  — PDF generation via ReportLab Python sidecar
//  Python scripts are embedded in the binary via include_str!().
// ═══════════════════════════════════════════════════════════════════════════════

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ── Embedded Python scripts ───────────────────────────────────────────────
// These are compiled into the binary so the EXE is fully self-contained.
const EMBED_PDF_GENERATOR: &str = include_str!("../../scripts/pdf_generator.py");
const EMBED_ENSURE_DEPS: &str    = include_str!("../../scripts/ensure_pdf_deps.py");

fn scripts_dir() -> PathBuf {
    std::env::temp_dir().join("quiztool-pdf-scripts")
}

fn extract_script(name: &str, content: &str) -> Result<PathBuf, String> {
    let dir = scripts_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create scripts temp dir: {e}"))?;
    let path = dir.join(name);
    // Only write if the content differs (avoids unnecessary disk I/O)
    let should_write = if path.exists() {
        std::fs::read_to_string(&path).unwrap_or_default() != content
    } else {
        true
    };
    if should_write {
        std::fs::write(&path, content)
            .map_err(|e| format!("Failed to extract script {name}: {e}"))?;
    }
    Ok(path)
}

fn find_python() -> Option<String> {
    for name in &["python3", "python"] {
        let mut cmd = Command::new(name);
        cmd.arg("--version");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                return Some(name.to_string());
            }
        }
    }
    None
}

// ── Dependency check ──────────────────────────────────────────────────────

static DEPS_CHECKED: OnceLock<std::sync::Mutex<bool>> = OnceLock::new();

fn deps_checked() -> &'static std::sync::Mutex<bool> {
    DEPS_CHECKED.get_or_init(|| std::sync::Mutex::new(false))
}

pub fn ensure_deps() -> Result<bool, String> {
    {
        let checked = deps_checked().lock().map_err(|e| e.to_string())?;
        if *checked {
            return Ok(true);
        }
    }

    let python = find_python().ok_or_else(|| {
        "Python 3 not found. Install Python 3.8+ from https://python.org".to_string()
    })?;

    let script_path = extract_script("ensure_pdf_deps.py", EMBED_ENSURE_DEPS)?;

    let mut cmd = Command::new(&python);
    cmd.arg(&script_path)
        .env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output()
        .map_err(|e| format!("Failed to run dependency check: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let detail = if !stdout.trim().is_empty() { stdout } else { stderr };
        return Err(format!("Dependency check failed: {detail}"));
    }

    let result: Value = serde_json::from_str(&stdout)
        .map_err(|_| format!("Invalid JSON from dep check: {stdout}"))?;

    let status = result["status"].as_str().unwrap_or("error");
    match status {
        "ok" | "installed" => {
            let mut checked = deps_checked().lock().map_err(|e| e.to_string())?;
            *checked = true;
            Ok(true)
        }
        _ => {
            let detail = result["detail"].as_str().unwrap_or("Unknown error");
            Err(format!("Dependency setup failed: {detail}"))
        }
    }
}

// ── Data structures ───────────────────────────────────────────────────────

#[derive(Clone)]
pub struct QuestionData {
    pub number:       usize,
    pub text:         String,
    pub options:      Vec<String>,
    pub correct:      usize,
    pub explanation:  String,
    pub model_answer: String,
    pub rubric:       String,
    pub children:     Vec<ChildQuestionData>,
}

#[derive(Clone)]
pub struct ChildQuestionData {
    pub label:        String,
    pub text:         String,
    pub model_answer: String,
    pub rubric:       String,
    pub explanation:  String,
}

#[derive(Clone)]
pub struct QuizData {
    pub title:       String,
    pub description: String,
    pub icon:        String,
    pub r#type:      String,
    pub questions:   Vec<QuestionData>,
}

pub struct ExportConfig {
    pub quizzes:           Vec<QuizData>,
    pub title:             String,
    pub subtitle:          String,
    pub author:            String,
    pub date:              String,
    pub description:       String,
    pub icon:              String,
    pub include_cover:     bool,
    pub include_toc:       bool,
    pub style_mode:        String,
    pub layout_mode:       String,
    pub page_size:         String,
    pub orientation:       String,
    pub numbering:         String,
    pub answers:           String,
    pub show_explanations: bool,
}

impl ExportConfig {
    pub fn from_json(v: &Value) -> Result<Self, String> {
        let quizzes = v["quizzes"].as_array()
            .map(|arr| arr.iter().map(|q| {
                let questions = q["questions"].as_array()
                    .map(|qa| qa.iter().enumerate().map(|(i, qd)| QuestionData {
                        number:      i + 1,
                        text:        qd["question"].as_str().unwrap_or("").to_string(),
                        options:     qd["options"].as_array()
                            .map(|o| o.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                            .unwrap_or_default(),
                        correct:     qd["correct"].as_u64().unwrap_or(0) as usize,
                        explanation: qd["explanation"].as_str().unwrap_or("").to_string(),
                        model_answer: qd["modelAnswer"].as_str().unwrap_or("").to_string(),
                        rubric:       qd["rubric"].as_str().unwrap_or("").to_string(),
                        children:     qd["children"].as_array()
                            .map(|ca| ca.iter().map(|c| ChildQuestionData {
                                label:        c["label"].as_str().unwrap_or("").to_string(),
                                text:         c["question"].as_str().unwrap_or("").to_string(),
                                model_answer: c["modelAnswer"].as_str().unwrap_or("").to_string(),
                                rubric:       c["rubric"].as_str().unwrap_or("").to_string(),
                                explanation:  c["explanation"].as_str().unwrap_or("").to_string(),
                            }).collect())
                            .unwrap_or_default(),
                    }).collect())
                    .unwrap_or_default();
                QuizData {
                    title:       q["title"].as_str().unwrap_or("Untitled").to_string(),
                    description: q["description"].as_str().unwrap_or("").to_string(),
                    icon:        q["icon"].as_str().unwrap_or("").to_string(),
                    r#type:      q["type"].as_str().unwrap_or("").to_string(),
                    questions,
                }
            }).collect())
            .unwrap_or_default();

        let style = &v["style"];
        let cover = &v["cover"];
        Ok(ExportConfig {
            quizzes,
            title:             cover["title"].as_str().unwrap_or("Quiz Compilation").to_string(),
            subtitle:          cover["subtitle"].as_str().unwrap_or("").to_string(),
            author:            cover["author"].as_str().unwrap_or("").to_string(),
            date:              cover["date"].as_str().unwrap_or("").to_string(),
            description:       cover["description"].as_str().unwrap_or("").to_string(),
            icon:              cover["icon"].as_str().unwrap_or("").to_string(),
            include_cover:     cover["include"].as_bool().unwrap_or(true),
            include_toc:       v["toc"]["include"].as_bool().unwrap_or(true),
            style_mode:        style["mode"].as_str().unwrap_or("standard").to_string(),
            layout_mode:       style["layout"].as_str().unwrap_or("single").to_string(),
            page_size:         style["pageSize"].as_str().unwrap_or("a4").to_string(),
            orientation:       style["orientation"].as_str().unwrap_or("portrait").to_string(),
            numbering:         style["numbering"].as_str().unwrap_or("global").to_string(),
            answers:           style["answers"].as_str().unwrap_or("inline").to_string(),
            show_explanations: style["showExplanations"].as_bool().unwrap_or(true),
        })
    }

    fn to_payload_json(&self) -> Value {
        json!({
            "cover": {
                "title": self.title,
                "subtitle": self.subtitle,
                "author": self.author,
                "date": self.date,
                "description": self.description,
                "icon": self.icon,
                "include": self.include_cover,
            },
            "toc": { "include": self.include_toc },
            "style": {
                "mode": self.style_mode,
                "layout": self.layout_mode,
                "pageSize": self.page_size,
                "orientation": self.orientation,
                "numbering": self.numbering,
                "answers": self.answers,
                "showExplanations": self.show_explanations,
            },
            "quizzes": self.quizzes.iter().map(|q| json!({
                "title": q.title,
                "description": q.description,
                "icon": q.icon,
                "type": q.r#type,
                "questions": q.questions.iter().map(|qd| json!({
                    "number": qd.number,
                    "question": qd.text,
                    "options": qd.options,
                    "correct": qd.correct,
                    "explanation": qd.explanation,
                    "modelAnswer": qd.model_answer,
                    "rubric": qd.rubric,
                    "children": qd.children.iter().map(|c| json!({
                        "label": c.label,
                        "question": c.text,
                        "modelAnswer": c.model_answer,
                        "rubric": c.rubric,
                        "explanation": c.explanation,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        })
    }
}

// ── PDF generation via sidecar ────────────────────────────────────────────

pub fn generate_pdf(config: &ExportConfig) -> Result<Vec<u8>, String> {
    let python = find_python().ok_or_else(|| {
        "Python 3 not found. Install Python 3.8+ from https://python.org".to_string()
    })?;

    // Extract embedded script
    let script_path = extract_script("pdf_generator.py", EMBED_PDF_GENERATOR)?;

    // Temp dir for config and output
    let work_dir = std::env::temp_dir().join("quiztool-pdf");
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let config_path = work_dir.join("config.json");
    let output_path = work_dir.join("output.pdf");

    let payload = config.to_payload_json();
    let json_str = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    std::fs::write(&config_path, &json_str)
        .map_err(|e| format!("Failed to write temp config: {e}"))?;

    let mut cmd = Command::new(&python);
    cmd.arg(&script_path)
        .arg(&config_path)
        .arg(&output_path)
        .env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output()
        .map_err(|e| format!("Failed to run PDF generator: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let _ = std::fs::remove_file(&config_path);

    if !output.status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("PDF generation failed: {stderr}"));
    }

    let pdf_bytes = std::fs::read(&output_path)
        .map_err(|e| format!("Failed to read generated PDF: {e}"))?;

    let _ = std::fs::remove_file(&output_path);

    if pdf_bytes.is_empty() {
        return Err("PDF generator produced an empty file".into());
    }

    Ok(pdf_bytes)
}
