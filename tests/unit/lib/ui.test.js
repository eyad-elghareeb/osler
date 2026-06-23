import { describe, it, expect, vi } from 'vitest';

describe('ui module', () => {
  it('should export Button function', async () => {
    const mod = await import('../../../src/lib/ui.js');
    expect(typeof mod.Button).toBe('function');
  });

  it('should export Card function', async () => {
    const mod = await import('../../../src/lib/ui.js');
    expect(typeof mod.Card).toBe('function');
  });

  it('should export Modal function', async () => {
    const mod = await import('../../../src/lib/ui.js');
    expect(typeof mod.Modal).toBe('function');
  });

  it('should create a Button element', async () => {
    const mod = await import('../../../src/lib/ui.js');
    const btn = mod.Button('Click me', { primary: true });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Click me');
    expect(btn.className).toContain('btn-primary');
  });

  it('should create a Card element', async () => {
    const mod = await import('../../../src/lib/ui.js');
    const card = mod.Card('Hello World');
    expect(card.tagName).toBe('DIV');
    expect(card.innerHTML).toBe('Hello World');
  });
});
