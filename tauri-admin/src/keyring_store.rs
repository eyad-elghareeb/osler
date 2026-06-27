// =============================================================================
// keyring_store.rs  —  V2 (Phase 15)
// -----------------------------------------------------------------------------
// Provider credential storage. Wraps the `keyring` crate to store deploy
// provider credentials (Netlify, Vercel, Cloudflare) in the OS keychain.
//
// V1 already uses `keyring` for the GitHub token. This module extends it
// to cover the V2 deploy providers, following the same conventions:
//   - Service name: `com.osler.admin.{provider}`
//   - Account: "default"
//   - Value: JSON-serialized credentials
//
// GitHub Pages reuses the V1 GitHub token (no separate credential needed).
// =============================================================================

use keyring::Entry;

use crate::providers::{Credentials, Provider};

const KEYRING_ACCOUNT: &str = "default";

// =============================================================================
// Public API
// =============================================================================

/// Store credentials for a provider in the OS keychain.
pub fn set_credentials(provider: Provider, credentials: &Credentials) -> Result<(), KeyringError> {
    let service = provider.keychain_service();
    let entry = Entry::new(&service, KEYRING_ACCOUNT)
        .map_err(|e| KeyringError::Backend(e.to_string()))?;

    let json = serde_json::to_string(credentials)
        .map_err(|e| KeyringError::Serialization(e.to_string()))?;

    entry.set_password(&json)
        .map_err(|e| KeyringError::Backend(e.to_string()))
}

/// Retrieve credentials for a provider from the OS keychain.
/// Returns `Ok(None)` if no credentials are stored (not an error).
pub fn get_credentials(provider: Provider) -> Result<Option<Credentials>, KeyringError> {
    let service = provider.keychain_service();
    let entry = Entry::new(&service, KEYRING_ACCOUNT)
        .map_err(|e| KeyringError::Backend(e.to_string()))?;

    match entry.get_password() {
        Ok(json) => {
            let creds: Credentials = serde_json::from_str(&json)
                .map_err(|e| KeyringError::Serialization(e.to_string()))?;
            Ok(Some(creds))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(KeyringError::Backend(e.to_string())),
    }
}

/// Delete credentials for a provider.
/// Returns `Ok(())` if deleted or already absent.
pub fn delete_credentials(provider: Provider) -> Result<(), KeyringError> {
    let service = provider.keychain_service();
    let entry = Entry::new(&service, KEYRING_ACCOUNT)
        .map_err(|e| KeyringError::Backend(e.to_string()))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone — not an error
        Err(e) => Err(KeyringError::Backend(e.to_string())),
    }
}

/// Test whether credentials are valid by making a minimal API call.
/// Delegates to provider-specific test endpoints.
pub fn test_credentials(provider: Provider) -> Result<bool, KeyringError> {
    let creds = get_credentials(provider)?
        .ok_or(KeyringError::NoCredentials)?;

    match provider {
        Provider::GithubPages => {
            // Reuses the GitHub token — V1 already validates it.
            // For V2, we just check the token can hit /user.
            if let Credentials::Github { token } = creds {
                test_github_token(&token)
            } else {
                Err(KeyringError::TypeMismatch)
            }
        }
        Provider::Netlify => {
            if let Credentials::Netlify { access_token } = creds {
                test_netlify_token(&access_token)
            } else {
                Err(KeyringError::TypeMismatch)
            }
        }
        Provider::Vercel => {
            if let Credentials::Vercel { access_token } = creds {
                test_vercel_token(&access_token)
            } else {
                Err(KeyringError::TypeMismatch)
            }
        }
        Provider::Cloudflare => {
            if let Credentials::Cloudflare { api_token, account_id } = creds {
                test_cloudflare_token(&api_token, &account_id)
            } else {
                Err(KeyringError::TypeMismatch)
            }
        }
    }
}

// =============================================================================
// Provider-specific test calls
//
// Each makes a minimal GET to the provider's "whoami" endpoint.
// Returns Ok(true) on 200, Ok(false) on 401/403, Err on network errors.
// =============================================================================

fn test_github_token(token: &str) -> Result<bool, KeyringError> {
    let resp = ureq::get("https://api.github.com/user")
        .set("Authorization", &format!("token {}", token))
        .set("User-Agent", "osler-admin")
        .call();
    match resp {
        Ok(r) => Ok(r.status() == 200),
        Err(ureq::Error::Status(s, _)) => Ok(s != 401 && s != 403),
        Err(e) => Err(KeyringError::Network(e.to_string())),
    }
}

fn test_netlify_token(token: &str) -> Result<bool, KeyringError> {
    let resp = ureq::get("https://api.netlify.com/api/v1/users")
        .set("Authorization", &format!("Bearer {}", token))
        .call();
    match resp {
        Ok(r) => Ok(r.status() == 200),
        Err(ureq::Error::Status(s, _)) => Ok(s != 401 && s != 403),
        Err(e) => Err(KeyringError::Network(e.to_string())),
    }
}

fn test_vercel_token(token: &str) -> Result<bool, KeyringError> {
    let resp = ureq::get("https://api.vercel.com/v2/user")
        .set("Authorization", &format!("Bearer {}", token))
        .call();
    match resp {
        Ok(r) => Ok(r.status() == 200),
        Err(ureq::Error::Status(s, _)) => Ok(s != 401 && s != 403),
        Err(e) => Err(KeyringError::Network(e.to_string())),
    }
}

fn test_cloudflare_token(token: &str, account_id: &str) -> Result<bool, KeyringError> {
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/pages/projects",
        account_id
    );
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .call();
    match resp {
        Ok(r) => Ok(r.status() == 200),
        Err(ureq::Error::Status(s, _)) => Ok(s != 401 && s != 403),
        Err(e) => Err(KeyringError::Network(e.to_string())),
    }
}

// =============================================================================
// Errors
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum KeyringError {
    #[error("Keychain backend error: {0}")]
    Backend(String),

    #[error("Credential serialization error: {0}")]
    Serialization(String),

    #[error("No credentials stored for this provider")]
    NoCredentials,

    #[error("Credential type does not match provider")]
    TypeMismatch,

    #[error("Network error while testing credentials: {0}")]
    Network(String),
}
