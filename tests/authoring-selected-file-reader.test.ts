// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectedFileReader } from '../src/authoring/selected-file-reader.js';

const cleanups: (() => void)[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function selectedFile(name = 'composition.json') {
  const file = new File(['same content'], name, { type: 'application/json', lastModified: 1234 });
  const pending = deferred<string>();
  const text = vi.spyOn(file, 'text').mockReturnValue(pending.promise);
  return { file, text, ...pending };
}

function fixture() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  document.body.append(input);
  const clear = vi.spyOn(input, 'value', 'set');
  const reader = new SelectedFileReader(input);
  cleanups.push(() => reader.dispose());
  const select = (...files: File[]) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
  };
  return { input, reader, select, clear };
}

afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('SelectedFileReader request ownership', () => {
  it('reads the exact selected File, keeps its identity through handling, then clears its input', async () => {
    const value = fixture();
    const selected = selectedFile();
    value.select(selected.file);
    let capturedCurrent: (() => boolean) | undefined;
    const handle = vi.fn((file: File, text: string, isCurrent: () => boolean) => {
      expect(file).toBe(selected.file);
      expect(text).toBe('accepted musical HTML');
      expect(isCurrent()).toBe(true);
      expect(value.clear).not.toHaveBeenCalled();
      capturedCurrent = isCurrent;
    });
    const result = value.reader.read(handle);
    expect(selected.text).toHaveBeenCalledOnce();
    expect(handle).not.toHaveBeenCalled();
    selected.resolve('accepted musical HTML');
    await expect(result).resolves.toBeUndefined();
    expect(handle).toHaveBeenCalledOnce();
    expect(value.clear).toHaveBeenCalledExactlyOnceWith('');
    expect(value.input.files).toHaveLength(0);
    expect(capturedCurrent?.()).toBe(false);
  });

  it('UX-FILE-READ-SUPERSESSION ignores A when B resolves first', async () => {
    const value = fixture();
    const a = selectedFile('a.json');
    const b = selectedFile('b.json');
    const handle = vi.fn();
    value.select(a.file);
    const first = value.reader.read(handle);
    value.select(b.file);
    const second = value.reader.read(handle);
    b.resolve('B');
    await second;
    a.resolve('A');
    await first;
    expect(handle).toHaveBeenCalledExactlyOnceWith(b.file, 'B', expect.any(Function));
    expect(value.clear).toHaveBeenCalledExactlyOnceWith('');
  });

  it('UX-FILE-READ-SUPERSESSION A finishing before pending B neither handles A nor clears B', async () => {
    const value = fixture();
    const a = selectedFile('a.json');
    const b = selectedFile('b.json');
    const handle = vi.fn();
    value.select(a.file);
    const first = value.reader.read(handle);
    value.select(b.file);
    const second = value.reader.read(handle);
    a.resolve('A');
    await first;
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(b.file);
    b.resolve('B');
    await second;
    expect(handle).toHaveBeenCalledExactlyOnceWith(b.file, 'B', expect.any(Function));
    expect(value.clear).toHaveBeenCalledExactlyOnceWith('');
  });

  it('suppresses a superseded read error without clearing the newer selection', async () => {
    const value = fixture();
    const a = selectedFile('a.json');
    const b = selectedFile('b.json');
    const handle = vi.fn();
    value.select(a.file);
    const first = value.reader.read(handle);
    value.select(b.file);
    const second = value.reader.read(handle);
    a.reject(new Error('Old read failed'));
    await expect(first).resolves.toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(b.file);
    b.resolve('B');
    await second;
    expect(handle).toHaveBeenCalledOnce();
  });

  it('rejects changed File identity even when all metadata match and no second read started', async () => {
    const value = fixture();
    const a = selectedFile();
    const b = selectedFile();
    expect([a.file.name, a.file.size, a.file.lastModified, a.file.type]).toEqual([b.file.name, b.file.size, b.file.lastModified, b.file.type]);
    value.select(a.file);
    const handle = vi.fn();
    const result = value.reader.read(handle);
    value.select(b.file);
    a.resolve('A');
    await result;
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(b.file);
  });

  it.each(['length', 'identity', 'order'])('captures the entire FileList before awaiting: changed %s invalidates it', async change => {
    const value = fixture();
    const a = selectedFile('a.json');
    const b = selectedFile('b.json');
    const c = selectedFile('c.json');
    value.select(a.file, b.file);
    const handle = vi.fn();
    const result = value.reader.read(handle);
    if (change === 'length') value.select(a.file);
    else if (change === 'identity') value.select(a.file, c.file);
    else value.select(b.file, a.file);
    a.resolve('A');
    await result;
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
  });

  it('accepts a new FileList wrapper retaining exactly the same File identities', async () => {
    const value = fixture();
    const a = selectedFile();
    value.select(a.file);
    const handle = vi.fn();
    const result = value.reader.read(handle);
    value.select(a.file);
    a.resolve('A');
    await result;
    expect(handle).toHaveBeenCalledExactlyOnceWith(a.file, 'A', expect.any(Function));
  });

  it('a repeated read of the same File still supersedes the previous generation', async () => {
    const value = fixture();
    const selected = selectedFile();
    const later = deferred<string>();
    selected.text.mockReturnValueOnce(selected.promise).mockReturnValueOnce(later.promise);
    value.select(selected.file);
    const handle = vi.fn();
    const first = value.reader.read(handle);
    const second = value.reader.read(handle);
    selected.resolve('Old intent');
    await first;
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
    later.resolve('New intent');
    await second;
    expect(handle).toHaveBeenCalledExactlyOnceWith(selected.file, 'New intent', expect.any(Function));
    expect(value.clear).toHaveBeenCalledExactlyOnceWith('');
  });

  it('a no-file read invalidates prior ownership even if that File is selected again', async () => {
    const value = fixture();
    const selected = selectedFile();
    const handle = vi.fn();
    value.select(selected.file);
    const first = value.reader.read(handle);
    value.select();
    await value.reader.read(handle);
    value.select(selected.file);
    selected.resolve('Old intent');
    await first;
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(selected.file);
  });

  it('does nothing when no File is selected', async () => {
    const value = fixture();
    const handle = vi.fn();
    await value.reader.read(handle);
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
  });
});

