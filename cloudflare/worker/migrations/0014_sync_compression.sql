-- Store sync documents gzip-compressed to save D1 space.
-- payload holds base64 gzip when compressed = 1, raw JSON when 0 (legacy rows).
ALTER TABLE progress_documents ADD COLUMN compressed INTEGER NOT NULL DEFAULT 0;
