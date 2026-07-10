/**
 * Osler i18n — UI translation + RTL helpers.
 *
 * Two UI languages are supported: English (`en`, LTR) and Arabic (`ar`, RTL).
 *
 * Design choices:
 *  - The UI language and the *content* language are decoupled. A user can
 *    pick Arabic UI to navigate the chrome in Arabic while still reading
 *    English articles and quizzes; conversely an English UI user can open
 *    an Arabic content pack and the article/quiz will render RTL inside an
 *    English shell.
 *  - Each content pack (quiz / article / flashcard / OSCE) declares its own
 *    `lang` on its manifest node and/or its `ContentMeta`. The renderer is
 *    responsible for wrapping the content body in a `dir`/`lang` container.
 *  - The dictionary is a flat key→record map so missing keys fall back to
 *    English without crashing.
 */

export type UiLang = "en" | "ar";

export interface LangMeta {
  code: UiLang;
  /** English name of the language (used as a stable label in selectors). */
  name: string;
  /** Endonym — how the language writes its own name. */
  nativeName: string;
  dir: "ltr" | "rtl";
  /** BCP-47 tag for <html lang=...> */
  bcp47: string;
}

export const LANGUAGES: Record<UiLang, LangMeta> = {
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    dir: "ltr",
    bcp47: "en",
  },
  ar: {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    dir: "rtl",
    bcp47: "ar",
  },
};

export const UI_LANGS: UiLang[] = ["en", "ar"];

export const DEFAULT_UI_LANG: UiLang = "en";

export const UI_LANG_STORAGE_KEY = "osler-ui-lang";

/** Content language filter — `auto` means "show content in any language". */
export type ContentLangFilter = "all" | "en" | "ar";
export const CONTENT_LANG_STORAGE_KEY = "osler-content-lang-filter";
export const DEFAULT_CONTENT_LANG_FILTER: ContentLangFilter = "all";

/* ─────────────────────────── Dictionary ──────────────────────────────── */

/**
 * String keys are namespaced by component, e.g. `nav.dashboard`.
 * Add new keys here for both `en` and `ar`.
 */
