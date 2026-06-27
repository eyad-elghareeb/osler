// =============================================================================
// providers/github_pages.rs  —  V2 (Phase 15)
// -----------------------------------------------------------------------------
// Deploys a generated site bundle to GitHub Pages.
//
// Flow:
//   1. Pick or create a repo (e.g. {user}.github.io or osler-site-{name})
//   2. Create an orphan `gh-pages` branch (no commit history)
//   3. Push the bundle as the branch root (replaces existing content)
//   4. Enable Pages on the repo settings (source: gh-pages branch)
//   5. Return the URL: https://{user}.github.io/{repo}/
//
// Reuses the admin's GitHub token (no separate credential needed).
// =============================================================================

use super::*;
use crate::git;
use std::path::PathBuf;

pub struct GithubPagesDeployer {
    pub repo: String,         // e.g. "osler-site"
    pub owner: String,        // e.g. "b1scoito" (the GitHub user/org)
}

impl GithubPagesDeployer {
    pub fn new(repo: String, owner: String) -> Self {
        Self { repo, owner }
    }

    fn url(&self) -> String {
        if self.repo == format!("{}.github.io", self.owner) {
            format!("https://{}/", self.owner)
        } else {
            format!("https://{}/{}/", self.owner, self.repo)
        }
    }
}

impl ProviderDeploy for GithubPagesDeployer {
    fn deploy(&self, bundle_path: &PathBuf, credentials: &Credentials) -> Result<DeployResult, ProviderError> {
        let token = match credentials {
            Credentials::Github { token } => token,
            _ => return Err(ProviderError::Config("expected Github credentials".into())),
        };

        // 1. Read the bundle zip
        let zip_bytes = std::fs::read(bundle_path)
            .map_err(ProviderError::Io)?;

        // 2. Extract the zip in memory and prepare the file list
        let files = extract_zip_files(&zip_bytes)?;

        // 3. Create the orphan gh-pages branch
        //    - First check if the repo exists; create if not
        let api = git::GithubApi::new(token.clone());

        if !api.repo_exists(&self.owner, &self.repo)? {
            api.create_repo(&self.owner, &self.repo)?;
        }

        // 4. Get the default branch SHA (for the orphan branch base)
        let _default_sha = api.get_default_branch_sha(&self.owner, &self.repo)?;

        // 5. Create orphan branch (no parent)
        let orphan_sha = api.create_orphan_commit(
            &self.owner,
            &self.repo,
            &files,
            "deploy: osler site v2.0.0",
        )?;

        // 6. Push the orphan branch as gh-pages
        api.update_branch(&self.owner, &self.repo, "gh-pages", &orphan_sha)?;

        // 7. Save rollback point: tag the previous gh-pages SHA if it existed
        if let Ok(prev_sha) = api.get_branch_sha(&self.owner, &self.repo, "gh-pages") {
            let rollback_tag = format!("gh-pages-rollback-{}", chrono::Utc::now().timestamp());
            let _ = api.create_tag(&self.owner, &self.repo, &rollback_tag, &prev_sha);
        }

        // 8. Enable Pages (source: gh-pages branch)
        api.enable_pages(&self.owner, &self.repo, "gh-pages")?;

        // 9. Return the URL (note: Pages takes ~30s to propagate on first deploy)
        Ok(DeployResult {
            url: self.url(),
            deployment_id: orphan_sha,
            provider: Provider::GithubPages,
            deployed_at: chrono::Utc::now(),
        })
    }

    fn rollback(&self, deployment_id: &str, credentials: &Credentials) -> Result<(), ProviderError> {
        let _token = match credentials {
            Credentials::Github { token } => token,
            _ => return Err(ProviderError::Config("expected Github credentials".into())),
        };

        // deployment_id is the commit SHA of the gh-pages branch at deploy time.
        // To roll back, we force-update gh-pages to that SHA.
        let api = git::GithubApi::new(_token.clone());

        api.update_branch(&self.owner, &self.repo, "gh-pages", deployment_id)
            .map_err(|e| ProviderError::ProviderError {
                status: 500,
                body: format!("Rollback failed: {}", e),
            })?;

        Ok(())
    }

}

// =============================================================================
// Internal: extract files from the bundle zip
// =============================================================================

fn extract_zip_files(zip_bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, ProviderError> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(zip_bytes.to_vec());
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| ProviderError::Config(format!("Invalid zip: {}", e)))?;

    let mut files = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| ProviderError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

        let name = file.name().to_string();
        if name.ends_with('/') {
            continue; // skip directories
        }

        let mut contents = Vec::new();
        file.read_to_end(&mut contents)
            .map_err(ProviderError::Io)?;

        files.push((name, contents));
    }
    Ok(files)
}
