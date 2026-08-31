import { importProject, MAX_PROJECT_LENGTH, serializeProject } from './project.js';
import type { AuthorProject } from './types.js';

export const RECOVERY_KEY = 'music-notes.authoring.recovery.v1';
export interface RecoveryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
/** The two-argument Web Locks request acquires an exclusive lock. */
export interface RecoveryLockManager {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>;
}
export interface RecoveryOptions { storage?: RecoveryStorage | null; key?: string; writerId?: string; locks?: RecoveryLockManager | null }
interface RecoveryRecord { version: 1; revision: number; writer: string; savedAt: number; project: AuthorProject }
type Failure = { status: 'unavailable' | 'invalid'; message: string };
type Conflict = { status: 'conflict'; message: string };
export type RecoveryLoadResult = { status: 'empty' } | { status: 'ok'; project: AuthorProject; revision: number; writer: string; savedAt: number } | Failure;
export type RecoverySaveResult = { status: 'saved'; revision: number; savedAt: number } | Failure | Conflict;
export type RecoveryClearResult = { status: 'cleared' } | Failure | Conflict;
export type RecoveryCoordinationFailure = { status: 'coordination-unavailable'; message: string };
export type CoordinatedRecoverySaveResult = RecoverySaveResult | RecoveryCoordinationFailure;
export type CoordinatedRecoveryClearResult = RecoveryClearResult | RecoveryCoordinationFailure;

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function writerId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID()
    : `writer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readRecord(raw: string): RecoveryRecord {
  if (raw.length > MAX_PROJECT_LENGTH + 2048) throw new Error('Stored recovery exceeds the supported size.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stored recovery is not an object.');
  const record = value as Record<string, unknown>;
  const keys = ['version', 'revision', 'writer', 'savedAt', 'project'];
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) throw new Error('Stored recovery has an unsupported envelope.');
  if (record.version !== 1) throw new Error('Stored recovery uses an unsupported version.');
  if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error('Stored recovery has an invalid revision.');
  if (typeof record.writer !== 'string' || !record.writer || record.writer.length > 256 || /[\s\0]/.test(record.writer)) throw new Error('Stored recovery has an invalid writer identity.');
  if (typeof record.savedAt !== 'number' || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0) throw new Error('Stored recovery has an invalid timestamp.');
  return { version: 1, revision: record.revision, writer: record.writer, savedAt: record.savedAt, project: importProject(JSON.stringify(record.project)) };
}

/**
 * Local recovery is not a downloaded backup. Each instance has a writer ID and
 * an accepted revision. Every mutation compares the complete stored record,
 * including its writer/revision, before writing and verifies the result after.
 * A stale tab must explicitly load/reconcile the newer project before saving.
 * The synchronous APIs detect stale writers and observed races but cannot make
 * localStorage compare-and-set atomic. The coordinated APIs additionally hold
 * an exclusive same-origin Web Lock through the entire synchronous operation.
 * All cooperating tabs must use those APIs; unrelated direct storage writers
 * cannot be locked out. There is no silent fallback when Web Locks are absent.
 */
export class RecoveryStore {
  readonly key: string;
  readonly writer: string;
  readonly lockName: string;
  private readonly suppliedStorage: RecoveryStorage | null | undefined;
  private readonly suppliedLocks: RecoveryLockManager | null | undefined;
  private expectedRaw: string | null | undefined;
  private acceptance = 0;

  constructor(options: RecoveryOptions = {}) {
    this.key = options.key ?? RECOVERY_KEY;
    this.writer = options.writerId ?? writerId();
    this.suppliedStorage = options.storage;
    this.suppliedLocks = options.locks;
    this.lockName = `music-notes:recovery:${this.key}`;
    if (!this.key || this.key.length > 512) throw new Error('Recovery storage needs a nonempty key.');
    if (!this.writer || this.writer.length > 256 || /[\s\0]/.test(this.writer)) throw new Error('Recovery writer ID must be nonempty and contain no whitespace.');
  }

  private storage(): RecoveryStorage {
    const storage = this.suppliedStorage === undefined ? globalThis.localStorage : this.suppliedStorage;
    if (!storage) throw new Error('Local recovery storage is unavailable in this browser.');
    return storage;
  }

  load(): RecoveryLoadResult {
    let raw: string | null;
    try { raw = this.storage().getItem(this.key); }
    catch (error) { return { status: 'unavailable', message: `Cannot read local recovery: ${message(error)} Keep a downloaded project backup.` }; }
    if (raw === null) { this.expectedRaw = null; this.acceptance++; return { status: 'empty' }; }
    try {
      const record = readRecord(raw);
      this.expectedRaw = raw;
      this.acceptance++;
      return { status: 'ok', project: record.project, revision: record.revision, writer: record.writer, savedAt: record.savedAt };
    } catch (error) {
      // Do not delete, replace, or accept malformed storage as an empty slot.
      return { status: 'invalid', message: `Stored recovery could not be opened: ${message(error)} The stored data has been left untouched; download the current project before choosing another recovery.` };
    }
  }

  private async coordinated<T>(operation: () => T): Promise<T | Conflict | RecoveryCoordinationFailure> {
    const acceptedAtRequest = this.acceptance;
    let locks: RecoveryLockManager | null | undefined;
    try {
      locks = this.suppliedLocks === undefined ? globalThis.navigator?.locks : this.suppliedLocks;
      if (!locks || typeof locks.request !== 'function') {
        return { status: 'coordination-unavailable', message: 'This browser cannot coordinate recovery across tabs because Web Locks are unavailable. Local recovery was not changed. Download this project; any single-tab recovery fallback must be chosen explicitly.' };
      }
    } catch (error) {
      return { status: 'coordination-unavailable', message: `Cannot access browser coordination: ${message(error)} Local recovery was not changed. Download this project to preserve your work.` };
    }
    try {
      return await locks.request(this.lockName, () => {
        // A user may open another recovery while this request waits. Never
        // apply the earlier snapshot against that newly accepted baseline.
        if (this.acceptance !== acceptedAtRequest) return { status: 'conflict' as const, message: 'Recovery was reopened while this operation waited for another tab. The queued operation was not applied; review the current project before saving again.' };
        return operation();
      });
    } catch (error) {
      return { status: 'coordination-unavailable', message: `Recovery coordination could not complete: ${message(error)} No coordinated save or clear was confirmed. Keep a downloaded project backup.` };
    }
  }

  /**
   * Capture this request's project before waiting for other tabs. A successful
   * result only covers that snapshot: callers must still track newer edits.
   * Do not depend on this asynchronous method finishing during pagehide.
   */
  async saveCoordinated(project: AuthorProject): Promise<CoordinatedRecoverySaveResult> {
    let snapshot: AuthorProject;
    try { snapshot = importProject(serializeProject(project)); }
    catch (error) { return { status: 'invalid', message: `This project cannot be saved: ${message(error)}` }; }
    return this.coordinated(() => this.save(snapshot));
  }

  async clearCoordinated(): Promise<CoordinatedRecoveryClearResult> {
    return this.coordinated(() => this.clear());
  }

  private check(raw: string | null): { record: RecoveryRecord | null } | Failure | Conflict {
    let record: RecoveryRecord | null = null;
    if (raw !== null) {
      try { record = readRecord(raw); }
      catch (error) { return { status: 'invalid', message: `Existing recovery is invalid and was left untouched: ${message(error)} Download the current project to preserve it.` }; }
    }
    if ((this.expectedRaw === undefined && raw !== null) || (this.expectedRaw !== undefined && raw !== this.expectedRaw)) {
      return { status: 'conflict', message: 'Local recovery changed in another tab or session. It was not overwritten. Download this project, then open and reconcile the newer recovery before saving again.' };
    }
    return { record };
  }

  save(project: AuthorProject): RecoverySaveResult {
    let validated: AuthorProject;
    try { validated = importProject(serializeProject(project)); }
    catch (error) { return { status: 'invalid', message: `This project cannot be saved: ${message(error)}` }; }
    let storage: RecoveryStorage;
    let raw: string | null;
    try { storage = this.storage(); raw = storage.getItem(this.key); }
    catch (error) { return { status: 'unavailable', message: `Cannot access local recovery: ${message(error)} Download the project to preserve your work.` }; }
    const checked = this.check(raw);
    if ('status' in checked) return checked;
    const revision = (checked.record?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) return { status: 'invalid', message: 'Local recovery revision is exhausted; download this project before resetting recovery.' };
    const savedAt = Date.now();
    const next = JSON.stringify({ version: 1, revision, writer: this.writer, savedAt, project: validated } satisfies RecoveryRecord);
    try { storage.setItem(this.key, next); }
    catch (error) { return { status: 'unavailable', message: `Local recovery was not saved: ${message(error)} Download the project to preserve your work.` }; }
    this.expectedRaw = next;
    try {
      if (storage.getItem(this.key) !== next) return { status: 'conflict', message: 'Another writer changed local recovery during this save. Your save was not confirmed. Download this project and reconcile the newer recovery.' };
    } catch (error) { return { status: 'unavailable', message: `The recovery write could not be verified: ${message(error)} Download the project to preserve your work.` }; }
    return { status: 'saved', revision, savedAt };
  }

  clear(): RecoveryClearResult {
    let storage: RecoveryStorage;
    let raw: string | null;
    try { storage = this.storage(); raw = storage.getItem(this.key); }
    catch (error) { return { status: 'unavailable', message: `Cannot access local recovery: ${message(error)}` }; }
    const checked = this.check(raw);
    if ('status' in checked) return checked;
    try {
      storage.removeItem(this.key);
      this.expectedRaw = null;
      if (storage.getItem(this.key) !== null) return { status: 'conflict', message: 'Local recovery changed while clearing it; newer data was not removed again.' };
      return { status: 'cleared' };
    } catch (error) { return { status: 'unavailable', message: `Could not confirm that local recovery was cleared: ${message(error)}` }; }
  }
}
