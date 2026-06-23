import { describe, it, expect } from 'vitest';
import { exportToTSV, importFromTSV, detectCloze, downloadTSV } from '../../../src/lib/anki.js';

describe('anki.js', () => {
  it('round-trip export/import preserves data', () => {
    const cards = [
      { front: 'What is the powerhouse of the cell?', back: 'Mitochondria', tags: ['biology', 'cell'] },
      { front: 'What is DNA?', back: 'Deoxyribonucleic acid', tags: ['genetics'] },
    ];
    const tsv = exportToTSV(cards);
    const parsed = importFromTSV(tsv);
    expect(parsed).toEqual(cards);
  });

  it('handles quoted fields with tabs and newlines', () => {
    const cards = [
      { front: 'Line 1\nLine 2', back: 'Contains\ttab', tags: ['formatting'] },
    ];
    const tsv = exportToTSV(cards);
    const parsed = importFromTSV(tsv);
    expect(parsed).toEqual(cards);
  });

  it('detects cloze deletions', () => {
    const result = detectCloze('The {{c1::mitochondria}} is the powerhouse');
    expect(result.isCloze).toBe(true);
    expect(result.deletions).toHaveLength(1);
    expect(result.deletions[0].answer).toBe('mitochondria');
    expect(result.deletions[0].hint).toBe('');
  });

  it('detects cloze with hint', () => {
    const result = detectCloze('{{c1::mitochondria::organelle}} produces ATP');
    expect(result.isCloze).toBe(true);
    expect(result.deletions[0].answer).toBe('mitochondria');
    expect(result.deletions[0].hint).toBe('organelle');
  });

  it('handles empty tags column', () => {
    const cards = [
      { front: 'No tags', back: 'Still works', tags: [] },
    ];
    const tsv = exportToTSV(cards);
    const parsed = importFromTSV(tsv);
    expect(parsed[0].tags).toEqual([]);
    expect(parsed[0].front).toBe('No tags');
  });
});
