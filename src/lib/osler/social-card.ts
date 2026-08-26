/**
 * Dynamic client/edge Social Card SVG generator.
 * Generates custom SVG cards for shared content links (e.g. QBank packs, flashcard decks, library articles).
 */

export interface SocialCardOptions {
  title: string;
  subtitle?: string;
  category?: string;
  engineType?: "quiz" | "bank" | "flashcard" | "osce" | "library" | "video";
  siteName?: string;
}

const ENGINE_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  quiz: { bg: "#1e293b", border: "#3b82f6", text: "#93c5fd", label: "Quiz" },
  bank: { bg: "#1e293b", border: "#2563eb", text: "#93c5fd", label: "Question Bank" },
  flashcard: { bg: "#1e293b", border: "#16a34a", text: "#86efac", label: "Flashcards" },
  osce: { bg: "#1e293b", border: "#dc2626", text: "#fca5a5", label: "OSCE Station" },
  library: { bg: "#1e293b", border: "#7c3aed", text: "#d8b4fe", label: "Clinical Library" },
  video: { bg: "#1e293b", border: "#0891b2", text: "#67e8f9", label: "Video Lesson" },
};

export function generateSocialCardSvg(options: SocialCardOptions): string {
  const { title, subtitle, category, engineType = "quiz", siteName = "Osler" } = options;
  const safeTitle = title.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
  const safeSubtitle = (subtitle || "Medical Study Platform").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
  const safeCategory = (category || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
  const meta = ENGINE_COLORS[engineType] || ENGINE_COLORS.quiz;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="card-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
    <linearGradient id="card-accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#93c5fd"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#card-bg)" />

  <!-- Logo Mark -->
  <g transform="translate(120, 100)">
    <rect x="0" y="0" width="70" height="70" rx="18" fill="#1e3a8a" stroke="#3b82f6" stroke-width="2" />
    <path d="M 12 35 L 22 35 L 28 20 L 35 50 L 42 27 L 49 35 L 58 35" stroke="url(#card-accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    <text x="85" y="48" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="800" fill="#ffffff">${siteName}</text>
  </g>

  <!-- Engine & Category Badges -->
  <g transform="translate(120, 210)">
    <rect x="0" y="0" width="160" height="38" rx="19" fill="${meta.bg}" stroke="${meta.border}" stroke-width="1.5" />
    <text x="80" y="24" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="${meta.text}" text-anchor="middle">${meta.label}</text>
    ${
      safeCategory
        ? `<rect x="175" y="0" width="180" height="38" rx="19" fill="#1e293b" stroke="#334155" stroke-width="1.5" />
           <text x="265" y="24" font-family="system-ui, sans-serif" font-size="14" font-weight="500" fill="#94a3b8" text-anchor="middle">${safeCategory}</text>`
        : ""
    }
  </g>

  <!-- Content Title -->
  <text x="120" y="340" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="800" fill="#f8fafc" letter-spacing="-0.02em">
    ${safeTitle}
  </text>

  <!-- Subtitle -->
  <text x="120" y="410" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="400" fill="#94a3b8">
    ${safeSubtitle}
  </text>

  <!-- Footer branding -->
  <line x1="120" y1="520" x2="1080" y2="520" stroke="#334155" stroke-width="1" />
  <text x="120" y="560" font-family="system-ui, sans-serif" font-size="16" font-weight="500" fill="#64748b">
    Interactive Clinical Case &amp; Medical Study Engine · Offline Ready
  </text>
</svg>`;
}

export function getSocialCardDataUri(options: SocialCardOptions): string {
  const svg = generateSocialCardSvg(options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
