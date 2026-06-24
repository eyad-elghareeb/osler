use serde_json::json;

#[test]
fn test_ping() {
    assert_eq!(osler_admin_lib::commands::ping(), "pong");
}

#[test]
fn test_slugify() {
    use osler_admin_lib::templates;
    assert_eq!(templates::slugify("Hello World", "default"), "hello-world");
    assert_eq!(templates::slugify("  spaces  ", "default"), "spaces");
    assert_eq!(templates::slugify("", "default"), "default");
    assert_eq!(templates::slugify("UPPER-CASE", "d"), "upper-case");
}

#[test]
fn test_snakeify() {
    use osler_admin_lib::templates;
    assert_eq!(templates::snakeify("Hello World", "def"), "hello_world");
    assert_eq!(templates::snakeify("", "def"), "def");
    assert_eq!(templates::snakeify("snake-case", "d"), "snake_case");
}

#[test]
fn test_derive_uid() {
    use osler_admin_lib::templates;
    assert_eq!(templates::derive_uid("cardiology", "quiz"), "cardiology_quiz");
    assert_eq!(templates::derive_uid(".", "root_file"), "root_file");
    assert_eq!(templates::derive_uid("a/b/c", "file"), "a_b_c_file");
}

#[test]
fn test_relative_prefix() {
    use osler_admin_lib::templates;
    assert_eq!(templates::relative_prefix("."), "");
    assert_eq!(templates::relative_prefix(""), "");
    assert_eq!(templates::relative_prefix("foo"), "../");
    assert_eq!(templates::relative_prefix("foo/bar"), "../../");
    assert_eq!(templates::relative_prefix("a/b/c"), "../../../");
}

#[test]
fn test_parse_github_remote_https() {
    use osler_admin_lib::git;
    let url = "https://github.com/owner/repo.git";
    let result = git::parse_github_remote(url);
    assert!(result.is_some());
    let (o, r) = result.unwrap();
    assert_eq!(o, "owner");
    assert_eq!(r, "repo");
}

#[test]
fn test_parse_github_remote_ssh() {
    use osler_admin_lib::git;
    let url = "git@github.com:owner/repo.git";
    let result = git::parse_github_remote(url);
    assert!(result.is_some());
    let (o, r) = result.unwrap();
    assert_eq!(o, "owner");
    assert_eq!(r, "repo");
}

#[test]
fn test_parse_github_remote_no_match() {
    use osler_admin_lib::git;
    assert!(git::parse_github_remote("https://gitlab.com/owner/repo").is_none());
    assert!(git::parse_github_remote("").is_none());
}

#[test]
fn test_validate_content_quiz_valid() {
    use osler_admin_lib::validation;
    let content = json!({
        "meta": {
            "uid": "test_quiz",
            "title": "Test Quiz",
            "description": "A test",
            "schemaVersion": "1.0",
            "createdAt": "2025-01-01T00:00:00Z",
            "updatedAt": "2025-01-01T00:00:00Z"
        },
        "type": "quiz",
        "questions": [
            {
                "id": "q1",
                "question": "What is the answer?",
                "options": ["A", "B", "C", "D"],
                "correct": 0,
                "explanation": "Because"
            }
        ]
    });
    let errors = validation::validate_content("quiz".into(), content).unwrap();
    assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
}

#[test]
fn test_validate_content_invalid_type() {
    use osler_admin_lib::validation;
    let content = json!({"meta": {"schemaVersion": "v1"}});
    let result = validation::validate_content("unknown".into(), content);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Unknown content type"));
}

#[test]
fn test_validate_content_missing_meta() {
    use osler_admin_lib::validation;
    let content = json!({"type": "quiz", "questions": []});
    let errors = validation::validate_content("quiz".into(), content).unwrap();
    assert!(!errors.is_empty());
    assert!(errors.iter().any(|e| e.contains("meta")));
}

#[test]
fn test_validate_content_invalid_schema_version() {
    use osler_admin_lib::validation;
    let content = json!({
        "meta": {
            "schemaVersion": "v999",
            "uid": "test",
            "title": "T",
            "createdAt": "2025-01-01T00:00:00Z",
            "updatedAt": "2025-01-01T00:00:00Z"
        },
        "type": "quiz",
        "questions": [{"id":"q1","question":"Q?","options":["A","B"],"correct":0,"explanation":"E"}]
    });
    let errors = validation::validate_content("quiz".into(), content).unwrap();
    let has_version_error = errors.iter().any(|e| e.contains("schemaVersion"));
    assert!(has_version_error, "Expected schemaVersion error, got: {:?}", errors);
}

#[test]
fn test_sanitize_jsonish() {
    use osler_admin_lib::parser;
    let raw = r#"{ "key": "value", }"#;
    let cleaned = parser::sanitize_jsonish(raw);
    let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap();
    assert_eq!(parsed["key"], "value");
}

