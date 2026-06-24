use serde_json::Value;
use std::collections::HashMap;

macro_rules! embed_schema {
    ($name:expr) => {
        include_str!(concat!("../../src/schemas/", $name))
    };
}

const SCHEMA_QUIZ: &str = embed_schema!("quiz-v1.json");
const SCHEMA_BANK: &str = embed_schema!("bank-v1.json");
const SCHEMA_FLASHCARD: &str = embed_schema!("flashcard-v1.json");
const SCHEMA_WRITTEN: &str = embed_schema!("written-v1.json");
const SCHEMA_OSCE: &str = embed_schema!("osce-v1.json");
const SCHEMA_HUB: &str = embed_schema!("hub-v1.json");
const META_REGISTRY: &str = embed_schema!("_meta.json");

fn schema_for(content_type: &str) -> Option<&'static str> {
    match content_type {
        "quiz" => Some(SCHEMA_QUIZ),
        "bank" => Some(SCHEMA_BANK),
        "flashcard" => Some(SCHEMA_FLASHCARD),
        "written" => Some(SCHEMA_WRITTEN),
        "osce" => Some(SCHEMA_OSCE),
        "hub" => Some(SCHEMA_HUB),
        _ => None,
    }
}

fn known_versions() -> HashMap<String, Vec<String>> {
    let mut map = HashMap::new();
    if let Ok(meta) = serde_json::from_str::<Value>(META_REGISTRY) {
        if let Some(schemas) = meta.get("schemas").and_then(|v| v.as_object()) {
            for (type_key, entry) in schemas {
                let content_type = type_key.trim_end_matches(char::is_numeric).to_lowercase();
                if let Some(version) = entry.get("version").and_then(|v| v.as_str()) {
                    map.entry(content_type)
                        .or_insert_with(Vec::new)
                        .push(version.to_string());
                }
            }
        }
    }
    map
}

#[tauri::command]
pub fn validate_content(content_type: String, content_json: Value) -> Result<Vec<String>, String> {
    let mut errors: Vec<String> = Vec::new();

    let schema_str = schema_for(&content_type).ok_or_else(|| {
        format!("Unknown content type: {}. Must be quiz, bank, flashcard, written, osce, or hub.", content_type)
    })?;

    let schema_val: Value = serde_json::from_str(schema_str)
        .map_err(|e| format!("Failed to parse schema for {}: {}", content_type, e))?;

    let compiled = jsonschema::JSONSchema::compile(&schema_val)
        .map_err(|e| format!("Failed to compile schema: {}", e))?;

    if let Err(validation_errors) = compiled.validate(&content_json) {
        for validation_error in validation_errors {
            errors.push(format!("{}", validation_error));
        }
    }

    let known = known_versions();
    if let Some(meta) = content_json.get("meta") {
        if let Some(sv) = meta.get("schemaVersion").and_then(|v| v.as_str()) {
            if let Some(versions) = known.get(&content_type) {
                if !versions.iter().any(|v| v == sv) {
                    errors.push(format!(
                        "meta.schemaVersion: unknown version '{}' for type '{}'. Known: {}",
                        sv,
                        content_type,
                        versions.join(", ")
                    ));
                }
            }
        } else {
            errors.push("meta.schemaVersion: missing or not a string".into());
        }
    } else {
        errors.push("meta: missing 'meta' object with 'schemaVersion'".into());
    }

    Ok(errors)
}
