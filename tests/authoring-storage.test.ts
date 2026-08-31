import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../src/authoring/project.js';
import { RECOVERY_KEY, RecoveryStore } from '../src/authoring/storage.js';
import type { RecoveryLockManager, RecoveryStorage } from '../src/authoring/storage.js';

class MemoryStorage implements RecoveryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
function project() { return createProject('<music-staff id="s"><music-measure id="m"><music-rest id="r" measure></music-rest></music-measure></music-staff>', 'Recovery fixture'); }

class QueuedLocks implements RecoveryLockManager {
  readonly names: string[] = [];
  private readonly tails = new Map<string, Promise<void>>();
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    this.names.push(name);
    const result = (this.tails.get(name) ?? Promise.resolve()).then(callback);
    this.tails.set(name, result.then(() => undefined, () => undefined));
    return result;
  }
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('local recovery store', () => {
  it('saves the full versioned project including unaccepted source and returns recovery timestamps only', () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage, writerId: 'writer-a' });
    expect(store.load()).toEqual({ status: 'empty' });
    const value = project();
    value.pendingSource = '<script>unaccepted and never mounted</script>';
    const saved = store.save(value);
    expect(saved).toMatchObject({ status: 'saved', revision: 1 });
    expect(saved).not.toHaveProperty('downloadedAt');
    const reopened = new RecoveryStore({ storage, writerId: 'writer-b' }).load();
    expect(reopened).toMatchObject({ status: 'ok', project: value, revision: 1, writer: 'writer-a' });
    if (saved.status === 'saved' && reopened.status === 'ok') expect(reopened.savedAt).toBe(saved.savedAt);
    expect(document.querySelector('script')).toBeNull();
  });

  it('increments revisions and prevents a stale tab from overwriting a newer writer', () => {
    const storage = new MemoryStorage();
    const a = new RecoveryStore({ storage, writerId: 'a' });
    const b = new RecoveryStore({ storage, writerId: 'b' });
    const value = project();
    expect(a.save(value)).toMatchObject({ status: 'saved', revision: 1 });
    expect(b.load()).toMatchObject({ status: 'ok', revision: 1 });
    value.metadata.title = 'Newer in tab B';
    expect(b.save(value)).toMatchObject({ status: 'saved', revision: 2 });
    const newer = storage.getItem(RECOVERY_KEY);
    value.metadata.title = 'Stale in tab A';
    expect(a.save(value)).toMatchObject({ status: 'conflict' });
    expect(a.clear()).toMatchObject({ status: 'conflict' });
    expect(storage.getItem(RECOVERY_KEY)).toBe(newer);
    expect(a.load()).toMatchObject({ status: 'ok', revision: 2, project: { metadata: { title: 'Newer in tab B' } } });
    expect(a.save(value)).toMatchObject({ status: 'saved', revision: 3 });
  });

  it('does not replace unseen recovery merely because a new store was constructed', () => {
    const storage = new MemoryStorage();
    new RecoveryStore({ storage, writerId: 'first' }).save(project());
    const before = storage.getItem(RECOVERY_KEY);
    const newcomer = new RecoveryStore({ storage, writerId: 'second' });
    expect(newcomer.save(project()).status).toBe('conflict');
    expect(newcomer.clear().status).toBe('conflict');
    expect(storage.getItem(RECOVERY_KEY)).toBe(before);
  });

  it('detects external deletion and same-revision changes rather than silently recreating or replacing them', () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage, writerId: 'first' });
    store.save(project());
    const original = storage.getItem(RECOVERY_KEY)!;
    const altered = JSON.parse(original);
    altered.writer = 'other';
    storage.setItem(RECOVERY_KEY, JSON.stringify(altered));
    expect(store.save(project()).status).toBe('conflict');
    storage.removeItem(RECOVERY_KEY);
    expect(store.save(project()).status).toBe('conflict');
    expect(store.load()).toEqual({ status: 'empty' });
    expect(store.save(project())).toMatchObject({ status: 'saved', revision: 1 });
  });

  it.each(['{bad json', '{"version":2}', '{"__proto__":{"polluted":true}}'])('leaves unreadable storage untouched on every operation', raw => {
    const storage = new MemoryStorage();
    storage.setItem(RECOVERY_KEY, raw);
    const store = new RecoveryStore({ storage });
    expect(store.load()).toMatchObject({ status: 'invalid' });
    expect(store.save(project())).toMatchObject({ status: 'invalid' });
    expect(store.clear()).toMatchObject({ status: 'invalid' });
    expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
  });

  it('validates stored source and nested schema before offering recovery', () => {
    const storage = new MemoryStorage();
    new RecoveryStore({ storage }).save(project());
    const data = JSON.parse(storage.getItem(RECOVERY_KEY)!);
    data.project.sourceHtml = data.project.sourceHtml.replace('<music-rest', '<script>alert(1)</script><music-rest');
    const unsafe = JSON.stringify(data);
    storage.setItem(RECOVERY_KEY, unsafe);
    const store = new RecoveryStore({ storage });
    expect(store.load().status).toBe('invalid');
    expect(storage.getItem(RECOVERY_KEY)).toBe(unsafe);
  });

  it('catches read denial and missing browser storage without throwing', () => {
    const denied: RecoveryStorage = { getItem() { throw new DOMException('Denied', 'SecurityError'); }, setItem() {}, removeItem() {} };
    const store = new RecoveryStore({ storage: denied });
    expect(store.load().status).toBe('unavailable');
    expect(store.save(project()).status).toBe('unavailable');
    expect(store.clear().status).toBe('unavailable');
    expect(new RecoveryStore({ storage: null }).load().status).toBe('unavailable');
  });

  it('reports quota failure without losing the last accepted recovery or advancing its revision', () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage });
    store.save(project());
    const previous = storage.getItem(RECOVERY_KEY);
    const blocked = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(store.save(project())).toMatchObject({ status: 'unavailable', message: expect.stringContaining('not saved') });
    expect(storage.getItem(RECOVERY_KEY)).toBe(previous);
    blocked.mockRestore();
    expect(store.save(project())).toMatchObject({ status: 'saved', revision: 2 });
  });

  it('detects an observed concurrent write during readback', () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage, writerId: 'mine' });
    const realWrite = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      const competing = JSON.parse(value);
      competing.writer = 'competing-writer';
      realWrite(key, JSON.stringify(competing));
    });
    expect(store.save(project())).toMatchObject({ status: 'conflict', message: expect.stringContaining('not confirmed') });
    expect(JSON.parse(storage.getItem(RECOVERY_KEY)!).writer).toBe('competing-writer');
    expect(store.save(project()).status).toBe('conflict');
  });

  it('does not claim success when a completed write cannot be verified', () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage });
    const read = storage.getItem.bind(storage);
    let reads = 0;
    const spy = vi.spyOn(storage, 'getItem').mockImplementation(key => {
      if (++reads === 2) throw new Error('temporarily unavailable');
      return read(key);
    });
    expect(store.save(project())).toMatchObject({ status: 'unavailable', message: expect.stringContaining('could not be verified') });
    spy.mockRestore();
    expect(store.save(project())).toMatchObject({ status: 'saved', revision: 2 });
  });

  it('does not save invalid accepted projects, but permits an invalid unaccepted source buffer', () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage });
    const value = project();
    value.pendingSource = '<music-note broken';
    expect(store.save(value).status).toBe('saved');
    const previous = storage.getItem(RECOVERY_KEY);
    value.sourceHtml = '<script>not accepted</script>';
    expect(store.save(value).status).toBe('invalid');
    expect(storage.getItem(RECOVERY_KEY)).toBe(previous);
  });

  it('returns isolated recovery snapshots and clears only an accepted revision', () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage });
    store.save(project());
    const read = store.load();
    if (read.status !== 'ok') throw new Error('Expected recovery');
    read.project.metadata.title = 'Not saved';
    expect(store.load()).toMatchObject({ status: 'ok', project: { metadata: { title: 'Recovery fixture' } } });
    expect(store.clear()).toEqual({ status: 'cleared' });
    expect(store.load()).toEqual({ status: 'empty' });
    expect(store.save(project())).toMatchObject({ status: 'saved', revision: 1 });
  });

  it('uses the configured storage key without inspecting or modifying unrelated entries', () => {
    const storage = new MemoryStorage();
    storage.setItem('unrelated', 'leave alone');
    const store = new RecoveryStore({ storage, key: 'local-fixture' });
    expect(store.save(project()).status).toBe('saved');
    expect(storage.getItem('unrelated')).toBe('leave alone');
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
    expect(store.clear().status).toBe('cleared');
    expect(storage.getItem('unrelated')).toBe('leave alone');
  });
});

