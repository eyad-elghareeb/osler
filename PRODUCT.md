# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Medical students preparing for exams, clinical rotations, and clinical skills assessments. Their primary job is to study efficiently, practice exam-style questions, identify knowledge gaps, and review clinical material across desktop and mobile contexts.

## Product Purpose

Osler is an open-source, self-hostable medical study platform that brings question banks, flashcards, OSCE cases, videos, and medical articles into one installable PWA. Success means a learner can move from practice to feedback to targeted review with minimal friction, especially inside the QBank workflow.

## Positioning

Osler combines a smooth, exam-focused QBank with complementary medical-learning engines in a single private, local-first workspace. Its meaningfully different position is the unified, self-hostable experience rather than a collection of disconnected study tools or a generic learning app.

## Operating Context

Learners use Osler for focused study sessions, timed or tutor-mode question practice, spaced review, clinical-case preparation, and reference reading. It must work as an installable PWA across mobile and desktop, support offline-friendly local study data, and remain comfortable for both left-to-right English and right-to-left Arabic content and interface use.

## Capabilities and Constraints

- QBank functionality is the highest-priority product workflow and should have the smoothest, least-friction, most intuitive interaction design.
- The platform supports quiz, passage-based bank, written, flashcard, OSCE, library, and video engines.
- Progress and user data are local-first, with optional cloud and peer-to-peer sync capabilities.
- English and Arabic UI/content workflows, including RTL support, must remain supported.
- Themes are configurable, and color changes should remain easy through the existing theme system.
- Existing architecture, behavior, content, and native-feel patterns must be preserved wherever possible.
- Future work must review, fix, improve, and polish the existing implementation; do not rewrite the product or start from scratch.
- Existing open-source and self-hosting capabilities must remain viable.

## Brand Commitments

The product name is Osler. It is positioned as a focused medical-learning tool with a practical, trustworthy study experience. The existing Osler logo, installable PWA identity, configurable themes, and English/Arabic support are binding product commitments.

## Evidence on Hand

- Product implementation and routes: `src/app/` and `src/components/osler/`.
- QBank content and manifests: `public/osler-content/qbank/`.
- Complementary learning content: `public/osler-content/flashcard/`, `osce/`, `library/`, and `videos/`.
- Runtime configuration and theme settings: `public/osler.config.json` and `src/lib/osler/`.
- Existing brand and PWA assets: `public/assets/`, `public/manifest.webmanifest`, and `public/icon.svg`.
- Product documentation and deployment context: `README.md`, `docs/`, `SELF-HOSTING.md`, and `tauri-admin/`.
- No fabricated testimonials, customer claims, or external proof should be introduced without explicit source material.

## Product Principles

- Make question practice feel immediate, predictable, and low-friction.
- Preserve learner focus from starting a session through reviewing feedback.
- Improve the existing product surgically instead of replacing working foundations.
- Keep study data private, portable, and self-hostable.
- Treat English, Arabic, RTL, mobile, and desktop as first-class experiences.

## Accessibility & Inclusion

English and Arabic users, including RTL readers, must be supported throughout the product. Interfaces should remain usable across mobile and desktop form factors, respect reduced-motion preferences, preserve safe-area behavior in installed PWAs, and keep interactive controls clear and keyboard accessible.
