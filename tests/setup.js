import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';

// Each instance provides an isolated in-memory IndexedDB.
export class FakedDB extends IDBFactory {}

const store = {};

const lsmem = {};

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    get length() { return Object.keys(lsmem).length; },
    key: vi.fn(i => Object.keys(lsmem)[i] ?? null),
    getItem: vi.fn(key => lsmem[key] ?? null),
    setItem: vi.fn((key, value) => { lsmem[key] = String(value); }),
    removeItem: vi.fn(key => { delete lsmem[key]; }),
    clear: vi.fn(() => { Object.keys(lsmem).forEach(k => delete lsmem[k]); }),
  },
  writable: true,
  configurable: true,
});
