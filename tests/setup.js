import { vi } from 'vitest';

const store = {};

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn(key => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach(key => delete store[key]);
    }),
  },
  writable: true,
  configurable: true,
});
