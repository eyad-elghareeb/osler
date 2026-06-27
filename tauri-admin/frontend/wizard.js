/* ================================================================
   wizard.js  —  V2 (Phase 13)
   ----------------------------------------------------------------
   Site generator wizard logic. Calls Tauri commands (commands_v2)
   to assemble the bundle, preview locally, and deploy.
   ================================================================ */

const { invoke } = window.__TAURI__;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  step: 1,
  engines: { quiz: true, bank: true, flashcard: true, written: true, osce: true },
  content: { selected: new Set(), uploads: [] },
  theme: {
    primary: '#3b82f6',
    accent: '#10b981',
    background: 'system',
    fontFamily: 'Inter',
    appName: 'Osler',
    tagline: 'Medical study platform',
    logo: null,
    favicon: null,
    customCss: '',
  },
  auth: { mode: 'none', firebaseConfig: null },
  deploy: { target: 'preview_only', siteName: null, owner: null },
  bundleResult: null, // set after generate
};

// ─────────────────────────────────────────────────────────────────────────────
// Step navigation
// ─────────────────────────────────────────────────────────────────────────────

function goToStep(step) {
  if (step < 1 || step > 5) return;

  // Hide all panels
  document.querySelectorAll('.wizard-panel').forEach(p => p.hidden = true);

  // Show the target panel
  document.querySelector(`[data-panel="${step}"]`).hidden = false;

  // Update step indicators
  document.querySelectorAll('.wizard-step-indicator').forEach(ind => {
    const indStep = parseInt(ind.dataset.step);
    ind.classList.toggle('active', indStep === step);
    ind.classList.toggle('completed', indStep < step);
  });

  // Update nav buttons
  document.querySelector('[data-action="prev"]').disabled = (step === 1);
  document.querySelector('[data-action="next"]').hidden = (step === 5);
  document.querySelector('[data-action="generate"]').hidden = (step !== 5);

  state.step = step;

  // Step-specific init
  if (step === 2) loadContentList();
  if (step === 5) loadCredentialStatuses();
}

document.querySelector('[data-action="next"]').addEventListener('click', () => {
  if (state.step === 4 && state.auth.mode === 'firebase') {
    if (!validateFirebaseConfig()) return;
  }
  goToStep(state.step + 1);
});

document.querySelector('[data-action="prev"]').addEventListener('click', () => {
  goToStep(state.step - 1);
});

