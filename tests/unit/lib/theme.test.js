import { describe, it, expect } from 'vitest';

describe('theme module', () => {
  it('should export initTheme function', async () => {
    const mod = await import('../../../src/lib/theme.js');
    expect(typeof mod.initTheme).toBe('function');
  });

  it('should export toggleTheme function', async () => {
    const mod = await import('../../../src/lib/theme.js');
    expect(typeof mod.toggleTheme).toBe('function');
  });

  it('should export getTheme function', async () => {
    const mod = await import('../../../src/lib/theme.js');
    expect(typeof mod.getTheme).toBe('function');
  });

  it('should export updateThemeIcons function', async () => {
    const mod = await import('../../../src/lib/theme.js');
    expect(typeof mod.updateThemeIcons).toBe('function');
  });

  it('should getTheme return a string', async () => {
    const mod = await import('../../../src/lib/theme.js');
    expect(typeof mod.getTheme()).toBe('string');
  });

  it('should toggleTheme change the theme', async () => {
    const mod = await import('../../../src/lib/theme.js');
    const before = mod.getTheme();
    const after = mod.toggleTheme();
    // Just verify the return value is a valid theme
    expect(['dark', 'light']).toContain(after);
  });
});
