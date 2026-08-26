/**
 * MCP server instructions + prompt templates.
 *
 * Pure data — no runtime dependencies. The `SERVER_INSTRUCTIONS` string is
 * returned in the MCP `initialize` response so agents know the content
 * pipeline without reading docs. The prompts give repeatable parse workflows
 * (e.g. "build a QBank pack from this PDF").
 */

export const SERVER_NAME = "osler-admin";
export const SERVER_VERSION = "1.0.0";
export const PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INSTRUCTIONS = `Osler content-authoring MCP server.

You are connected to a medical-education platform (Osler). Through these tools
you can author managed content packs, upload their data files and images, run
server-side schema validation, and submit finished work for human review.

## Approval model (important)

You CANNOT publish. Everything you submit enters a review queue; a human admin
approves publication through the web admin panel. Never tell the user content
is live — say it is pending approval.

## Content types and required JSON shape

Each pack body is one JSON document validated server-side:

- quiz:    { "questions": [{ "id", "question", "options": [..>=2], "correct": <index>, ... }] }
- bank:    { "passages":  [{ "id", "content", "questions": [...] }] }
- written: { "prompts":   [{ "id", "prompt", "rubric": [...] }] }
- flashcard:{ "cards":    [{ "id", "front", "back" } | { "id", "type": "cloze", "text" }] }
- osce:    { "stations":  [{ "id", "title", "task", "time" (minutes), "patient", "hiddenProfile", "rubric", "type"? }] }
- video:   { "videos":    [{ "id", "title", "source": { "type": "youtube|mp4|hls", "id"|"url" } }] }
- library: markdown/html text (not JSON) — stored as-is

Extra fields (explanation, difficulty, tags, hint...) are allowed alongside the
required ones. Run \`validate_content\` before submitting — the same validator
the review step uses.

## Recommended workflow

1. Study existing structure first: \`list_content_files\` + \`read_content_file\`
   on a published pack of the same type (keys look like
   \`content-files/qbank/<Folder>/<file>.json\`; manifests live under
   \`content-manifests/\`).
2. Transform the source material into the target JSON shape offline.
3. Upload everything in ONE call with \`create_content_pack\` — body + all
   assets (images as data URIs) + optional immediate validation + optional
   submit-for-review. This is strongly preferred over per-file calls.
4. For iterative edits on an existing draft use \`update_draft_body\` /
   \`upload_asset\`, then \`submit_for_review\`.
5. Report the object id and status to the user.

## Conventions

- Folder name = display title; file names are canonical per type
  (quiz: questions.json, bank: passages.json, written: prompts.json,
  flashcard: cards.json, osce: stations.json, video: videos.json,
  library: index.md). The server derives "<slug>/<file>" from your title
  when you omit targetPath, so the pack lands in a subfolder (e.g.
  content-files/qbank/my-pack/questions.json), not the category root.
  Pass targetPath="cardiology/acute-coronary" to control the folder
  explicitly; bare filenames in rich text resolve against the pack's
  \`images/\` subfolder.
- Managed vs student view: you write to content/<type>/<uuid>/ (draft);
  students read content-files/<category>/... after an admin approves.
  list_content_files only sees student-facing files.
- Arabic content: set language "ar"; keep UI strings untranslated otherwise.
- IDs inside arrays must be non-empty unique strings.`;

export interface McpPromptDef {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  /** Builds the user-facing prompt text from resolved argument values. */
  build(args: Record<string, string>): string;
}

export const PROMPTS: McpPromptDef[] = [
  {
    name: "qbank_from_pdf",
    title: "QBank pack from PDF",
    description:
      "Parse a source PDF into an Osler quiz pack (questions with options, correct answer index and explanations), then stage it for review in one batch.",
    arguments: [
      { name: "sourceDescription", description: "Path/URL/description of the PDF or its extracted text", required: true },
      { name: "packTitle", description: "Display title for the new pack" },
      { name: "language", description: 'Content language: "en" or "ar" (default "en")' },
      { name: "questionCount", description: "Target number of questions (default: as many as the source supports)" },
    ],
    build(args) {
      return [
        `Source: ${args.sourceDescription}`,
        args.packTitle ? `Pack title: ${args.packTitle}` : "",
        args.language ? `Content language: ${args.language}` : "",
        args.questionCount ? `Target question count: ${args.questionCount}` : "",
        "",
        "Steps:",
        "1. Read the source (extract text from the PDF if needed). If a tool returns the file, read it fully before transforming.",
        "2. Author USMLE-style best-of-five questions: stem, exactly 5 mutually-exclusive options, zero-based `correct` index, and a teaching-quality `explanation` for every option set. Cover the source's key teaching points; do not invent facts beyond it.",
        "3. Build ONE JSON object: { \"questions\": [...] } where each question has id, question, options[], correct. Match any conventions you find in an existing published qbank pack (list_content_files + read_content_file under content-files/qbank/).",
        "4. Call validate_content with contentType \"quiz\" and fix every reported error.",
        "5. Call create_content_pack once with the full body (and any images as data URIs) and submit=true.",
        "6. Reply with the pack id, question count, and a note that it awaits admin approval.",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    name: "flashcards_from_notes",
    title: "Flashcard deck from notes",
    description:
      "Turn study notes/markdown into an Osler flashcard deck (basic front/back or cloze cards) and stage it for review.",
    arguments: [
      { name: "sourceNotes", description: "The notes text (or path/URL to fetch them from)", required: true },
      { name: "deckTitle", description: "Display title for the deck" },
      { name: "language", description: '"en" or "ar"' },
    ],
    build(args) {
      return [
        `Source notes:\n${args.sourceNotes}`,
        "",
        "Steps:",
        "1. Distill atomic cards — one fact per card. Use basic { id, front, back } cards; prefer cloze ({ id, type: \"cloze\", text }) when deleting a key term makes the recall stronger. Anki syntax {{c1::answer::hint}} is supported for cloze.",
        "2. Build ONE JSON object: { \"cards\": [...] }.",
        "3. validate_content with contentType \"flashcard\", fix errors.",
        "4. create_content_pack once with submit=true.",
        "5. Report the deck id and card count (status: pending approval).",
      ].join("\n");
    },
  },
];