export const STRINGS = {
  en: {
    "app.name": "Osler",
    "app.tagline": "Medical Study Platform",

    "common.search": "Search",
    "common.searchPlaceholder": "Search articles, conditions, drugs…",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.saveChanges": "Save changes",
    "common.saved": "Saved",
    "common.discard": "Discard",
    "common.reset": "Reset",
    "common.continue": "Continue",
    "common.resume": "Resume",
    "common.back": "Back",
    "common.next": "Next",
    "common.previous": "Previous",
    "common.close": "Close",
    "common.confirm": "Confirm",
    "common.loading": "Loading…",
    "common.none": "None",
    "common.all": "All",
    "common.viewAll": "View all",

    "nav.dashboard": "Dashboard",
    "nav.qbank": "Q-Bank Studio",
    "nav.library": "Library",
    "nav.flashcards": "Flashcards",
    "nav.osce": "OSCE Studio",
    "nav.profile": "Profile",
    "nav.settings": "Settings",
    "nav.signOut": "Sign out",
    "nav.localSession": "Local session",

    "theme.toggleToLight": "Switch to light",
    "theme.toggleToDark": "Switch to dark",

    "login.title": "Welcome to Osler",
    "login.subtitle": "Medical study platform — quizzes, banks, flashcards, OSCE",
    "login.username": "Username",
    "login.password": "Password",
    "login.usernamePlaceholder": "Your name",
    "login.passwordPlaceholder": "Any value (demo mode)",
    "login.demoNote": "Demo mode — no real authentication. All progress is stored locally.",
    "login.signIn": "Sign In",
    "login.guest": "Continue as Guest",
    "login.footer": "Osler v1",

    "dash.greetingMorning": "Good morning",
    "dash.greetingAfternoon": "Good afternoon",
    "dash.greetingEvening": "Good evening",
    "dash.welcomeBack": "Welcome back, {name}",
    "dash.intro":
      "Continue where you left off, browse the article library, or build a new test in Q-Bank Studio across quizzes, banks, flashcards, written prompts, and OSCE stations.",
    "dash.continueLearning": "Continue learning",
    "dash.attempted": "{n} attempted",
    "dash.correct": "{n} correct",
    "dash.packsStarted": "Packs Started",
    "dash.attemptedLabel": "Attempted",
    "dash.correctLabel": "Correct",
    "dash.accuracy": "Accuracy",
    "dash.quickActions": "Quick Actions",
    "dash.qa.qbank.title": "Q-Bank Studio",
    "dash.qa.qbank.sub": "Build a test from any pack",
    "dash.qa.flashcards.title": "Flashcard Decks",
    "dash.qa.flashcards.sub": "Spaced-repetition study decks",
    "dash.qa.library.title": "Article Library",
    "dash.qa.library.sub": "{n} medical articles",
    "dash.qa.profile.title": "View Profile",
    "dash.qa.profile.sub": "See stats and achievements",
    "dash.featuredArticles": "Featured Articles",
    "dash.recentActivity": "Recent Activity",
    "dash.timeAgo.justNow": "just now",
    "dash.timeAgo.minutes": "{n}m ago",
    "dash.timeAgo.hours": "{n}h ago",
    "dash.timeAgo.days": "{n}d ago",

    "qbank.home.title": "Q-Bank Studio",
    "qbank.home.subtitle":
      "Build a study session from quizzes, banks, written prompts, OSCE stations, and flashcards.",
    "qbank.home.tabContent": "Content",
    "qbank.home.tabCreate": "Create",
    "qbank.home.tabPrevious": "Previous",
    "qbank.home.empty": "No content packs available yet.",
    "qbank.home.start": "Start",
    "qbank.home.continue": "Continue",
    "qbank.home.questions": "{n} questions",
    "qbank.home.cards": "{n} cards",
    "qbank.home.stations": "{n} stations",
    "qbank.home.prompts": "{n} prompts",
    "qbank.home.langAny": "Any language",
    "qbank.home.langEn": "English only",
    "qbank.home.langAr": "Arabic only",
    "qbank.home.filterLang": "Language",
    "qbank.home.filterType": "Type",
    "qbank.home.search": "Search packs…",

    "qbank.session.question": "Question {n} of {total}",
    "qbank.session.exit": "Exit",
    "qbank.session.flag": "Flag",
    "qbank.session.unflag": "Unflag",
    "qbank.session.submit": "Submit",
    "qbank.session.submitAll": "Submit all",
    "qbank.session.reveal": "Reveal answer",
    "qbank.session.hideAnswer": "Hide answer",
    "qbank.session.explanation": "Explanation",
    "qbank.session.correct": "Correct",
    "qbank.session.incorrect": "Incorrect",
    "qbank.session.skipped": "Skipped",
    "qbank.session.score": "Score: {n}/{total}",
    "qbank.session.accuracy": "Accuracy: {pct}%",
    "qbank.session.review": "Review",
    "qbank.session.tryAgain": "Try again",
    "qbank.session.backToHub": "Back to Q-Bank",
    "qbank.session.tutorMode": "Tutor mode",
    "qbank.session.timedMode": "Timed mode",
    "qbank.session.timeRemaining": "Time remaining",
    "qbank.session.pause": "Pause",
    "qbank.session.resume": "Resume",
    "qbank.session.strikethrough": "Eliminate",
    "qbank.session.strikeRestore": "Restore",
    "qbank.session.langBadge.ar": "Arabic",
    "qbank.session.langBadge.en": "English",

    "flash.home.title": "Flashcards",
    "flash.home.subtitle": "Spaced-repetition decks across all specialties.",
    "flash.home.empty": "No flashcard decks available.",
    "flash.home.study": "Study",
    "flash.home.cards": "{n} cards",
    "flash.home.due": "Due",
    "flash.home.new": "New",
    "flash.home.total": "Total",
    "flash.session.flip": "Flip",
    "flash.session.rateEasy": "Easy",
    "flash.session.rateHard": "Hard",
    "flash.session.rateUnknown": "Don't know",
    "flash.session.progress": "Card {n} of {total}",
    "flash.session.complete": "Deck complete!",
    "flash.session.exit": "Exit deck",
    "flash.home.subdecks": "{n} subdecks",
    "flash.home.studyAll": "Study All",
    "flash.home.allDecks": "All Decks",
    "flash.home.studyAgain": "Study Again",

    "osce.home.title": "OSCE Studio",
    "osce.home.subtitle": "Clinical skills stations with virtual patients.",
    "osce.home.empty": "No OSCE stations available.",
    "osce.home.start": "Start station",
    "osce.home.time": "{n} min",
    "osce.home.examiner": "Examiner",
    "osce.home.patient": "Patient",

    "library.title": "Library",
    "library.subtitle": "Medical articles across all specialties.",
    "library.search": "Search articles…",
    "library.empty": "No articles found.",
    "library.readTime": "{n} min read",
    "library.specialty": "Specialty",
    "library.topic": "Topic",
    "library.relatedArticles": "Related articles",
    "library.bookmarked": "Bookmarked",
    "library.all": "All",
    "library.articlesCount": "{n} articles",
    "library.oneArticle": "1 article",
    "library.noResults": "No articles match your search",
    "library.noBookmarks": "No bookmarked articles yet",

    "profile.title": "Profile",
    "profile.stats": "Statistics",
    "profile.achievements": "Achievements",
    "profile.recentSessions": "Recent sessions",
    "profile.noSessions": "No sessions yet — start one from Q-Bank Studio.",
    "profile.totalAttempted": "Total attempted",
    "profile.totalCorrect": "Total correct",
    "profile.avgAccuracy": "Average accuracy",
    "profile.packsTouched": "Packs studied",

    "settings.title": "Settings",
    "settings.subtitle":
      "Configure language, AI assistant, keyboard shortcuts, and manage data",
    "settings.section.language": "Language",
    "settings.section.ai": "AI Assistant",
    "settings.section.shortcuts": "Keyboard",
    "settings.section.danger": "Data & Reset",
    "settings.language.uiLang": "Interface language",
    "settings.language.uiLangDesc":
      "Choose the language used for navigation, buttons, and headings across Osler.",
    "settings.language.contentLang": "Content language filter",
    "settings.language.contentLangDesc":
      "Filter the content packs shown in Q-Bank, Flashcards, and Library. Content packs always render in the language they were authored in — this filter only hides/shows them.",
    "settings.language.contentLangAll": "Show all languages",
    "settings.language.contentLangEn": "English content only",
    "settings.language.contentLangAr": "Arabic content only",
    "settings.language.rtlNote":
      "Arabic UI uses a right-to-left layout. Content packs in Arabic render RTL regardless of UI language.",
    "settings.language.enName": "English",
    "settings.language.arName": "العربية",

    "settings.ai.title": "AI Assistant",
    "settings.ai.subtitle":
      "Configure the AI study assistant that helps explain questions and concepts during QBank sessions. Changes are saved when you click Save.",
    "settings.ai.apiKey": "Gemini API Key",
    "settings.ai.apiKeyPlaceholder": "Enter your Gemini API key",
    "settings.ai.unsaved": "Unsaved changes",
    "settings.ai.getKey": "Get a free key at AI Studio. The AI assistant requires a key to work.",
    "settings.ai.model": "Model",
    "settings.ai.maxWait": "Max Wait Time",
    "settings.ai.maxWait.15": "15 seconds",
    "settings.ai.maxWait.30": "30 seconds",
    "settings.ai.maxWait.60": "60 seconds",
    "settings.ai.maxWait.120": "2 minutes",
    "settings.ai.osceVoice": "OSCE Voice & Live Model",
    "settings.ai.osceVoiceDesc":
      "Configure voice settings for the OSCE Virtual Patient Simulator.",
    "settings.ai.liveModel": "Live Voice Model",
    "settings.ai.liveModelDesc":
      "Used for real-time voice conversation in OSCE (Gemini Live API).",
    "settings.ai.ttsRate": "TTS Rate",
    "settings.ai.ttsRateDesc": "Speech synthesis rate for patient responses.",
    "settings.ai.testConnection": "Test Connection",
    "settings.ai.testing": "Testing…",
    "settings.ai.clearKey": "Clear Key",

    "settings.shortcuts.title": "Keyboard Shortcuts",
    "settings.shortcuts.subtitle":
      "Click any binding to record a new key combination. Press Esc to cancel recording, Backspace to disable. Changes apply once you click Save changes.",
    "settings.shortcuts.scope.global": "Global",
    "settings.shortcuts.scope.globalDesc":
      "Available everywhere — search, navigation, theme.",
    "settings.shortcuts.scope.qbank": "QBank Studio",
    "settings.shortcuts.scope.qbankDesc":
      "Available inside a QBank session (next, prev, flag, submit, ...).",
    "settings.shortcuts.scope.flashcard": "Flashcards",
    "settings.shortcuts.scope.flashcardDesc":
      "Available during a flashcard study session (flip, rate, navigate).",
    "settings.shortcuts.scope.reader": "Article Reader",
    "settings.shortcuts.scope.readerDesc":
      "Available when reading an article or in an overlay modal.",
    "settings.shortcuts.tipsTitle": "Tips",
    "settings.shortcuts.tips": [
      "Multi-key sequences (e.g. G then D for Dashboard) are supported — record both chords back-to-back.",
      "On macOS, ⌘ is the modifier; on Windows/Linux it's Ctrl.",
      "Shortcuts are ignored while typing in text fields, except those with the Ctrl/⌘ modifier.",
      "Conflicts are detected automatically — two actions can't share the same binding.",
    ],
    "settings.shortcuts.resetAll": "Reset all to defaults",
    "settings.shortcuts.default": "Default",
    "settings.shortcuts.disabled": "Disabled",

    "settings.danger.title": "Data & Reset",
    "settings.danger.subtitle":
      "Your study data is stored locally in this browser. Clearing your browser cache may also clear this data.",
    "settings.danger.warning":
      "This action cannot be undone.",
    "settings.danger.packsWithProgress": "{n} packs with progress",
    "settings.danger.packsWithProgressSub":
      "Includes quiz, bank, flashcard, written, and OSCE answers.",
    "settings.danger.clearAll": "Clear All Progress",
    "settings.danger.confirm": "Are you sure?",
    "settings.danger.confirmYes": "Yes, clear everything",

    "engine.quiz": "Quiz",
    "engine.bank": "Question Bank",
    "engine.flashcard": "Flashcards",
    "engine.written": "Written",
    "engine.osce": "OSCE",
    "engine.library": "Library",

    "lang.ar": "Arabic",
    "lang.en": "English",
    "lang.badge.ar": "ع", // single-letter badge for Arabic content
    "lang.badge.en": "EN",
  },

  ar: {
    "app.name": "أوسلر",
    "app.tagline": "منصة الدراسة الطبية",

    "common.search": "بحث",
    "common.searchPlaceholder": "ابحث عن مقالات أو حالات أو أدوية…",
    "common.cancel": "إلغاء",
    "common.save": "حفظ",
    "common.saveChanges": "حفظ التغييرات",
    "common.saved": "تم الحفظ",
    "common.discard": "تجاهل",
    "common.reset": "إعادة تعيين",
    "common.continue": "متابعة",
    "common.resume": "استئناف",
    "common.back": "رجوع",
    "common.next": "التالي",
    "common.previous": "السابق",
    "common.close": "إغلاق",
    "common.confirm": "تأكيد",
    "common.loading": "جارٍ التحميل…",
    "common.none": "لا شيء",
    "common.all": "الكل",
    "common.viewAll": "عرض الكل",

    "nav.dashboard": "اللوحة الرئيسية",
    "nav.qbank": "استوديو بنك الأسئلة",
    "nav.library": "المكتبة",
    "nav.flashcards": "البطاقات التعليمية",
    "nav.osce": "استوديو OSCE",
    "nav.profile": "الملف الشخصي",
    "nav.settings": "الإعدادات",
    "nav.signOut": "تسجيل الخروج",
    "nav.localSession": "جلسة محلية",

    "theme.toggleToLight": "التبديل إلى الوضع الفاتح",
    "theme.toggleToDark": "التبديل إلى الوضع الداكن",

    "login.title": "مرحبًا بك في أوسلر",
    "login.subtitle": "منصة الدراسة الطبية — اختبارات، بنوك أسئلة، بطاقات، OSCE",
    "login.username": "اسم المستخدم",
    "login.password": "كلمة المرور",
    "login.usernamePlaceholder": "اسمك",
    "login.passwordPlaceholder": "أي قيمة (وضع تجريبي)",
    "login.demoNote":
      "الوضع التجريبي — لا مصادقة فعلية. تُحفظ كل التقدّم محليًا.",
    "login.signIn": "تسجيل الدخول",
    "login.guest": "المتابعة كضيف",
    "login.footer": "أوسلر الإصدار 1",

    "dash.greetingMorning": "صباح الخير",
    "dash.greetingAfternoon": "مساء الخير",
    "dash.greetingEvening": "مساء الخير",
    "dash.welcomeBack": "أهلًا بعودتك، {name}",
    "dash.intro":
      "تابع من حيث توقفت، أو تصفّح مكتبة المقالات، أو أنشئ اختبارًا جديدًا في استوديو بنك الأسئلة عبر الاختبارات والبنوك والبطاقات والأسئلة المقالية ومحطات OSCE.",
    "dash.continueLearning": "متابعة التعلّم",
    "dash.attempted": "{n} محاولة",
    "dash.correct": "{n} صحيحة",
    "dash.packsStarted": "حزم بدأت",
    "dash.attemptedLabel": "المحاولات",
    "dash.correctLabel": "الصحيحة",
    "dash.accuracy": "الدقة",
    "dash.quickActions": "إجراءات سريعة",
    "dash.qa.qbank.title": "استوديو بنك الأسئلة",
    "dash.qa.qbank.sub": "أنشئ اختبارًا من أي حزمة",
    "dash.qa.flashcards.title": "رزم البطاقات",
    "dash.qa.flashcards.sub": "رزم دراسة بالتكرار المتباعد",
    "dash.qa.library.title": "مكتبة المقالات",
    "dash.qa.library.sub": "{n} مقال طبي",
    "dash.qa.profile.title": "عرض الملف الشخصي",
    "dash.qa.profile.sub": "اطّلع على الإحصاءات والإنجازات",
    "dash.featuredArticles": "مقالات مميّزة",
    "dash.recentActivity": "النشاط الأخير",
    "dash.timeAgo.justNow": "الآن",
    "dash.timeAgo.minutes": "قبل {n} د",
    "dash.timeAgo.hours": "قبل {n} س",
    "dash.timeAgo.days": "قبل {n} ي",

    "qbank.home.title": "استوديو بنك الأسئلة",
    "qbank.home.subtitle":
      "أنشئ جلسة دراسة من الاختبارات والبنوك والأسئلة المقالية ومحطات OSCE والبطاقات.",
    "qbank.home.tabContent": "المحتوى",
    "qbank.home.tabCreate": "إنشاء",
    "qbank.home.tabPrevious": "السابقة",
    "qbank.home.empty": "لا توجد حزم محتوى بعد.",
    "qbank.home.start": "ابدأ",
    "qbank.home.continue": "متابعة",
    "qbank.home.questions": "{n} سؤال",
    "qbank.home.cards": "{n} بطاقة",
    "qbank.home.stations": "{n} محطة",
    "qbank.home.prompts": "{n} مطالبة",
    "qbank.home.langAny": "أي لغة",
    "qbank.home.langEn": "الإنجليزية فقط",
    "qbank.home.langAr": "العربية فقط",
    "qbank.home.filterLang": "اللغة",
    "qbank.home.filterType": "النوع",
    "qbank.home.search": "ابحث عن حزمة…",

    "qbank.session.question": "السؤال {n} من {total}",
    "qbank.session.exit": "خروج",
    "qbank.session.flag": "تعليم",
    "qbank.session.unflag": "إزالة التعليم",
    "qbank.session.submit": "إرسال",
    "qbank.session.submitAll": "إرسال الكل",
    "qbank.session.reveal": "إظهار الإجابة",
    "qbank.session.hideAnswer": "إخفاء الإجابة",
    "qbank.session.explanation": "الشرح",
    "qbank.session.correct": "صحيح",
    "qbank.session.incorrect": "خطأ",
    "qbank.session.skipped": "تُخطّي",
    "qbank.session.score": "النتيجة: {n}/{total}",
    "qbank.session.accuracy": "الدقة: {pct}٪",
    "qbank.session.review": "مراجعة",
    "qbank.session.tryAgain": "حاول مجددًا",
    "qbank.session.backToHub": "العودة إلى بنك الأسئلة",
    "qbank.session.tutorMode": "وضع المعلم",
    "qbank.session.timedMode": "وضع موقوت",
    "qbank.session.timeRemaining": "الوقت المتبقي",
    "qbank.session.pause": "إيقاف مؤقت",
    "qbank.session.resume": "استئناف",
    "qbank.session.strikethrough": "إقصاء",
    "qbank.session.strikeRestore": "استعادة",
    "qbank.session.langBadge.ar": "عربي",
    "qbank.session.langBadge.en": "إنجليزي",

    "flash.home.title": "البطاقات التعليمية",
    "flash.home.subtitle": "رزم بالتكرار المتباعد عبر جميع التخصصات.",
    "flash.home.empty": "لا توجد رزم بطاقات متاحة.",
    "flash.home.study": "ادرس",
    "flash.home.cards": "{n} بطاقة",
    "flash.home.due": "مستحقة",
    "flash.home.new": "جديدة",
    "flash.home.total": "الإجمالي",
    "flash.session.flip": "اقلب",
    "flash.session.rateEasy": "سهل",
    "flash.session.rateHard": "صعب",
    "flash.session.rateUnknown": "لا أعرف",
    "flash.session.progress": "البطاقة {n} من {total}",
    "flash.session.complete": "اكتملت الرزمة!",
    "flash.session.exit": "خروج من الرزمة",
    "flash.home.subdecks": "{n} رزم فرعية",
    "flash.home.studyAll": "ادرس الكل",
    "flash.home.allDecks": "كل الرزم",
    "flash.home.studyAgain": "ادرس مجددًا",

    "osce.home.title": "استوديو OSCE",
    "osce.home.subtitle": "محطات المهارات السريرية مع مرضى افتراضيين.",
    "osce.home.empty": "لا توجد محطات OSCE متاحة.",
    "osce.home.start": "ابدأ المحطة",
    "osce.home.time": "{n} د",
    "osce.home.examiner": "الممتحن",
    "osce.home.patient": "المريض",

    "library.title": "المكتبة",
    "library.subtitle": "مقالات طبية عبر جميع التخصصات.",
    "library.search": "ابحث عن مقال…",
    "library.empty": "لا توجد مقالات.",
    "library.readTime": "{n} د قراءة",
    "library.specialty": "التخصص",
    "library.topic": "الموضوع",
    "library.relatedArticles": "مقالات ذات صلة",
    "library.bookmarked": "المحفوظة",
    "library.all": "الكل",
    "library.articlesCount": "{n} مقالات",
    "library.oneArticle": "مقال واحد",
    "library.noResults": "لا توجد مقالات مطابقة لبحثك",
    "library.noBookmarks": "لا توجد مقالات محفوظة بعد",

    "profile.title": "الملف الشخصي",
    "profile.stats": "الإحصاءات",
    "profile.achievements": "الإنجازات",
    "profile.recentSessions": "الجلسات الأخيرة",
    "profile.noSessions": "لا جلسات بعد — ابدأ واحدة من استوديو بنك الأسئلة.",
    "profile.totalAttempted": "إجمالي المحاولات",
    "profile.totalCorrect": "إجمالي الصحيحة",
    "profile.avgAccuracy": "متوسط الدقة",
    "profile.packsTouched": "الحزم المدروسة",

    "settings.title": "الإعدادات",
    "settings.subtitle":
      "اضبط اللغة ومساعد الذكاء الاصطناعي واختصارات لوحة المفاتيح وأدِر البيانات",
    "settings.section.language": "اللغة",
    "settings.section.ai": "مساعد الذكاء الاصطناعي",
    "settings.section.shortcuts": "لوحة المفاتيح",
    "settings.section.danger": "البيانات وإعادة التعيين",
    "settings.language.uiLang": "لغة الواجهة",
    "settings.language.uiLangDesc":
      "اختر اللغة المستخدمة في التنقل والأزرار والعناوين عبر أوسلر.",
    "settings.language.contentLang": "فلتر لغة المحتوى",
    "settings.language.contentLangDesc":
      "يُفلتر الحزم الظاهرة في بنك الأسئلة والبطاقات والمكتبة. تُعرض الحزم دائمًا باللغة التي أُنشئت بها — هذا الفلتر يُخفيها أو يُظهرها فقط.",
    "settings.language.contentLangAll": "إظهار كل اللغات",
    "settings.language.contentLangEn": "محتوى إنجليزي فقط",
    "settings.language.contentLangAr": "محتوى عربي فقط",
    "settings.language.rtlNote":
      "تستخدم الواجهة العربية تخطيطًا من اليمين إلى اليسار. تُعرض الحزم العربية باتجاه RTL بصرف النظر عن لغة الواجهة.",
    "settings.language.enName": "English",
    "settings.language.arName": "العربية",

    "settings.ai.title": "مساعد الذكاء الاصطناعي",
    "settings.ai.subtitle":
      "اضبط مساعد الدراسة الذي يشرح الأسئلة والمفاهيم خلال جلسات بنك الأسئلة. تُحفظ التغييرات عند النقر على حفظ.",
    "settings.ai.apiKey": "مفتاح Gemini API",
    "settings.ai.apiKeyPlaceholder": "أدخل مفتاح Gemini API الخاص بك",
    "settings.ai.unsaved": "تغييرات غير محفوظة",
    "settings.ai.getKey":
      "احصل على مفتاح مجاني من AI Studio. مساعد الذكاء الاصطناعي يتطلب مفتاحًا للعمل.",
    "settings.ai.model": "النموذج",
    "settings.ai.maxWait": "أقصى زمن انتظار",
    "settings.ai.maxWait.15": "15 ثانية",
    "settings.ai.maxWait.30": "30 ثانية",
    "settings.ai.maxWait.60": "60 ثانية",
    "settings.ai.maxWait.120": "دقيقتان",
    "settings.ai.osceVoice": "صوت OSCE والنموذج المباشر",
    "settings.ai.osceVoiceDesc": "اضبط إعدادات الصوت لمحاكي المريض الافتراضي OSCE.",
    "settings.ai.liveModel": "نموذج الصوت المباشر",
    "settings.ai.liveModelDesc": "يُستخدم للمحادثة الصوتية الفورية في OSCE (Gemini Live API).",
    "settings.ai.ttsRate": "سرعة تحويل النص لصوت",
    "settings.ai.ttsRateDesc": "سرعة توليد الصوت لاستجابات المريض.",
    "settings.ai.testConnection": "اختبار الاتصال",
    "settings.ai.testing": "جارٍ الاختبار…",
    "settings.ai.clearKey": "مسح المفتاح",

    "settings.shortcuts.title": "اختصارات لوحة المفاتيح",
    "settings.shortcuts.subtitle":
      "انقر على أي اختصار لتسجيل تركيبة مفاتيح جديدة. اضغط Esc لإلغاء التسجيل، أو Backspace لتعطيله. تسري التغييرات عند النقر على حفظ التغييرات.",
    "settings.shortcuts.scope.global": "عام",
    "settings.shortcuts.scope.globalDesc": "متاحة في كل مكان — بحث، تنقّل، سمات.",
    "settings.shortcuts.scope.qbank": "استوديو بنك الأسئلة",
    "settings.shortcuts.scope.qbankDesc":
      "متاحة داخل جلسة بنك الأسئلة (التالي، السابق، تعليم، إرسال، ...).",
    "settings.shortcuts.scope.flashcard": "البطاقات التعليمية",
    "settings.shortcuts.scope.flashcardDesc":
      "متاحة خلال جلسة دراسة البطاقات (قلب، تقييم، تنقّل).",
    "settings.shortcuts.scope.reader": "قارئ المقالات",
    "settings.shortcuts.scope.readerDesc": "متاحة عند قراءة مقال أو في نافذة منبثقة.",
    "settings.shortcuts.tipsTitle": "نصائح",
    "settings.shortcuts.tips": [
      "تُدعم المتتاليات متعددة المفاتيح (مثل G ثم D للوحة الرئيسية) — سجّل كلا المفتاحين متتاليين.",
      "على macOS، المُعدِّل هو ⌘؛ وعلى Windows/Linux يكون Ctrl.",
      "تُتجاهل الاختصارات أثناء الكتابة في حقول النص، باستثناء تلك التي تستخدم مُعدِّل Ctrl/⌘.",
      "تُكشف التعارضات تلقائيًا — لا يمكن أن يتشارك إجراءان نفس الاختصار.",
    ],
    "settings.shortcuts.resetAll": "إعادة تعيين الكل إلى الافتراضي",
    "settings.shortcuts.default": "الافتراضي",
    "settings.shortcuts.disabled": "معطّل",

    "settings.danger.title": "البيانات وإعادة التعيين",
    "settings.danger.subtitle":
      "تُخزَّن بيانات دراستك محليًا في هذا المتصفح. قد يؤدي مسح ذاكرة التخزين المؤقت للمتصفح إلى مسح هذه البيانات أيضًا.",
    "settings.danger.warning": "لا يمكن التراجع عن هذا الإجراء.",
    "settings.danger.packsWithProgress": "{n} حزمة بها تقدّم",
    "settings.danger.packsWithProgressSub":
      "يشمل إجابات الاختبارات والبنوك والبطاقات والمقالية وOSCE.",
    "settings.danger.clearAll": "مسح كل التقدّم",
    "settings.danger.confirm": "هل أنت متأكد؟",
    "settings.danger.confirmYes": "نعم، امسح كل شيء",

    "engine.quiz": "اختبار",
    "engine.bank": "بنك الأسئلة",
    "engine.flashcard": "بطاقات",
    "engine.written": "مقالية",
    "engine.osce": "OSCE",
    "engine.library": "مكتبة",

    "lang.ar": "العربية",
    "lang.en": "الإنجليزية",
    "lang.badge.ar": "ع",
    "lang.badge.en": "EN",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["en"];

/** Translate a key for the given UI language, with `{name}` placeholder interpolation. */
export function translate(
  lang: UiLang,
  key: StringKey,
  params?: Record<string, string | number>,
): string {
  const table = STRINGS[lang] as Record<string, string | string[]>;
  const fallback = STRINGS.en as Record<string, string | string[]>;
  let value = (table[key] ?? fallback[key] ?? key) as string;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}

/** Get a list value (used for the keyboard-shortcut tips list). */
export function translateList(lang: UiLang, key: StringKey): string[] {
  const table = STRINGS[lang] as Record<string, string | string[]>;
  const fallback = STRINGS.en as Record<string, string | string[]>;
  const value = table[key] ?? fallback[key];
  return Array.isArray(value) ? value : [];
}

/* ─────────────────────────── Storage helpers ────────────────────────── */

export function loadUiLang(): UiLang {
  if (typeof window === "undefined") return DEFAULT_UI_LANG;
  const v = localStorage.getItem(UI_LANG_STORAGE_KEY);
  return v === "ar" || v === "en" ? v : DEFAULT_UI_LANG;
}

export function saveUiLang(lang: UiLang): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(UI_LANG_STORAGE_KEY, lang);
}

export function loadContentLangFilter(): ContentLangFilter {
  if (typeof window === "undefined") return DEFAULT_CONTENT_LANG_FILTER;
  const v = localStorage.getItem(CONTENT_LANG_STORAGE_KEY);
  return v === "en" || v === "ar" || v === "all" ? v : DEFAULT_CONTENT_LANG_FILTER;
}

export function saveContentLangFilter(v: ContentLangFilter): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONTENT_LANG_STORAGE_KEY, v);
}

/* ─────────────────────────── Direction helpers ──────────────────────── */

export function dirFor(lang: UiLang): "ltr" | "rtl" {
  return LANGUAGES[lang].dir;
}

export function isRtl(lang: UiLang): boolean {
  return LANGUAGES[lang].dir === "rtl";
}

/**
 * Inline script that runs before React hydration to set <html lang> and <html dir>
 * from localStorage. Prevents a flash of LTR when the user previously picked Arabic.
 */
export const LANG_INIT_SCRIPT = `
(function(){try{
  var v=localStorage.getItem('${UI_LANG_STORAGE_KEY}');
  var lang=(v==='ar'||v==='en')?v:'${DEFAULT_UI_LANG}';
  var dir=lang==='ar'?'rtl':'ltr';
  var html=document.documentElement;
  html.setAttribute('lang',lang);
  html.setAttribute('dir',dir);
  if(lang==='ar'){html.classList.add('osler-ar');}else{html.classList.remove('osler-ar');}
}catch(e){}})();
`.trim();
