// validate.rs — Lightweight content-JSON schema validation.
//
// Each content pack has a different shape (quiz/bank/written/flashcard/osce/video).
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
        "video" => validate_video(content),
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
            validate_qbank_images(q, "images", &mut errors, &ctx);
            validate_qbank_images(q, "choiceImages", &mut errors, &ctx);
            validate_qbank_images(q, "explanationImages", &mut errors, &ctx);
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
            validate_qbank_images(p, "images", &mut errors, &ctx);
            if let Some(qs) = p.get("questions").and_then(|v| v.as_array()) {
                for (j, q) in qs.iter().enumerate() {
                    let qctx = format!("{}.questions[{}]", ctx, j);
                    require_string(q, "id", &mut errors, &qctx);
                    require_string(q, "question", &mut errors, &qctx);
                    require_usize(q, "correct", &mut errors, &qctx);
                    require_string(q, "explanation", &mut errors, &qctx);
                    require_array_of_strings(q, "options", &mut errors, &qctx);
                    validate_qbank_images(q, "images", &mut errors, &qctx);
                    validate_qbank_images(q, "choiceImages", &mut errors, &qctx);
                    validate_qbank_images(q, "explanationImages", &mut errors, &qctx);
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

fn validate_flashcard_image(parent: &Value, key: &str, errors: &mut Vec<String>, ctx: &str) {
    match parent.get(key) {
        None => {}
        Some(v) => {
            let items: Vec<&Value> = if let Some(arr) = v.as_array() {
                arr.iter().collect()
            } else {
                vec![v]
            };
            for (j, img) in items.iter().enumerate() {
                if !img.is_object() {
                    errors.push(format!("{}: `{}[{}]` must be an object", ctx, key, j));
                    continue;
                }
                require_string(img, "src", &mut *errors, &format!("{}: {}[{}]", ctx, key, j));
            }
        }
    }
}

/// Validate a QBank image field (stem `images` or per-choice `choiceImages`).
/// `images` is a single object or array of objects; `choiceImages` is an array
/// whose elements are each a single object, array of objects, or null.
fn validate_qbank_images(parent: &Value, key: &str, errors: &mut Vec<String>, ctx: &str) {
    match parent.get(key) {
        None => {}
        Some(v) => {
            let items: Vec<&Value> = if let Some(arr) = v.as_array() {
                // choiceImages: array of (object | array | null)
                arr.iter().filter(|e| !e.is_null()).collect()
            } else {
                vec![v]
            };
            for (j, img) in items.iter().enumerate() {
                let imgs: Vec<&Value> = if let Some(arr) = img.as_array() {
                    arr.iter().collect()
                } else {
                    vec![*img]
                };
                for (k, im) in imgs.iter().enumerate() {
                    if !im.is_object() {
                        errors.push(format!("{}: `{}[{}]` must be an object", ctx, key, j));
                        continue;
                    }
                    require_string(im, "src", &mut *errors, &format!("{}: {}[{}][{}]", ctx, key, j, k));
                }
            }
        }
    }
}

fn validate_flashcard(content: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(arr) = require_array(content, "cards", &mut errors) {
        for (i, c) in arr.iter().enumerate() {
            let ctx = format!("cards[{}]", i);
            require_string(c, "id", &mut errors, &ctx);

            let ty = c.get("type").and_then(|v| v.as_str()).unwrap_or("basic");
            match ty {
                "cloze" => {
                    require_string(c, "text", &mut errors, &ctx);
                }
                _ => {
                    // Basic cards (default) need a front and back.
                    let has_front = c.get("front").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
                    let has_back = c.get("back").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
                    if ty == "basic" && (!has_front || !has_back) {
                        errors.push(format!("{}: basic cards require both `front` and `back`", ctx));
                    }
                }
            }

            if let Some(cur) = c.get("type") {
                if !cur.is_string() {
                    errors.push(format!("{}: `type` must be a string (\"basic\" or \"cloze\")", ctx));
                } else if !["basic", "cloze"].contains(&cur.as_str().unwrap_or("")) {
                    errors.push(format!("{}: `type` must be \"basic\" or \"cloze\"", ctx));
                }
            }

            validate_flashcard_image(c, "image", &mut errors, &ctx);
            validate_flashcard_image(c, "backImage", &mut errors, &ctx);
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

fn validate_video(content: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(arr) = require_array(content, "videos", &mut errors) {
        for (i, v) in arr.iter().enumerate() {
            let ctx = format!("videos[{}]", i);
            require_string(v, "id", &mut errors, &ctx);
            require_string(v, "title", &mut errors, &ctx);

            // source — must be an object with a valid `type` discriminator
            match v.get("source") {
                Some(src) if src.is_object() => {
                    require_string(src, "type", &mut errors, &ctx);
                    match src.get("type").and_then(|t| t.as_str()) {
                        Some("youtube") => {
                            require_string(src, "id", &mut errors, &ctx);
                            // YouTube IDs are 11 chars, but allow some slack for legacy IDs
                            if let Some(id) = src.get("id").and_then(|i| i.as_str()) {
                                if id.is_empty() {
                                    errors.push(format!("{}: `source.id` cannot be empty", ctx));
                                } else if id.len() > 32 {
                                    errors.push(format!("{}: `source.id` looks too long for a YouTube video id ({})", ctx, id.len()));
                                }
                            }
                        }
                        Some("mp4") | Some("hls") => {
                            require_string(src, "url", &mut errors, &ctx);
                        }
                        Some(other) => {
                            errors.push(format!("{}: `source.type` \"{}\" is not one of youtube/mp4/hls", ctx, other));
                        }
                        None => {}
                    }
                }
                Some(_) => errors.push(format!("{}: `source` must be an object", ctx)),
                None => errors.push(format!("{}: missing `source`", ctx)),
            }

            // Optional numeric duration
            if let Some(d) = v.get("duration") {
                if !d.is_u64() && !d.is_f64() {
                    errors.push(format!("{}: `duration` must be a number (seconds)", ctx));
                }
            }

            // Optional chapters — array of { time: number, title: string }
            if let Some(ch) = v.get("chapters") {
                if let Some(arr) = ch.as_array() {
                    for (j, c) in arr.iter().enumerate() {
                        let cctx = format!("{}.chapters[{}]", ctx, j);
                        require_usize(c, "time", &mut errors, &cctx);
                        require_string(c, "title", &mut errors, &cctx);
                    }
                } else {
                    errors.push(format!("{}: `chapters` must be an array", ctx));
                }
            }

            // Optional relatedArticles — array of strings
            require_array_of_strings(v, "relatedArticles", &mut errors, &ctx);
            // Optional tags — array of strings
            require_array_of_strings(v, "tags", &mut errors, &ctx);
        }
    }
    errors
}
