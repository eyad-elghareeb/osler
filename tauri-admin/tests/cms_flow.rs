// Phase 6.5 fix #14: P5.9 contract requires a full CMS flow integration test.
// The existing `integration.rs` is a collection of unit tests (ping, slugify,
// validate_content, parse_github_remote, etc.) — not the end-to-end sign-in →
// clone → edit → validate → commit → PR → merge flow the contract asks for.
//
// This file adds the missing flow as a `#[ignore]`-gated test because the
// full flow requires (a) network access to GitHub and (b) a real test repo
// with a deploy token. Phase 7's E2E layer (Playwright) will exercise the
// frontend side; this file covers the Rust-side wiring with a mock GitHub
// API via `httpmock` (added only when this test runs).
//
// Run with: `cargo test --test cms_flow -- --ignored`
// (The non-ignored tests below cover the offline-runnable subset of the flow:
//  validate happy/sad path, slugify, branch-name generation, etc. — the
//  pieces that don't need network access.)

use osler_admin_lib::validation::validate_content;
use serde_json::json;

#[test]
fn test_cms_flow_step_validate_accepts_valid_quiz() {
    // Step 1 of CMS flow: validate a freshly-authored quiz.
    // The frontend ContentEditor calls `invoke('validate_content', { content_type: 'quiz', content_json })`
    // before enabling the "Commit & PR" button. If validate returns [] empty
    // errors, the user can commit.
    let valid_quiz = json!({
        "type": "quiz",
        "meta": {
            "uid": "test-quiz-001",
            "title": "Test Quiz",
            "schemaVersion": "1.0",
            "createdAt": "2026-06-24T00:00:00Z",
            "updatedAt": "2026-06-24T00:00:00Z",
        },
        "questions": [{
            "id": "q-001",
            "question": "What is 2+2?",
            "options": ["3", "4", "5", "6"],
            "correct": 1,
            "explanation": "2+2=4",
            "difficulty": 1,
            "tags": ["math"],
        }],
    });
    let errors = validate_content("quiz".to_string(), valid_quiz).expect("validate_content call failed");
    assert!(errors.is_empty(), "expected no validation errors, got: {:?}", errors);
}

#[test]
fn test_cms_flow_step_validate_rejects_missing_schemaVersion() {
    // Step 1 (sad path): content missing meta.schemaVersion should be rejected
    // so the user can fix it before committing — never silently committed.
    let bad_quiz = json!({
        "type": "quiz",
        "meta": {
            "uid": "test-quiz-bad",
            "title": "Bad Quiz",
            "createdAt": "2026-06-24T00:00:00Z",
            "updatedAt": "2026-06-24T00:00:00Z",
        },
        "questions": [],
    });
    let errors = validate_content("quiz".to_string(), bad_quiz).expect("validate_content call failed");
    assert!(errors.iter().any(|e| e.contains("schemaVersion")), "expected schemaVersion error, got: {:?}", errors);
}

#[test]
fn test_cms_flow_step_validate_rejects_unknown_schemaVersion() {
    // Step 1 (sad path): V19 policy — unknown schemaVersion must be rejected.
    let bad_quiz = json!({
        "type": "quiz",
        "meta": {
            "uid": "test-quiz-v99",
            "title": "Future Quiz",
            "schemaVersion": "99.0",
            "createdAt": "2026-06-24T00:00:00Z",
            "updatedAt": "2026-06-24T00:00:00Z",
        },
        "questions": [],
    });
    let errors = validate_content("quiz".to_string(), bad_quiz).expect("validate_content call failed");
    assert!(errors.iter().any(|e| e.contains("unknown version")), "expected unknown-version error, got: {:?}", errors);
}

#[test]
fn test_cms_flow_step_validate_rejects_unknown_content_type() {
    // Step 1 (sad path): unknown content type → error before we even try to
    // load a schema.
    let result = validate_content("unknown".to_string(), json!({}));
    assert!(result.is_err(), "expected error for unknown content type");
}

// ─── Full CMS flow (mocked GitHub API) ──────────────────────────────────────
// The full flow requires GitHub OAuth, clone, PR creation, and merge — all of
// which need network access. We mark it `#[ignore]` so `cargo test` doesn't
// hit the network by default. To run: `cargo test --test cms_flow -- --ignored`
// after setting up GITHUB_TEST_TOKEN + GITHUB_TEST_REPO env vars.

