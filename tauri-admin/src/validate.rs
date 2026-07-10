// validate.rs — Lightweight content-JSON schema validation.
//
// Each content pack has a different shape (quiz/bank/written/flashcard/osce).
// This module returns a list of human-readable error strings; an empty list
// means the content is valid.

use serde_json::Value;

/// Validate a content pack JSON object against its declared type.
pub fn validate(content_type: &str, content: &Value) -> Vec<String> {
    match content_type {
        "quiz" => validate_quiz(content),
        "bank" => validate_bank(content),
        "written" => validate_written(content),
        "flashcard" => validate_flashcard(content),
        "osce" => validate_osce(content),
        _ => vec![format!("Unknown content type: {}", content_type)],
    }
}

fn require_array<'a>(content: &'a Value, key: &str, errors: &mut Vec<String>) -> Option<&'a Vec<Value>> {
    match content.get(key) {
        Some(v) => match v.as_array() {
            Some(arr) => Some(arr),
            None => {
                errors.push(format!("`{}` must be an array", key));
                None
            }
        },
        None => {
            errors.push(format!("Missing required field: `{}`", key));
            None
        }
    }
}

fn require_string(parent: &Value, key: &str, errors: &mut Vec<String>, ctx: &str) {
    match parent.get(key) {
        Some(v) if v.is_string() => {}
        Some(_) => errors.push(format!("{}: `{}` must be a string", ctx, key)),
        None => errors.push(format!("{}: missing `{}`", ctx, key)),
    }
}

fn require_usize(parent: &Value, key: &str, errors: &mut Vec<String>, ctx: &str) {
    match parent.get(key) {
        Some(v) if v.as_u64().is_some() => {}
        Some(_) => errors.push(format!("{}: `{}` must be a non-negative integer", ctx, key)),
        None => errors.push(format!("{}: missing `{}`", ctx, key)),
    }
}

fn require_array_of_strings(parent: &Value, key: &str, errors: &mut Vec<String>, ctx: &str) {
    match parent.get(key) {
        Some(v) => match v.as_array() {
            Some(arr) => {
                for (i, item) in arr.iter().enumerate() {
                    if !item.is_string() {
                        errors.push(format!("{}: `{}[{}]` must be a string", ctx, key, i));
                    }
                }
            }
            None => errors.push(format!("{}: `{}` must be an array", ctx, key)),
        },
        None => {}
    }
}

fn validate_quiz(content: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(arr) = require_array(content, "questions", &mut errors) {
        for (i, q) in arr.iter().enumerate() {
            let ctx = format!("questions[{}]", i);
            require_string(q, "id", &mut errors, &ctx);
            require_string(q, "question", &mut errors, &ctx);
            require_usize(q, "correct", &mut errors, &ctx);
            require_string(q, "explanation", &mut errors, &ctx);
            // options must be a non-empty array of strings
            match q.get("options") {
                Some(v) => match v.as_array() {
                    Some(arr) if !arr.is_empty() => {
                        for (j, opt) in arr.iter().enumerate() {
                            if !opt.is_string() {
                                errors.push(format!("{}: `options[{}]` must be a string", ctx, j));
                            }
                        }
                        // correct index must be in bounds
                        if let Some(c) = q.get("correct").and_then(|v| v.as_u64()) {
                            if c as usize >= arr.len() {
                                errors.push(format!("{}: `correct` ({}) is out of bounds (0..{})", ctx, c, arr.len() - 1));
                            }
                        }
                    }
                    Some(_) => errors.push(format!("{}: `options` must be an array", ctx)),
                    None => errors.push(format!("{}: missing `options`", ctx)),
                },
                None => errors.push(format!("{}: missing `options`", ctx)),
            }
            require_array_of_strings(q, "tags", &mut errors, &ctx);
        }
    }
    errors
}

fn validate_bank(content: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(arr) = require_array(content, "passages", &mut errors) {
        for (i, p) in arr.iter().enumerate() {
            let ctx = format!("passages[{}]", i);
            require_string(p, "id", &mut errors, &ctx);
            require_string(p, "content", &mut errors, &ctx);
            if let Some(qs) = p.get("questions").and_then(|v| v.as_array()) {
                for (j, q) in qs.iter().enumerate() {
                    let qctx = format!("{}.questions[{}]", ctx, j);
                    require_string(q, "id", &mut errors, &qctx);
                    require_string(q, "question", &mut errors, &qctx);
                    require_usize(q, "correct", &mut errors, &qctx);
                    require_string(q, "explanation", &mut errors, &qctx);
                    require_array_of_strings(q, "options", &mut errors, &qctx);
                }
            } else {
                errors.push(format!("{}: missing `questions` array", ctx));
            }
        }
    }
    errors
}

fn validate_written(content: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(arr) = require_array(content, "prompts", &mut errors) {
        for (i, p) in arr.iter().enumerate() {
            let ctx = format!("prompts[{}]", i);
            require_string(p, "id", &mut errors, &ctx);
            require_string(p, "prompt", &mut errors, &ctx);
            require_array_of_strings(p, "rubric", &mut errors, &ctx);
        }
    }
    errors
}

fn validate_flashcard(content: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(arr) = require_array(content, "cards", &mut errors) {
        for (i, c) in arr.iter().enumerate() {
            let ctx = format!("cards[{}]", i);
            require_string(c, "id", &mut errors, &ctx);
            require_string(c, "front", &mut errors, &ctx);
            require_string(c, "back", &mut errors, &ctx);
            require_array_of_strings(c, "tags", &mut errors, &ctx);
        }
    }
    errors
}

fn validate_osce(content: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(arr) = require_array(content, "stations", &mut errors) {
        for (i, s) in arr.iter().enumerate() {
            let ctx = format!("stations[{}]", i);
            require_string(s, "id", &mut errors, &ctx);
            require_string(s, "title", &mut errors, &ctx);
            require_string(s, "task", &mut errors, &ctx);
            require_usize(s, "time", &mut errors, &ctx);
            if s.get("patient").is_none() {
                errors.push(format!("{}: missing `patient`", ctx));
            }
            if s.get("hiddenProfile").is_none() {
                errors.push(format!("{}: missing `hiddenProfile`", ctx));
            }
            if s.get("rubric").is_none() {
                errors.push(format!("{}: missing `rubric`", ctx));
            }
        }
    }
    errors
}