describe('coordinated browser recovery', () => {
  it('serializes competing tabs and rechecks the accepted revision after acquiring the lock', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const a = new RecoveryStore({ storage, locks, writerId: 'tab-a' });
    const b = new RecoveryStore({ storage, locks, writerId: 'tab-b' });
    a.load();
    b.load();
    const first = project();
    const second = project();
    first.metadata.title = 'First tab';
    second.metadata.title = 'Second tab';
    const [one, two] = await Promise.all([a.saveCoordinated(first), b.saveCoordinated(second)]);
    expect(one).toMatchObject({ status: 'saved', revision: 1 });
    expect(two).toMatchObject({ status: 'conflict' });
    expect(JSON.parse(storage.getItem(RECOVERY_KEY)!).project.metadata.title).toBe('First tab');
    expect(locks.names).toEqual([a.lockName, a.lockName]);
    expect(a.lockName).toBe(b.lockName);
  });

  it('does not read or change storage until another holder releases the same lock', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const store = new RecoveryStore({ storage, locks });
    const blocker = gate();
    const held = locks.request(store.lockName, () => blocker.promise);
    const read = vi.spyOn(storage, 'getItem');
    const write = vi.spyOn(storage, 'setItem');
    const saved = store.saveCoordinated(project());
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    blocker.release();
    await held;
    expect(await saved).toMatchObject({ status: 'saved' });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('captures the requested project and pending source before waiting', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const store = new RecoveryStore({ storage, locks });
    const blocker = gate();
    const held = locks.request(store.lockName, () => blocker.promise);
    const requested = project();
    requested.pendingSource = 'Earlier pending buffer';
    const saved = store.saveCoordinated(requested);
    requested.metadata.title = 'Changed while waiting';
    requested.pendingSource = 'Newer pending buffer';
    blocker.release();
    await held;
    expect((await saved).status).toBe('saved');
    expect(store.load()).toMatchObject({ status: 'ok', project: { metadata: { title: 'Recovery fixture' }, pendingSource: 'Earlier pending buffer' } });
  });

  it('allows sequential snapshots from the same tab while advancing its accepted revision', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const store = new RecoveryStore({ storage, locks });
    const first = project();
    const second = project();
    second.metadata.title = 'Latest edit';
    const [a, b] = await Promise.all([store.saveCoordinated(first), store.saveCoordinated(second)]);
    expect(a).toMatchObject({ status: 'saved', revision: 1 });
    expect(b).toMatchObject({ status: 'saved', revision: 2 });
    expect(store.load()).toMatchObject({ status: 'ok', project: { metadata: { title: 'Latest edit' } } });
  });

  it('invalidates queued operations if the user opens recovery while they wait', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const store = new RecoveryStore({ storage, locks });
    await store.saveCoordinated(project());
    const original = storage.getItem(RECOVERY_KEY);
    const blocker = gate();
    const held = locks.request(store.lockName, () => blocker.promise);
    const next = project();
    next.metadata.title = 'Previously queued';
    const saving = store.saveCoordinated(next);
    const clearing = store.clearCoordinated();
    expect(store.load().status).toBe('ok');
    blocker.release();
    await held;
    expect(await saving).toMatchObject({ status: 'conflict', message: expect.stringContaining('reopened') });
    expect(await clearing).toMatchObject({ status: 'conflict', message: expect.stringContaining('reopened') });
    expect(storage.getItem(RECOVERY_KEY)).toBe(original);
  });

  it('holds the same lock for clearing and refuses a stale clear after another tab saves', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const a = new RecoveryStore({ storage, locks, writerId: 'a' });
    const b = new RecoveryStore({ storage, locks, writerId: 'b' });
    await a.saveCoordinated(project());
    b.load();
    const next = project();
    next.metadata.title = 'Retain this newer save';
    const [saved, cleared] = await Promise.all([a.saveCoordinated(next), b.clearCoordinated()]);
    expect(saved).toMatchObject({ status: 'saved', revision: 2 });
    expect(cleared).toMatchObject({ status: 'conflict' });
    expect(a.load()).toMatchObject({ status: 'ok', project: { metadata: { title: 'Retain this newer save' } } });
    expect(await a.clearCoordinated()).toEqual({ status: 'cleared' });
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('uses separate lock names for separate recovery keys', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const a = new RecoveryStore({ storage, locks, key: 'one' });
    const b = new RecoveryStore({ storage, locks, key: 'two' });
    const blocker = gate();
    const held = locks.request(a.lockName, () => blocker.promise);
    expect((await b.saveCoordinated(project())).status).toBe('saved');
    expect(storage.getItem('one')).toBeNull();
    expect(storage.getItem('two')).not.toBeNull();
    expect(a.lockName).not.toBe(b.lockName);
    blocker.release();
    await held;
  });

  it('returns an explicit no-write status when Web Locks are unavailable; sync fallback stays an explicit caller choice', async () => {
    const storage = new MemoryStorage();
    const store = new RecoveryStore({ storage, locks: null });
    const write = vi.spyOn(storage, 'setItem');
    const remove = vi.spyOn(storage, 'removeItem');
    expect(await store.saveCoordinated(project())).toMatchObject({ status: 'coordination-unavailable', message: expect.stringContaining('not changed') });
    expect(await store.clearCoordinated()).toMatchObject({ status: 'coordination-unavailable' });
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(store.save(project()).status).toBe('saved');
  });

  it('reports rejected lock requests without falling back to direct writes', async () => {
    const storage = new MemoryStorage();
    const locks: RecoveryLockManager = { request() { return Promise.reject(new DOMException('Denied', 'SecurityError')); } };
    const store = new RecoveryStore({ storage, locks });
    expect(await store.saveCoordinated(project())).toMatchObject({ status: 'coordination-unavailable', message: expect.stringContaining('Denied') });
    expect(await store.clearCoordinated()).toMatchObject({ status: 'coordination-unavailable' });
    expect(storage.values.size).toBe(0);
  });

  it('discovers the native navigator lock manager without an injected option', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    vi.stubGlobal('navigator', { locks });
    try {
      const store = new RecoveryStore({ storage });
      expect((await store.saveCoordinated(project())).status).toBe('saved');
      expect(locks.names).toEqual([store.lockName]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('catches a browser security error while accessing navigator.locks', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('navigator', { get locks() { throw new DOMException('Blocked getter', 'SecurityError'); } });
    try {
      const store = new RecoveryStore({ storage });
      expect(await store.saveCoordinated(project())).toMatchObject({ status: 'coordination-unavailable', message: expect.stringContaining('Blocked getter') });
      expect(storage.values.size).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it('catches an inaccessible request method without rejecting its public promise', async () => {
    const storage = new MemoryStorage();
    const locks: RecoveryLockManager = { get request(): RecoveryLockManager['request'] { throw new DOMException('Blocked method', 'SecurityError'); } };
    const store = new RecoveryStore({ storage, locks });
    expect(await store.saveCoordinated(project())).toMatchObject({ status: 'coordination-unavailable', message: expect.stringContaining('Blocked method') });
    expect(storage.values.size).toBe(0);
  });

  it('preserves source validation and storage failures inside the coordinated boundary', async () => {
    const storage = new MemoryStorage();
    const locks = new QueuedLocks();
    const store = new RecoveryStore({ storage, locks });
    const invalid = project();
    invalid.sourceHtml = '<script>bad source</script>';
    expect((await store.saveCoordinated(invalid)).status).toBe('invalid');
    expect(locks.names).toEqual([]);
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Quota full', 'QuotaExceededError'); });
    expect(await store.saveCoordinated(project())).toMatchObject({ status: 'unavailable', message: expect.stringContaining('not saved') });
    expect(storage.values.size).toBe(0);
  });

  it('retains malformed recovery even when a coordinated clear is requested', async () => {
    const storage = new MemoryStorage();
    storage.setItem(RECOVERY_KEY, 'malformed recovery');
    const store = new RecoveryStore({ storage, locks: new QueuedLocks() });
    expect((await store.clearCoordinated()).status).toBe('invalid');
    expect(storage.getItem(RECOVERY_KEY)).toBe('malformed recovery');
  });
});
