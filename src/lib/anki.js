const CLOZE_RE = /\{\{c(\d+)::([^}]+?)(?:::([^}]*))?\}\}/;

export function detectCloze(text) {
  if (!text) return { isCloze: false, clozeText: text, deletions: [] };
  const deletions = [];
  let idx = 0;
  const result = text.replace(CLOZE_RE, (match, num, answer, hint) => {
    deletions.push({ answer: answer.trim(), hint: hint ? hint.trim() : '' });
    return `{{c${++idx}::${answer.trim()}${hint ? '::' + hint.trim() : ''}}}`;
  });
  return { isCloze: deletions.length > 0, clozeText: result, deletions };
}

function escapeField(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes('\t') || s.includes('\n') || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function unescapeField(val) {
  if (val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1).replace(/""/g, '"');
  }
  return val;
}

export function exportToTSV(cards) {
  const lines = ['#front\tback\ttags'];
  for (const card of cards) {
    let front = card.front || '';
    let back = card.back || '';
    if (card.cloze) {
      const c = detectCloze(card.cloze);
      if (c.isCloze && c.deletions.length > 0) {
        front = c.clozeText;
        back = c.deletions.map(d => d.answer).join('; ');
      }
    }
    const tags = Array.isArray(card.tags) ? card.tags.join(' ') : (card.tags || '');
    lines.push([escapeField(front), escapeField(back), escapeField(tags)].join('\t'));
  }
  return lines.join('\n');
}

export function importFromTSV(tsv) {
  const rawLines = tsv.split('\n');
  const lines = [];
  let currentLine = '';
  let inQuotes = false;
  for (const rawLine of rawLines) {
    for (const ch of rawLine) {
      if (ch === '"') inQuotes = !inQuotes;
    }
    currentLine += (currentLine ? '\n' : '') + rawLine;
    if (!inQuotes) {
      if (currentLine.trim()) lines.push(currentLine);
      currentLine = '';
    }
  }
  if (currentLine.trim()) lines.push(currentLine);

  const cards = [];
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const parts = parseTSVLine(line);
    if (parts.length < 2) continue;
    const front = unescapeField(parts[0].trim());
    const back = unescapeField(parts[1].trim());
    const tags = parts[2] ? unescapeField(parts[2].trim()).split(/\s+/).filter(Boolean) : [];
    cards.push({ front, back, tags });
  }
  return cards;
}

function parseTSVLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\t' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

export function downloadTSV(cards, filename) {
  const tsv = exportToTSV(cards);
  const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'osler-cards.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