document.querySelector('[data-action="cancel"]').addEventListener('click', () => {
  if (confirm('Discard wizard state and close?')) {
    window.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Engines
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('[data-engine]').forEach(cb => {
  cb.addEventListener('change', () => {
    state.engines[cb.dataset.engine] = cb.checked;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Content
// ─────────────────────────────────────────────────────────────────────────────

async function loadContentList() {
  const listEl = document.getElementById('content-list');
  listEl.innerHTML = '<div class="loading">Loading content...</div>';

  try {
    // Call V1 command to list content from the content repo
    const items = await invoke('list_content') || [];
    if (items.length === 0) {
      listEl.innerHTML = '<p class="empty">No content found in the content repo. Use "Upload local JSON" to add files.</p>';
      return;
    }

    listEl.innerHTML = items.map(item => `
      <label class="content-item">
        <input type="checkbox" value="${item.uid}" data-content-uid="${item.uid}">
        <div class="content-item-info">
          <div class="content-item-title">${item.title}</div>
          <div class="content-item-meta">${item.type} · ${item.path}</div>
        </div>
      </label>
    `).join('');

    listEl.querySelectorAll('[data-content-uid]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.content.selected.add(cb.value);
        else state.content.selected.delete(cb.value);
        updateContentSummary();
      });
    });

    updateContentSummary();
  } catch (e) {
    listEl.innerHTML = `<p class="error">Failed to load content: ${e}</p>`;
  }
}

function updateContentSummary() {
  const count = state.content.selected.size + state.content.uploads.length;
  document.getElementById('content-count').textContent = `${count} item${count === 1 ? '' : 's'} selected`;
  // Size estimate: 1 KB per item
  document.getElementById('content-size').textContent = `~${count} KB`;
}

document.querySelector('[data-action="select-all"]').addEventListener('click', () => {
  document.querySelectorAll('[data-content-uid]').forEach(cb => {
    cb.checked = true;
    state.content.selected.add(cb.value);
  });
  updateContentSummary();
});

document.querySelector('[data-action="deselect-all"]').addEventListener('click', () => {
  document.querySelectorAll('[data-content-uid]').forEach(cb => {
    cb.checked = false;
  });
  state.content.selected.clear();
  updateContentSummary();
});

document.querySelector('[data-action="upload-local"]').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.multiple = true;
  input.onchange = async () => {
    for (const file of input.files) {
      const content = await file.text();
      state.content.uploads.push({ filename: file.name, content });
    }
    updateContentSummary();
    // Show uploaded files at the top of the list
    const listEl = document.getElementById('content-list');
    const uploadsHtml = state.content.uploads.map(u => `
      <div class="content-item uploaded">
        <input type="checkbox" checked disabled>
        <div class="content-item-info">
          <div class="content-item-title">${u.filename}</div>
          <div class="content-item-meta">Uploaded locally</div>
        </div>
      </div>
    `).join('');
    listEl.insertAdjacentHTML('afterbegin', uploadsHtml);
  };
  input.click();
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Theme
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('[data-theme]').forEach(input => {
  const eventName = (input.type === 'file') ? 'change' : 'input';
  input.addEventListener(eventName, async () => {
    const key = input.dataset.theme;
    if (input.type === 'file') {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 100 * 1024) {
        alert('File too large (max 100 KB for logo, 50 KB for favicon).');
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        state.theme[key] = { filename: file.name, dataUrl: reader.result };
      };
      reader.readAsDataURL(file);
    } else {
      state.theme[key] = input.value;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Auth
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('[name="auth-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    state.auth.mode = radio.value;
    document.getElementById('firebase-config-section').hidden = (radio.value !== 'firebase');
  });
});

document.querySelector('[data-action="validate-firebase"]').addEventListener('click', () => {
  validateFirebaseConfig();
});

function validateFirebaseConfig() {
  const text = document.getElementById('firebase-config-input').value.trim();
  const resultEl = document.getElementById('firebase-validate-result');

  if (!text) {
    resultEl.innerHTML = '<span class="error">Config is required for Firebase mode.</span>';
    return false;
  }

  let config;
  try {
    config = JSON.parse(text);
  } catch (e) {
    resultEl.innerHTML = `<span class="error">Invalid JSON: ${e.message}</span>`;
    return false;
  }

  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missing = required.filter(f => !config[f]);
  if (missing.length > 0) {
    resultEl.innerHTML = `<span class="error">Missing fields: ${missing.join(', ')}</span>`;
    return false;
  }

  state.auth.firebaseConfig = config;
  resultEl.innerHTML = '<span class="ok">✓ Config valid</span>';
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: Deploy
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('[name="deploy-target"]').forEach(radio => {
  radio.addEventListener('change', () => {
    state.deploy.target = radio.value;
    const isGithub = radio.value === 'github_pages';
    const needsSiteName = ['github_pages', 'netlify', 'vercel', 'cloudflare'].includes(radio.value);
    document.getElementById('deploy-site-name').hidden = !needsSiteName;
    document.getElementById('deploy-github-owner').hidden = !isGithub;
  });
});

async function loadCredentialStatuses() {
  for (const provider of ['github_pages', 'netlify', 'vercel', 'cloudflare']) {
    const el = document.querySelector(`.deploy-cred-status[data-provider="${provider}"]`);
    if (!el) continue;
    try {
      const info = await invoke('keyring_get', { provider });
      if (info.configured) {
        el.innerHTML = `<span class="ok">✓ Configured (${info.preview})</span>`;
      } else {
        el.innerHTML = `<span class="warn">Not configured — <a href="#" data-action="configure-cred" data-provider="${provider}">Configure</a></span>`;
      }
    } catch (e) {
      el.innerHTML = `<span class="error">Error: ${e}</span>`;
    }
  }

  // Wire up "Configure" links
  document.querySelectorAll('[data-action="configure-cred"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openCredModal(link.dataset.provider);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential modal
// ─────────────────────────────────────────────────────────────────────────────

function openCredModal(provider) {
  const modal = document.getElementById('cred-modal');
  const title = document.getElementById('cred-modal-title');
  const fields = document.getElementById('cred-modal-fields');

  title.textContent = `Configure ${provider} credentials`;

  const fieldsHtml = {
    github_pages: `
      <label>GitHub token<input type="password" id="cred-github-token" placeholder="ghp_..."></label>
      <p class="hint">Reuses the GitHub token from V1 sign-in. Usually no separate credential needed.</p>
    `,
    netlify: `
      <label>Netlify access token<input type="password" id="cred-netlify-token" placeholder="nfp_..."></label>
      <p class="hint">Get a token at <a href="https://app.netlify.com/user/applications" target="_blank">app.netlify.com/user/applications</a></p>
    `,
    vercel: `
      <label>Vercel access token<input type="password" id="cred-vercel-token" placeholder="..."></label>
      <p class="hint">Get a token at <a href="https://vercel.com/account/tokens" target="_blank">vercel.com/account/tokens</a></p>
    `,
    cloudflare: `
      <label>Cloudflare API token<input type="password" id="cred-cf-token" placeholder="..."></label>
      <label>Cloudflare account ID<input type="text" id="cred-cf-account" placeholder="..."></label>
      <p class="hint">Get a token at <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank">dash.cloudflare.com/profile/api-tokens</a> (use the "Cloudflare Pages" template)</p>
    `,
  };

  fields.innerHTML = fieldsHtml[provider] || '';
  modal.dataset.provider = provider;
  modal.hidden = false;
}

document.querySelector('[data-action="cred-cancel"]').addEventListener('click', () => {
  document.getElementById('cred-modal').hidden = true;
});

document.querySelector('[data-action="cred-save"]').addEventListener('click', async () => {
  const modal = document.getElementById('cred-modal');
  const provider = modal.dataset.provider;

  let credentials;
  switch (provider) {
    case 'github_pages':
      credentials = { type: 'github', token: document.getElementById('cred-github-token').value };
      break;
    case 'netlify':
      credentials = { type: 'netlify', access_token: document.getElementById('cred-netlify-token').value };
      break;
    case 'vercel':
      credentials = { type: 'vercel', access_token: document.getElementById('cred-vercel-token').value };
      break;
    case 'cloudflare':
      credentials = {
        type: 'cloudflare',
        api_token: document.getElementById('cred-cf-token').value,
        account_id: document.getElementById('cred-cf-account').value,
      };
      break;
  }

  try {
    await invoke('keyring_set', { provider, credentials });
    modal.hidden = true;
    loadCredentialStatuses();
  } catch (e) {
    alert(`Failed to save credentials: ${e}`);
  }
});

document.querySelector('[data-action="cred-test"]').addEventListener('click', async () => {
  // First save, then test
  document.querySelector('[data-action="cred-save"]').click();
  const provider = document.getElementById('cred-modal').dataset.provider;
  try {
    const valid = await invoke('keyring_test', { provider });
    if (valid) {
      alert('✓ Credentials valid.');
    } else {
      alert('✗ Credentials rejected by provider (401/403).');
    }
  } catch (e) {
    alert(`Test failed: ${e}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Generate bundle
// ─────────────────────────────────────────────────────────────────────────────

document.querySelector('[data-action="generate"]').addEventListener('click', async () => {
  const progress = document.getElementById('generate-progress');
  const status = document.getElementById('generate-status');
  const fill = document.getElementById('generate-progress-fill');
  const result = document.getElementById('generate-result');

  progress.hidden = false;
  result.hidden = true;
  status.textContent = 'Assembling bundle...';
  fill.style.width = '30%';

  try {
    // Build the wizard spec (mirrors src/lib/generator.js's buildBundleSpec)
    const spec = buildSpec();

    // Pick output path
    const outputPath = `/tmp/osler-bundle-${Date.now()}.zip`;

    fill.style.width = '60%';
    status.textContent = 'Bundling engines + content...';

    // Call Tauri command to assemble the bundle
    state.bundleResult = await invoke('generator_assemble_bundle', {
      spec,
      outputPath,
    });

    fill.style.width = '100%';
    status.textContent = 'Bundle ready';
    result.hidden = false;

    document.getElementById('result-size').textContent = formatBytes(state.bundleResult.size_bytes);
    document.getElementById('result-files').textContent = state.bundleResult.file_count;
    document.getElementById('result-hash').textContent = state.bundleResult.bundle_hash.slice(0, 16) + '...';
    document.getElementById('result-signed').textContent = state.bundleResult.signed ? '✓ Yes' : '✗ No (signing key not configured)';
  } catch (e) {
    status.textContent = `Failed: ${e}`;
    fill.style.width = '0%';
  }
});

function buildSpec() {
  const engines = ['hub', 'search', 'ai-assistant'];
  for (const [name, enabled] of Object.entries(state.engines)) {
    if (enabled) engines.push(name);
  }

  return {
    version: '2.0.0',
    generatedAt: new Date().toISOString(),
    engines,
    content: {
      selected: [...state.content.selected],
      uploads: state.content.uploads,
    },
    theme: state.theme,
    auth: state.auth,
    deploy: state.deploy,
    providerConfigs: {}, // Rust side generates these from the deploy target
    siteConfig: {
      version: '2.0.0',
      appName: state.theme.appName,
      tagline: state.theme.tagline,
      theme: {
        primary: state.theme.primary,
        accent: state.theme.accent,
        background: state.theme.background,
        fontFamily: state.theme.fontFamily,
      },
      firebase: state.auth.mode === 'firebase' ? state.auth.firebaseConfig : null,
      engines,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-generate actions
// ─────────────────────────────────────────────────────────────────────────────

document.querySelector('[data-action="preview"]').addEventListener('click', async () => {
  if (!state.bundleResult) return;
  try {
    const info = await invoke('generator_start_preview', {
      bundlePath: state.bundleResult.bundle_path,
      port: 5500,
    });
    alert(`Preview running at ${info.url}`);
  } catch (e) {
    alert(`Preview failed: ${e}`);
  }
});

document.querySelector('[data-action="save-zip"]').addEventListener('click', async () => {
  if (!state.bundleResult) return;
  // The bundle is already a zip at bundle_path. We just need to copy it to
  // a user-chosen location. Tauri's dialog plugin handles this.
  try {
    const { save } = window.__TAURI__.dialog;
    const dest = await save({
      defaultPath: `osler-site-${Date.now()}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (dest) {
      // Copy the bundle to the chosen location
      const { readBinaryFile, writeBinaryFile } = window.__TAURI__.fs;
      const bytes = await readBinaryFile(state.bundleResult.bundle_path);
      await writeBinaryFile(dest, bytes);
      alert(`Saved to ${dest}`);
    }
  } catch (e) {
    alert(`Save failed: ${e}`);
  }
});

document.querySelector('[data-action="deploy-now"]').addEventListener('click', async () => {
  if (!state.bundleResult) return;
  if (state.deploy.target === 'preview_only') {
    alert('Pick a deploy target first (Step 5).');
    return;
  }

  const siteName = document.getElementById('deploy-site-name-input')?.value || null;
  const owner = document.getElementById('deploy-github-owner-input')?.value || null;

  try {
    const result = await invoke('deploy_v2', {
      bundlePath: state.bundleResult.bundle_path,
      provider: state.deploy.target,
      siteName,
      owner,
    });
    alert(`✓ Deployed to ${result.url}`);
  } catch (e) {
    alert(`Deploy failed: ${e}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

goToStep(1);
