// views/cloud-services.js — Guided lifecycle maintenance for an existing Cloudflare instance.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, t } = helpers;

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.cloudServices = async function (view) {
    const wrap = el("div", { class: "view osler-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("services.title")),
        el("p", { class: "subtitle" }, t("services.subtitle"))
      )
    ));
    if (!requireProject()) {
      view.appendChild(wrap);
      return;
    }

    let config;
    try {
      config = await invoke("read_config");
    } catch (error) {
      wrap.appendChild(el("div", { class: "card", style: { padding: "1.25rem" } }, t("services.noConfig")));
      view.appendChild(wrap);
      return;
    }

    const cloud = config.cloud || {};
    const resources = cloud.resources || {};
    const site = config.site || {};
    const workerUrl = cloud.apiUrl || "";
    const defaultOrigin = site.url || "";
    const defaultD1 = resources.d1Name || "osler-cloud";

    function card(title, description) {
      const node = el("section", { class: "card", style: { padding: "1.25rem", marginBottom: "1rem" } });
      node.append(
        el("h2", { style: { fontSize: "1rem", margin: "0 0 0.35rem" } }, title),
        el("p", { style: { color: "var(--text-muted)", fontSize: "0.8125rem", margin: "0 0 1rem", lineHeight: 1.5 } }, description)
      );
      return node;
    }

    function field(label, value, placeholder, type = "text") {
      const input = el("input", { type, class: "input", value, placeholder, style: { width: "100%" } });
      const node = el("label", { style: { display: "block", marginBottom: "0.75rem" } },
        el("span", { class: "label", style: { display: "block", marginBottom: "0.35rem" } }, label),
        input
      );
      return { node, input };
    }

    const healthCard = card(t("services.health.title"), t("services.health.desc"));
    const healthUrl = field(t("services.health.workerUrl"), workerUrl, "https://your-worker.workers.dev");
    const healthOut = el("div", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", minHeight: "1.25rem" } });
    const healthBtn = el("button", { class: "btn btn-primary" }, t("services.health.check"));
    healthBtn.addEventListener("click", async () => {
      if (!healthUrl.input.value.trim()) {
        toast(t("services.health.missing"), "error");
        return;
      }
      healthBtn.disabled = true;
      healthOut.textContent = t("common.loading");
      try {
        const result = await invoke("setup_check_health", { workerUrl: healthUrl.input.value.trim() });
        healthOut.textContent = result.ok ? t("services.health.ok") : t("services.health.failed", { status: result.status });
        healthOut.style.color = result.ok ? "var(--success)" : "var(--danger)";
      } catch (error) {
        healthOut.textContent = t("toast.error", { msg: String(error) });
        healthOut.style.color = "var(--danger)";
      } finally {
        healthBtn.disabled = false;
      }
    });
    healthCard.append(healthUrl.node, healthBtn, healthOut);
    wrap.appendChild(healthCard);

    const googleCard = card(t("services.google.title"), t("services.google.desc"));
    const googleId = field(t("instance.google.clientId"), "", "1234567890-abc.apps.googleusercontent.com");
    const googleSecret = field(t("instance.google.clientSecret"), "", "GOCSPX-…", "password");
    const callback = workerUrl ? `${workerUrl.replace(/\/$/, "")}/v1/auth/google/callback` : t("services.google.callbackPending");
    const callbackNode = el("code", { style: { display: "block", padding: "0.625rem", background: "var(--surface-2)", borderRadius: "var(--radius-sm)", marginBottom: "0.75rem", fontSize: "0.75rem", wordBreak: "break-all" } }, callback);
    const googleBtn = el("button", { class: "btn btn-primary" }, t("services.google.save"));
    googleBtn.addEventListener("click", async () => {
      if (!googleId.input.value.trim() || !googleSecret.input.value.trim()) {
        toast(t("instance.google.missing"), "error");
        return;
      }
      googleBtn.disabled = true;
      try {
        await invoke("setup_write_secrets", {
          secrets: [
            { name: "GOOGLE_CLIENT_ID", value: googleId.input.value.trim() },
            { name: "GOOGLE_CLIENT_SECRET", value: googleSecret.input.value.trim() },
          ],
        });
        toast(t("services.google.saved"), "success");
        googleSecret.input.value = "";
      } catch (error) {
        toast(t("toast.error", { msg: String(error) }), "error");
      } finally {
        googleBtn.disabled = false;
      }
    });
    googleCard.append(googleId.node, googleSecret.node, el("div", { class: "label", style: { marginBottom: "0.35rem" } }, t("services.google.callback")), callbackNode, googleBtn);
    wrap.appendChild(googleCard);

    const databaseCard = card(t("services.database.title"), t("services.database.desc"));
    const d1Name = field(t("services.database.name"), defaultD1, defaultD1);
    const migrateBtn = el("button", { class: "btn" }, t("services.database.migrate"));
    migrateBtn.addEventListener("click", async () => {
      migrateBtn.disabled = true;
      try {
        await invoke("setup_apply_d1_migrations", { d1Name: d1Name.input.value.trim() });
        toast(t("services.database.migrated"), "success");
      } catch (error) {
        toast(t("toast.error", { msg: String(error) }), "error");
      } finally {
        migrateBtn.disabled = false;
      }
    });
    databaseCard.append(d1Name.node, migrateBtn);
    wrap.appendChild(databaseCard);

    const emailCard = card(t("services.email.title"), t("services.email.desc"));
    const gmailUser = field(t("instance.email.gmailAddress"), "", "you@gmail.com");
    const gmailPassword = field(t("instance.email.appPassword"), "", "abcd efgh ijkl mnop", "password");
    const fromName = field(t("instance.email.fromName"), site.name || "", t("instance.email.fromNamePh"));
    const appOrigin = field(t("services.email.origin"), defaultOrigin, "https://your-app.pages.dev");
    const bindingWrap = el("label", { style: { display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.8125rem", color: "var(--text-muted)", cursor: "pointer" } });
    const bindingCheck = el("input", { type: "checkbox" });
    bindingWrap.append(bindingCheck, el("span", {}, t("services.email.binding")));
    const emailBtn = el("button", { class: "btn btn-primary" }, t("services.email.deploy"));
    emailBtn.addEventListener("click", async () => {
      if (!gmailUser.input.value.trim() || !gmailPassword.input.value.trim() || !appOrigin.input.value.trim()) {
        toast(t("services.email.missing"), "error");
        return;
      }
      emailBtn.disabled = true;
      try {
        const result = await invoke("deploy_email_worker", {
          setup: {
            gmailUser: gmailUser.input.value.trim(),
            gmailAppPassword: gmailPassword.input.value.trim(),
            fromName: fromName.input.value.trim() || null,
            appOrigin: appOrigin.input.value.trim(),
            d1Name: d1Name.input.value.trim() || defaultD1,
            useServiceBinding: bindingCheck.checked,
          },
        });
        toast(t("services.email.deployed", { url: result.url }), "success");
        gmailPassword.input.value = "";
      } catch (error) {
        toast(t("toast.error", { msg: String(error) }), "error");
      } finally {
        emailBtn.disabled = false;
      }
    });
    emailCard.append(gmailUser.node, gmailPassword.node, fromName.node, appOrigin.node, bindingWrap, emailBtn);
    wrap.appendChild(emailCard);

    view.appendChild(wrap);
  };
})();
