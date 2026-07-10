// i18n.js — English + Arabic UI translations for Osler Admin.
//
// Mirrors the dictionary pattern from src/lib/osler/i18n.ts. Keys are flat
// dotted strings; missing keys fall back to English. The pre-hydration script
// in index.html applies <html lang/dir> before paint, so users who picked
// Arabic don't see an LTR flash.

(function () {
  "use strict";

  const STRINGS = {
    en: {
      "app.name": "Osler Admin",
      "app.tagline": "Project Dashboard",

      "nav.dashboard": "Dashboard",
      "nav.content": "Content",
      "nav.manifest": "Manifest",
      "nav.build": "Build & Run",
      "nav.git": "Git",
      "nav.settings": "Settings",

      "project.notPicked": "Pick project root…",
      "project.picked": "Project root",
      "project.pick": "Pick project root",
      "project.pickHelp":
        "Select the Osler project folder. The admin dashboard will operate on its public/osler-content/ directory, manifests, builds, and git remote.",
      "project.state.connected": "Connected to project root",
      "project.state.noContent": "No public/osler-content/ folder found",
      "project.state.noPackage": "No package.json found",
      "project.state.noGit": "No git remote configured",
      "project.change": "Change project root",

      "common.save": "Save",
      "common.saved": "Saved",
      "common.cancel": "Cancel",
      "common.delete": "Delete",
      "common.create": "Create",
      "common.rename": "Rename",
      "common.move": "Move",
      "common.newFile": "New file",
      "common.newFolder": "New folder",
      "common.refresh": "Refresh",
      "common.loading": "Loading…",
      "common.empty": "Nothing here yet",
      "common.confirm": "Confirm",
      "common.yes": "Yes",
      "common.no": "No",
      "common.close": "Close",
      "common.start": "Start",
      "common.stop": "Stop",
      "common.clear": "Clear",
      "common.copy": "Copy",
      "common.copied": "Copied",

      "dashboard.title": "Dashboard",
      "dashboard.subtitle": "Overview of your Osler project — content, builds, and git.",
      "dashboard.stat.packs": "Content packs",
      "dashboard.stat.files": "Files",
      "dashboard.stat.branch": "Git branch",
      "dashboard.stat.remote": "Git remote",
      "dashboard.quickActions": "Quick actions",
      "dashboard.qa.generateManifest": "Regenerate manifests",
      "dashboard.qa.generateManifestDesc": "Scan public/osler-content/ and rebuild every manifest.json",
      "dashboard.qa.runBuild": "Run build",
      "dashboard.qa.runBuildDesc": "Run npm/bun build and stream logs",
      "dashboard.qa.gitPush": "Commit & push",
      "dashboard.qa.gitPushDesc": "Stage content + commit + push to origin",
      "dashboard.qa.openContent": "Open content editor",
      "dashboard.qa.openContentDesc": "Edit files under public/osler-content/",
      "dashboard.recentFiles": "Recently edited",
      "dashboard.noProject": "No project picked",
      "dashboard.noProjectDesc": "Pick a project root to see overview stats.",

      "content.title": "Content",
      "content.subtitle": "Edit files under public/osler-content/. Changes save instantly to disk.",
      "content.tree.empty": "No content yet. Create a folder or file to get started.",
      "content.file.empty": "Select a file from the tree to edit it.",
      "content.file.modified": "Modified",
      "content.file.saving": "Saving…",
      "content.file.saved": "Saved",
      "content.file.dirty": "Unsaved changes",
      "content.file.lang": "Language",
      "content.file.lang.en": "English",
      "content.file.lang.ar": "Arabic",
      "content.file.detectType": "Detected type",
      "content.file.validate": "Validate",
      "content.file.valid": "✓ Valid",
      "content.file.invalid": "{n} error(s)",
      "content.file.confirmDelete": "Delete {name}? This cannot be undone.",

      "manifest.title": "Manifest",
      "manifest.subtitle":
        "Inspect and regenerate manifest.json for each content category. The Osler web app reads these to discover packs.",
      "manifest.regenerate": "Regenerate all manifests",
      "manifest.regenerateDone": "Regenerated {n} manifest(s)",
      "manifest.category": "Category",
      "manifest.type": "Type",
      "manifest.leaves": "Leaf items",
      "manifest.view": "View JSON",
      "manifest.edit": "Edit JSON",
      "manifest.save": "Save manifest",
      "manifest.empty": "No manifests yet. Click Regenerate to build them.",

      "build.title": "Build & Run",
      "build.subtitle":
        "Run npm/bun build and start commands. Logs stream live from the project root.",
      "build.tab.build": "Build",
      "build.tab.start": "Start",
      "build.runBuild": "Run build",
      "build.runStart": "Run start",
      "build.stop": "Stop",
      "build.clear": "Clear logs",
      "build.status.idle": "Idle",
      "build.status.running": "Running",
      "build.status.done": "Done (exit {code})",
      "build.status.stopped": "Stopped",
      "build.status.failed": "Failed (exit {code})",
      "build.empty": "No logs yet. Click Run build or Run start.",
      "build.note": "Build uses bun if available, otherwise npm.",

      "git.title": "Git",
      "git.subtitle": "Stage, commit, push, and pull content changes against the project's git remote.",
      "git.status": "Working tree",
      "git.status.clean": "Working tree is clean",
      "git.status.dirty": "{n} file(s) changed",
      "git.refresh": "Refresh status",
      "git.stageAll": "Stage all",
      "git.stageSelected": "Stage selected",
      "git.commit": "Commit",
      "git.commitPlaceholder": "Commit message",
      "git.commitDefault": "Content update via Osler Admin",
      "git.push": "Push",
      "git.pull": "Pull",
      "git.remote": "Remote",
      "git.branch": "Branch",
      "git.empty": "No changes in the working tree.",
      "git.commitDone": "Committed: {message}",
      "git.pushDone": "Pushed to origin",
      "git.pullDone": "Pulled from origin",

      "settings.title": "Settings",
      "settings.subtitle": "Configure UI language, theme, and project root.",
      "settings.section.language": "Language",
      "settings.section.theme": "Theme",
      "settings.section.project": "Project",
      "settings.language.uiLang": "Interface language",
      "settings.language.uiLangDesc": "Choose the language used for navigation, buttons, and headings.",
      "settings.language.enName": "English",
      "settings.language.arName": "العربية",
      "settings.language.rtlNote":
        "Arabic UI uses a right-to-left layout. Content packs in Arabic render RTL regardless of UI language.",
      "settings.theme.dark": "Dark",
      "settings.theme.light": "Light",
      "settings.project.root": "Project root",
      "settings.project.change": "Change project root",
      "settings.project.gitRemote": "Git remote",
      "settings.project.gitBranch": "Git branch",

      "toast.saved": "Saved",
      "toast.deleted": "Deleted",
      "toast.created": "Created",
      "toast.renamed": "Renamed",
      "toast.moved": "Moved",
      "toast.error": "Error: {msg}",
      "toast.started": "Started",
      "toast.stopped": "Stopped",
      "toast.notPicked": "Pick a project root first",
    },

    ar: {
      "app.name": "أوسلر أدمن",
      "app.tagline": "لوحة المشروع",

      "nav.dashboard": "اللوحة الرئيسية",
      "nav.content": "المحتوى",
      "nav.manifest": "المانيفست",
      "nav.build": "البناء والتشغيل",
      "nav.git": "Git",
      "nav.settings": "الإعدادات",

      "project.notPicked": "اختر جذر المشروع…",
      "project.picked": "جذر المشروع",
      "project.pick": "اختر جذر المشروع",
      "project.pickHelp":
        "اختر مجلد مشروع أوسلر. ستعمل لوحة الإدارة على مجلد public/osler-content/ والمانيفستات والبناءات ومستودع git الخاص به.",
      "project.state.connected": "متصل بجذر المشروع",
      "project.state.noContent": "لم يُعثر على مجلد public/osler-content/",
      "project.state.noPackage": "لم يُعثر على package.json",
      "project.state.noGit": "لم يُضبط مستودع git بعيد",
      "project.change": "تغيير جذر المشروع",

      "common.save": "حفظ",
      "common.saved": "تم الحفظ",
      "common.cancel": "إلغاء",
      "common.delete": "حذف",
      "common.create": "إنشاء",
      "common.rename": "إعادة تسمية",
      "common.move": "نقل",
      "common.newFile": "ملف جديد",
      "common.newFolder": "مجلد جديد",
      "common.refresh": "تحديث",
      "common.loading": "جارٍ التحميل…",
      "common.empty": "لا شيء هنا بعد",
      "common.confirm": "تأكيد",
      "common.yes": "نعم",
      "common.no": "لا",
      "common.close": "إغلاق",
      "common.start": "ابدأ",
      "common.stop": "إيقاف",
      "common.clear": "مسح",
      "common.copy": "نسخ",
      "common.copied": "تم النسخ",

      "dashboard.title": "اللوحة الرئيسية",
      "dashboard.subtitle": "نظرة عامة على مشروع أوسلر — المحتوى والبناءات وgit.",
      "dashboard.stat.packs": "حزم المحتوى",
      "dashboard.stat.files": "الملفات",
      "dashboard.stat.branch": "فرع Git",
      "dashboard.stat.remote": "مستودع Git البعيد",
      "dashboard.quickActions": "إجراءات سريعة",
      "dashboard.qa.generateManifest": "إعادة توليد المانيفستات",
      "dashboard.qa.generateManifestDesc": "امسح public/osler-content/ وأعد بناء كل manifest.json",
      "dashboard.qa.runBuild": "تشغيل البناء",
      "dashboard.qa.runBuildDesc": "شغّل npm/bun build واعرض السجلات مباشرة",
      "dashboard.qa.gitPush": "التزام ودفع",
      "dashboard.qa.gitPushDesc": "أضف المحتوى + التزم + ادفع إلى الأصل",
      "dashboard.qa.openContent": "افتح محرر المحتوى",
      "dashboard.qa.openContentDesc": "حرّر الملفات تحت public/osler-content/",
      "dashboard.recentFiles": "المعدّلة حديثًا",
      "dashboard.noProject": "لم يُختر مشروع",
      "dashboard.noProjectDesc": "اختر جذر مشروع لرؤية الإحصاءات.",

      "content.title": "المحتوى",
      "content.subtitle": "حرّر الملفات تحت public/osler-content/. تُحفظ التغييرات فورًا على القرص.",
      "content.tree.empty": "لا محتوى بعد. أنشئ مجلدًا أو ملفًا للبدء.",
      "content.file.empty": "اختر ملفًا من الشجرة لتحريره.",
      "content.file.modified": "معدّل",
      "content.file.saving": "جارٍ الحفظ…",
      "content.file.saved": "تم الحفظ",
      "content.file.dirty": "تغييرات غير محفوظة",
      "content.file.lang": "اللغة",
      "content.file.lang.en": "الإنجليزية",
      "content.file.lang.ar": "العربية",
      "content.file.detectType": "النوع المكتشف",
      "content.file.validate": "تحقق",
      "content.file.valid": "✓ صالح",
      "content.file.invalid": "{n} خطأ",
      "content.file.confirmDelete": "حذف {name}؟ لا يمكن التراجع عن هذا.",

      "manifest.title": "المانيفست",
      "manifest.subtitle":
        "افحص وأعد توليد manifest.json لكل فئة محتوى. يقرأها تطبيق أوسلر لاكتشاف الحزم.",
      "manifest.regenerate": "إعادة توليد كل المانيفستات",
      "manifest.regenerateDone": "أُعيد توليد {n} مانيفست",
      "manifest.category": "الفئة",
      "manifest.type": "النوع",
      "manifest.leaves": "عناصر طرفية",
      "manifest.view": "عرض JSON",
      "manifest.edit": "تحرير JSON",
      "manifest.save": "حفظ المانيفست",
      "manifest.empty": "لا مانيفستات بعد. انقر على إعادة التوليد لإنشائها.",

      "build.title": "البناء والتشغيل",
      "build.subtitle":
        "شغّل أوامر npm/bun build و start. تتدفق السجلات مباشرة من جذر المشروع.",
      "build.tab.build": "بناء",
      "build.tab.start": "تشغيل",
      "build.runBuild": "تشغيل البناء",
      "build.runStart": "تشغيل التشغيل",
      "build.stop": "إيقاف",
      "build.clear": "مسح السجلات",
      "build.status.idle": "خامل",
      "build.status.running": "قيد التشغيل",
      "build.status.done": "تم (خروج {code})",
      "build.status.stopped": "موقوف",
      "build.status.failed": "فشل (خروج {code})",
      "build.empty": "لا سجلات بعد. انقر على تشغيل البناء أو تشغيل التشغيل.",
      "build.note": "يستخدم البناء bun إذا كان متاحًا، وإلا npm.",

      "git.title": "Git",
      "git.subtitle": "أضف، التزم، ادفع، واسحب تغييرات المحتوى مقابل مستودع git البعيد للمشروع.",
      "git.status": "شجرة العمل",
      "git.status.clean": "شجرة العمل نظيفة",
      "git.status.dirty": "{n} ملف تغيّر",
      "git.refresh": "تحديث الحالة",
      "git.stageAll": "أضف الكل",
      "git.stageSelected": "أضف المحدد",
      "git.commit": "التزام",
      "git.commitPlaceholder": "رسالة الالتزام",
      "git.commitDefault": "تحديث محتوى عبر أوسلر أدمن",
      "git.push": "دفع",
      "git.pull": "سحب",
      "git.remote": "المستودع البعيد",
      "git.branch": "الفرع",
      "git.empty": "لا تغييرات في شجرة العمل.",
      "git.commitDone": "تم الالتزام: {message}",
      "git.pushDone": "تم الدفع إلى الأصل",
      "git.pullDone": "تم السحب من الأصل",

      "settings.title": "الإعدادات",
      "settings.subtitle": "اضبط لغة الواجهة والسمة وجذر المشروع.",
      "settings.section.language": "اللغة",
      "settings.section.theme": "السمة",
      "settings.section.project": "المشروع",
      "settings.language.uiLang": "لغة الواجهة",
      "settings.language.uiLangDesc": "اختر اللغة المستخدمة في التنقل والأزرار والعناوين.",
      "settings.language.enName": "English",
      "settings.language.arName": "العربية",
      "settings.language.rtlNote":
        "تستخدم الواجهة العربية تخطيطًا من اليمين إلى اليسار. تُعرض الحزم العربية باتجاه RTL بصرف النظر عن لغة الواجهة.",
      "settings.theme.dark": "داكنة",
      "settings.theme.light": "فاتحة",
      "settings.project.root": "جذر المشروع",
      "settings.project.change": "تغيير جذر المشروع",
      "settings.project.gitRemote": "المستودع البعيد",
      "settings.project.gitBranch": "الفرع",

      "toast.saved": "تم الحفظ",
      "toast.deleted": "تم الحذف",
      "toast.created": "تم الإنشاء",
      "toast.renamed": "تمت إعادة التسمية",
      "toast.moved": "تم النقل",
      "toast.error": "خطأ: {msg}",
      "toast.started": "تم البدء",
      "toast.stopped": "تم الإيقاف",
      "toast.notPicked": "اختر جذر مشروع أولًا",
    },
  };

  const STORAGE_KEY = "osler-admin-lang";
  const DEFAULT_LANG = "en";

  function loadLang() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === "ar" || v === "en" ? v : DEFAULT_LANG;
    } catch {
      return DEFAULT_LANG;
    }
  }

  function saveLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
  }

  function applyLangToHtml(lang) {
    const dir = lang === "ar" ? "rtl" : "ltr";
    const html = document.documentElement;
    html.setAttribute("lang", lang);
    html.setAttribute("dir", dir);
    if (lang === "ar") html.classList.add("osler-ar");
    else html.classList.remove("osler-ar");
  }

  function translate(lang, key, params) {
    const table = STRINGS[lang] || {};
    const fallback = STRINGS[DEFAULT_LANG] || {};
    let value = table[key] ?? fallback[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp("\\{" + k + "\\}", "g"), String(v));
      }
    }
    return value;
  }

  const i18n = {
    lang: DEFAULT_LANG,
    dir: "ltr",
    rtl: false,

    init() {
      this.lang = loadLang();
      this.dir = this.lang === "ar" ? "rtl" : "ltr";
      this.rtl = this.dir === "rtl";
      applyLangToHtml(this.lang);
      this.applyToDom();
      this.updateToggleLabel();
    },

    setLang(lang) {
      this.lang = lang;
      this.dir = lang === "ar" ? "rtl" : "ltr";
      this.rtl = this.dir === "rtl";
      saveLang(lang);
      applyLangToHtml(lang);
      this.applyToDom();
      this.updateToggleLabel();
      // Re-render the current view so list-valued strings refresh too.
      if (window.OslerAdmin && OslerAdmin.currentRoute) {
        OslerAdmin.navigate(OslerAdmin.currentRoute);
      }
    },

    toggleLang() {
      this.setLang(this.lang === "ar" ? "en" : "ar");
    },

    t(key, params) {
      return translate(this.lang, key, params);
    },

    /** Walk all [data-i18n] elements and set their textContent. */
    applyToDom() {
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        el.textContent = this.t(key);
      });
    },

    updateToggleLabel() {
      const label = document.getElementById("lang-toggle-label");
      if (label) label.textContent = this.lang === "ar" ? "EN" : "ع";
    },
  };

  window.OslerAdminI18n = i18n;
})();