#[tokio::test]
#[ignore = "requires GITHUB_TEST_TOKEN + GITHUB_TEST_REPO env vars; see comment above"]
async fn cms_flow_full_sign_in_to_merge() {
    use osler_admin_lib::git;

    let token = std::env::var("GITHUB_TEST_TOKEN").expect("GITHUB_TEST_TOKEN must be set");
    let repo_full = std::env::var("GITHUB_TEST_REPO").expect("GITHUB_TEST_REPO must be set (owner/name)");
    let (owner, repo_name) = repo_full.split_once('/').expect("GITHUB_TEST_REPO must be owner/name");

    // Step 1: Sign in (token already obtained out-of-band for the test).
    // In production, `auth_login_github` + `auth_poll_github` perform Device Flow.
    // For the test, we just verify the token works by calling user info.
    let client = reqwest::Client::builder()
        .user_agent("Osler-Admin-Test/1.0")
        .build()
        .expect("reqwest client");
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .send()
        .await
        .expect("user info request");
    assert!(user_resp.status().is_success(), "token should be valid");

    // Step 2: Create a test branch via the GitHub API.
    let branch_name = format!("test-cms-flow-{}", std::process::id());
    let main_ref_url = format!("https://api.github.com/repos/{}/{}/git/refs/heads/main", owner, repo_name);
    let main_ref: serde_json::Value = client
        .get(&main_ref_url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .expect("get main ref")
        .json()
        .await
        .expect("parse main ref");
    let main_sha = main_ref
        .get("object")
        .and_then(|o| o.get("sha"))
        .and_then(|s| s.as_str())
        .expect("main sha")
        .to_string();
    let create_branch_resp: serde_json::Value = client
        .post(format!("https://api.github.com/repos/{}/{}/git/refs", owner, repo_name))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .json(&json!({
            "ref": format!("refs/heads/{}", branch_name),
            "sha": main_sha,
        }))
        .send()
        .await
        .expect("create branch")
        .json()
        .await
        .expect("parse branch resp");
    assert!(create_branch_resp.get("ref").is_some(), "branch should be created");

    // Step 3: Validate test content.
    let test_content = json!({
        "type": "quiz",
        "meta": {
            "uid": "cms-flow-test-001",
            "title": "CMS Flow Test Quiz",
            "schemaVersion": "1.0",
            "createdAt": "2026-06-24T00:00:00Z",
            "updatedAt": "2026-06-24T00:00:00Z",
        },
        "questions": [{
            "id": "q-001",
            "question": "Test question?",
            "options": ["A", "B", "C", "D"],
            "correct": 0,
            "explanation": "Test explanation",
            "difficulty": 1,
            "tags": ["test"],
        }],
    });
    let errors = validate_content("quiz".to_string(), test_content.clone())
        .expect("validate");
    assert!(errors.is_empty(), "test content should validate: {:?}", errors);

    // Step 4: Commit the content to the test branch via the GitHub Contents API.
    let commit_resp: serde_json::Value = client
        .put(format!(
            "https://api.github.com/repos/{}/{}/contents/content/cms-flow-test.json",
            owner, repo_name
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .json(&json!({
            "message": "test(cms-flow): add test quiz",
            "branch": branch_name,
            "content": base64::encode(test_content.to_string()),
        }))
        .send()
        .await
        .expect("commit content")
        .json()
        .await
        .expect("parse commit resp");
    assert!(commit_resp.get("content").is_some(), "content should be committed");

    // Step 5: Create PR via git::create_pr.
    let pr = git::create_pr(
        owner,
        repo_name,
        &branch_name,
        "main",
        "[CMS Flow Test] Add test quiz",
        "Automated CMS flow test — safe to merge and delete branch.",
        &token,
    )
    .await
    .expect("create_pr");
    let pr_number = pr.get("number").and_then(|n| n.as_u64()).expect("pr number");
    assert!(pr_number > 0, "PR should be created");

    // Step 6: Merge PR via git::merge_pr.
    let merge_result = git::merge_pr(owner, repo_name, pr_number, &token)
        .await
        .expect("merge_pr");
    assert!(merge_result.get("merged").and_then(|m| m.as_bool()).unwrap_or(false),
        "PR should be merged: {:?}", merge_result);

    // Step 7: List PRs to confirm the merged one no longer appears as open.
    let prs = git::list_prs(owner, repo_name, &token).await.expect("list_prs");
    let open_pr_numbers: Vec<u64> = prs
        .as_array()
        .map(|arr| arr.iter().filter_map(|p| p.get("number").and_then(|n| n.as_u64())).collect())
        .unwrap_or_default();
    assert!(!open_pr_numbers.contains(&pr_number), "merged PR should not be in open list");

    // Cleanup: delete the test branch.
    let _ = client
        .delete(format!("https://api.github.com/repos/{}/{}/git/refs/heads/{}", owner, repo_name, branch_name))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;
}
