import { describe, it, expect } from 'vitest';
import { get, put, deleteEntry, getAll, clear } from '../../../src/lib/storage.js';

describe('storage.js', () => {
  const store = 'settings';

  it('put and get round-trip', async () => {
    await put(store, { key: 'test-key', value: 'hello' });
    const result = await get(store, 'test-key');
    expect(result).toEqual({ key: 'test-key', value: 'hello' });
  });

  it('delete removes entry', async () => {
    await put(store, { key: 'delete-me', value: 'gone' });
    await deleteEntry(store, 'delete-me');
    const result = await get(store, 'delete-me');
    expect(result).toBeNull();
  });

  it('getAll returns all entries in a store', async () => {
    await clear(store);
    await put(store, { key: 'a', value: 1 });
    await put(store, { key: 'b', value: 2 });
    const all = await getAll(store);
    expect(all).toHaveLength(2);
    expect(all.find(e => e.key === 'a').value).toBe(1);
    expect(all.find(e => e.key === 'b').value).toBe(2);
  });

  it('clear removes all entries in a store', async () => {
    await put(store, { key: 'keep-me', value: 'nope' });
    await clear(store);
    const all = await getAll(store);
    expect(all).toHaveLength(0);
  });
});