describe('SelectedFileReader callback and failure ownership', () => {
  it('keeps current ownership through an awaited callback and clears only after it finishes', async () => {
    const value = fixture();
    const selected = selectedFile();
    const entered = deferred<void>();
    const decision = deferred<void>();
    const currentChecks: boolean[] = [];
    value.select(selected.file);
    const result = value.reader.read(async (_file, _text, isCurrent) => {
      currentChecks.push(isCurrent());
      entered.resolve();
      await decision.promise;
      currentChecks.push(isCurrent());
    });
    selected.resolve('A');
    await entered.promise;
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(selected.file);
    decision.resolve();
    await result;
    expect(currentChecks).toEqual([true, true]);
    expect(value.clear).toHaveBeenCalledExactlyOnceWith('');
  });

  it('exposes a false guard after callback await when B replaces A, without clearing B', async () => {
    const value = fixture();
    const a = selectedFile('a.json');
    const b = selectedFile('b.json');
    const entered = deferred<void>();
    const decision = deferred<void>();
    const mutateProject = vi.fn();
    value.select(a.file);
    const first = value.reader.read(async (_file, _text, isCurrent) => {
      expect(isCurrent()).toBe(true);
      entered.resolve();
      await decision.promise;
      expect(isCurrent()).toBe(false);
      if (isCurrent()) mutateProject();
    });
    a.resolve('A');
    await entered.promise;
    value.select(b.file);
    const handleB = vi.fn();
    const second = value.reader.read(handleB);
    decision.resolve();
    await first;
    expect(mutateProject).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(b.file);
    b.resolve('B');
    await second;
    expect(handleB).toHaveBeenCalledExactlyOnceWith(b.file, 'B', expect.any(Function));
  });

  it('does not clear B after the obsolete A callback rejects', async () => {
    const value = fixture();
    const a = selectedFile('a.json');
    const b = selectedFile('b.json');
    const entered = deferred<void>();
    const decision = deferred<void>();
    value.select(a.file);
    const first = value.reader.read(async () => { entered.resolve(); await decision.promise; });
    a.resolve('A');
    await entered.promise;
    value.select(b.file);
    decision.reject(new Error('Old callback failed'));
    await expect(first).resolves.toBeUndefined();
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(b.file);
  });

  it.each(['read', 'synchronous callback', 'asynchronous callback'])('a current %s failure propagates the same error and clears its own input', async stage => {
    const value = fixture();
    const selected = selectedFile();
    const error = new Error('Current import failed');
    value.select(selected.file);
    const handle = vi.fn(() => {
      if (stage === 'asynchronous callback') return Promise.reject(error);
      throw error;
    });
    const result = value.reader.read(handle);
    if (stage === 'read') selected.reject(error);
    else selected.resolve('A');
    await expect(result).rejects.toBe(error);
    expect(value.clear).toHaveBeenCalledExactlyOnceWith('');
    expect(value.input.files).toHaveLength(0);
    expect(handle).toHaveBeenCalledTimes(stage === 'read' ? 0 : 1);
  });

  it('preserves the 8 MB limit and error without starting the oversized read', async () => {
    const value = fixture();
    const selected = selectedFile();
    Object.defineProperty(selected.file, 'size', { value: 8_000_001 });
    value.select(selected.file);
    const handle = vi.fn();
    await expect(value.reader.read(handle)).rejects.toThrow('This file is too large. Projects are limited to 8 MB.');
    expect(selected.text).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).toHaveBeenCalledExactlyOnceWith('');
  });

  it('accepts exactly 8_000_000 bytes', async () => {
    const value = fixture();
    const selected = selectedFile();
    Object.defineProperty(selected.file, 'size', { value: 8_000_000 });
    value.select(selected.file);
    const handle = vi.fn();
    const result = value.reader.read(handle);
    selected.resolve('Boundary');
    await result;
    expect(handle).toHaveBeenCalledExactlyOnceWith(selected.file, 'Boundary', expect.any(Function));
  });

  it.each(['resolve', 'reject'])('dispose invalidates an in-flight read before it can %s or clear the input', async outcome => {
    const value = fixture();
    const selected = selectedFile();
    value.select(selected.file);
    const handle = vi.fn();
    const result = value.reader.read(handle);
    value.reader.dispose();
    value.reader.dispose();
    if (outcome === 'resolve') selected.resolve('A');
    else selected.reject(new Error('Disposed read failed'));
    await expect(result).resolves.toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
    expect(value.input.files?.[0]).toBe(selected.file);
  });

  it('dispose invalidates a callback guard while its decision is pending', async () => {
    const value = fixture();
    const selected = selectedFile();
    const entered = deferred<void>();
    const decision = deferred<void>();
    value.select(selected.file);
    const result = value.reader.read(async (_file, _text, isCurrent) => {
      entered.resolve();
      await decision.promise;
      expect(isCurrent()).toBe(false);
    });
    selected.resolve('A');
    await entered.promise;
    value.reader.dispose();
    decision.resolve();
    await result;
    expect(value.clear).not.toHaveBeenCalled();
  });

  it('does not start another read after disposal', async () => {
    const value = fixture();
    const selected = selectedFile();
    value.select(selected.file);
    value.reader.dispose();
    const handle = vi.fn();
    await value.reader.read(handle);
    expect(selected.text).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(value.clear).not.toHaveBeenCalled();
  });
});