#[test]
fn test_parse_quiz_metadata() {
    use osler_admin_lib::parser;
    let html = r#"<script>const QUIZ_CONFIG = {"uid":"test_uid","title":"Test","description":"Desc"};</script>
<script>const QUESTIONS = [{"question":"Q?","options":["A","B"],"correct":0,"explanation":"E"}];</script>"#;
    let meta = parser::parse_file_metadata(html);
    assert_eq!(meta.file_type, parser::FileType::Quiz);
    assert_eq!(meta.uid.as_deref(), Some("test_uid"));
    assert_eq!(meta.title.as_deref(), Some("Test"));
    assert_eq!(meta.description.as_deref(), Some("Desc"));
    assert_eq!(meta.question_count, 1);
}

#[test]
fn test_parse_bank_metadata() {
    use osler_admin_lib::parser;
    let html = r#"<script>const BANK_CONFIG = {"uid":"bank_uid","title":"Bank","description":"A bank"};</script>
<script>const QUESTION_BANK = [{"question":"Q1"},{"question":"Q2"}];</script>"#;
    let meta = parser::parse_file_metadata(html);
    assert_eq!(meta.file_type, parser::FileType::Bank);
    assert_eq!(meta.uid.as_deref(), Some("bank_uid"));
    assert_eq!(meta.question_count, 2);
}

#[test]
fn test_parse_flashcard_metadata() {
    use osler_admin_lib::parser;
    let html = r#"<script>const BANK_CONFIG = {"uid":"fc_uid","title":"FC","description":"D","icon":"🃏"};</script>
<script>const FLASHCARD_BANK = [{"front":"Q","back":"A"}];</script>"#;
    let meta = parser::parse_file_metadata(html);
    assert_eq!(meta.file_type, parser::FileType::Flashcard);
    assert_eq!(meta.uid.as_deref(), Some("fc_uid"));
}

#[test]
fn test_parse_written_metadata() {
    use osler_admin_lib::parser;
    let html = r#"<script>const WRITTEN_CONFIG = {"uid":"w_uid","title":"Written","description":"D"};</script>
<script>const QUESTIONS = [{"question":"Q?","rubric":"R"}];</script>"#;
    let meta = parser::parse_file_metadata(html);
    assert_eq!(meta.file_type, parser::FileType::Written);
    assert_eq!(meta.uid.as_deref(), Some("w_uid"));
}

#[test]
fn test_parse_osce_metadata() {
    use osler_admin_lib::parser;
    let html = r#"<script>const OSCE_CONFIG = {"uid":"osce_uid","title":"OSCE","description":"D"};</script>
<script>const OSCE_CASES = [{"title":"Case 1"}];</script>"#;
    let meta = parser::parse_file_metadata(html);
    assert_eq!(meta.file_type, parser::FileType::Osce);
    assert_eq!(meta.uid.as_deref(), Some("osce_uid"));
}

#[test]
fn test_parse_index_html() {
    use osler_admin_lib::parser;
    let html = r#"<!DOCTYPE html><html><head><script>const QUIZZES = [{"title":"Quiz 1"}];</script><title>Index</title></head></html>"#;
    let meta = parser::parse_file_metadata(html);
    assert_eq!(meta.file_type, parser::FileType::Index);
    assert_eq!(meta.title.as_deref(), Some("Index"));
}

#[test]
fn test_create_quiz_html_then_parse() {
    use osler_admin_lib::{parser, templates};
    let cfg = json!({"uid": "new_uid", "title": "New Quiz", "description": "Desc"});
    let questions = json!([{"question": "Q?", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "E"}]);
    let html = templates::create_quiz_html(&cfg, &questions);
    assert!(html.contains("new_uid"));
    assert!(html.contains("New Quiz"));
    assert!(html.contains("Q?"));
    let meta = parser::parse_file_metadata(&html);
    assert_eq!(meta.file_type, parser::FileType::Quiz);
    assert_eq!(meta.uid.as_deref(), Some("new_uid"));
}

#[test]
fn test_create_bank_html_then_parse() {
    use osler_admin_lib::{parser, templates};
    let cfg = json!({"uid": "b_uid", "title": "Bank", "description": "D"});
    let questions = json!([{"question": "Q1?"}, {"question": "Q2?"}]);
    let html = templates::create_bank_html(&cfg, &questions);
    assert!(html.contains("b_uid"));
    let meta = parser::parse_file_metadata(&html);
    assert_eq!(meta.file_type, parser::FileType::Bank);
    assert_eq!(meta.question_count, 2);
}

#[test]
fn test_create_flashcard_html_then_parse() {
    use osler_admin_lib::{parser, templates};
    let cfg = json!({"uid": "fc","title":"FC","description":"D","icon":"🃏"});
    let questions = json!([{"front":"Front","back":"Back"}]);
    let html = templates::create_flashcard_html(&cfg, &questions);
    assert!(html.contains("Front"));
    let meta = parser::parse_file_metadata(&html);
    assert_eq!(meta.file_type, parser::FileType::Flashcard);
}

#[test]
fn test_version_constant() {
    assert_eq!(osler_admin_lib::VERSION, "5.1.0");
}


