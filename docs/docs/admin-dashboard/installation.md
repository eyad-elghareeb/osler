# Admin Dashboard Installation

This page covers three installation paths:

1. **Download a pre-built binary** (recommended for non-developers)
2. **Build from source** (for developers and self-hosters)
3. **Development mode** (with hot reload of the frontend)

## Prerequisites

### All platforms

- A GitHub account (the admin uses GitHub Device Flow for sign-in)
- ~150 MB free disk space (the binary + cached content)

### Linux

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1 \
  libappindicator3-1 \
  librsvg2-2
```

### macOS

- macOS 11 (Big Sur) or later
- Xcode Command Line Tools (`xcode-select --install`)

### Windows

- Windows 10 or later
- WebView2 runtime (pre-installed on Windows 11; on Windows 10, install from
  [microsoft.com/edge/webview2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/))

## Path 1: Download a pre-built binary

Pre-built binaries are attached to every GitHub Release at
[github.com/osler-app/osler/releases](https://github.com/osler-app/osler/releases).

| Platform | File |
|----------|------|
| Linux x64 | `osler-admin_{version}_amd64.AppImage` |
| macOS (Apple Silicon) | `osler-admin_{version}_aarch64.dmg` |
| macOS (Intel) | `osler-admin_{version}_x64.dmg` |
| Windows x64 | `osler-admin_{version}_x64-setup.exe` |

### Linux

```bash
chmod +x osler-admin_5.1.0_amd64.AppImage
./osler-admin_5.1.0_amd64.AppImage
```

If AppImage fails to launch, install `libappindicator3-1`:

```bash
sudo apt-get install -y libappindicator3-1
```

### macOS

Open the `.dmg`, drag **Osler Admin.app** to Applications. On first launch,
right-click → Open (to bypass Gatekeeper; the binary is not code-signed in V1
— V2 will add code signing).

### Windows

Run `osler-admin_5.1.0_x64-setup.exe`. The installer places a shortcut on the
desktop and in the Start Menu. The app installs to
`C:\Program Files\Osler Admin\`.

## Path 2: Build from source

### 1. Clone the repo

```bash
git clone https://github.com/osler-app/osler.git
cd osler/tauri-admin
```

### 2. Install Rust

If you don't have Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

Verify:

```bash
rustc --version    # 1.75+ recommended
cargo --version
```

### 3. Install Tauri CLI

```bash
cargo install tauri-cli --version "^2.0"
```

### 4. Install system dependencies (Linux only)

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 5. Build

```bash
cd tauri-admin
cargo build --release
```

The first build takes ~5-10 minutes (compiles all Rust dependencies). The
binary lands at `target/release/osler-admin` (Linux), or the
platform-appropriate equivalent.

### 6. Run

```bash
./target/release/osler-admin
```

Or build a platform installer:

```bash
cargo tauri build
```

This produces a `.deb` / `.rpm` / `.dmg` / `.exe` in
`target/release/bundle/`.

## Path 3: Development mode

For frontend development (HTML/JS in `tauri-admin/frontend/`), use dev mode
for hot reload:

```bash
cd tauri-admin
cargo run         # starts the Rust shell in dev mode
```

In dev mode, Tauri serves the frontend from `frontend/` (not bundled). Edit
any `.html` / `.js` / `.css` file in `frontend/` and reload the webview
(Ctrl+R or Cmd+R).

For Rust-side changes, `cargo run` recompiles and restarts on each save
(use `cargo watch -x run` for auto-restart on save — install with
`cargo install cargo-watch`).

## First-run setup

On first launch, the admin prompts for GitHub sign-in:

1. Click **Sign in with GitHub**.
2. The admin displays an 8-digit code and opens
   [github.com/login/device](https://github.com/login/device) in your default
   browser.
3. Enter the code in the browser.
4. Authorize the Osler app.
5. The admin exchanges the code for a token and stores it in the OS keychain.
6. The admin loads your GitHub repos.

Subsequent launches skip the sign-in step (token is reused from keychain).

## Configuring the content repo

After sign-in, pick or create a content repo:

1. Go to **Settings** → **Content Repo**.
2. Pick an existing repo from the dropdown, or click **Create new repo**.
3. The admin creates `osler-content` (or a name you choose) with a default
   `manifest.json` and `.gitignore`.
4. The admin commits the existing `content/*.json` files to the new repo.

From this point, all content edits go through the GitHub CMS workflow. See
[Content CMS](content-cms.md).

## Configuring Firebase (optional)

If you want analytics aggregation in the admin (beyond what the PWA reports
via Firebase Analytics), configure a service account:

1. Go to **Settings** → **Firebase**.
2. Click **Choose service account JSON**.
3. Pick the JSON file downloaded from the Firebase console (Project Settings
   → Service Accounts → Generate new private key).
4. The admin stores the file path in the OS keychain and reads the JSON on
   demand (never persists the JSON itself).

See [Firebase → Bring Your Own](../firebase/bring-your-own.md) for the full
Firebase project setup.

## Configuring deploy providers (V2)

V2 adds per-provider credential configuration:

1. Go to **Settings** → **Deploy Providers**.
2. For each provider you want to use:
   - Click **Add credentials**.
   - Paste the provider API token (Netlify, Vercel, Cloudflare) or pick the
     GitHub token (already configured).
   - Click **Test** to verify the credentials work.
3. The admin stores each token in the OS keychain under a provider-specific
     service name (`com.osler.admin.netlify`, etc.).

See [Deployment](../deployment/github-pages.md) for per-provider setup
instructions.

## Upgrading the admin

The admin self-updates by default (Tier 1, see
[Architecture → Security Model](../architecture/security-model.md#tier-1--admin-dashboard-self-update)).
To disable:

1. Go to **Settings** → **Updates**.
2. Toggle **Check for updates automatically** off.

To check manually:

1. Go to **Settings** → **Updates**.
2. Click **Check now**.

When a new version is found, the admin downloads it, verifies the SHA-256
hash, and prompts you to restart. The previous binary is kept as a backup
for 7 days.

## Uninstalling

### Linux

```bash
rm osler-admin_5.1.0_amd64.AppImage
# or, if installed via .deb:
sudo apt remove osler-admin
```

Clear the keychain entry:

```bash
secret-tool clear application osler-admin
```

### macOS

Drag **Osler Admin.app** from Applications to Trash. Clear the keychain:

```bash
security delete-generic-password -s "osler-admin"
```

### Windows

Use Add/Remove Programs. Clear the keychain (Credential Manager → Windows
Credentials → remove `osler-admin:*` entries).

## What's next

- [Content CMS](content-cms.md) — authoring workflow.
- [Settings](settings.md) — all configuration options.
- [Site Generation → Wizard](../site-generation/wizard.md) — generating your
  first site.
