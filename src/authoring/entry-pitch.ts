import { parsePitch, pitchText, validateAlteration } from '../model/pitch.js';
import { PITCH_ALTERATIONS } from './notation-capabilities.js';
import { enhanceSelects } from './select.js';

export interface EntryPitchOptions {
  /** True only while the next entry is a single pitched note in an available context. */
  isEnabled: () => boolean;
  /** Recipe notification only. Called once after an actual accidental change, never for refresh or typing. */
  changed: () => void;
}

const unavailable = 'For the next entry, choose Note on a pitched staff in Write. Apply or Revert any pending Source draft first. Your pitch text is kept.';

/** The text input remains the sole pitch authority; this controller never edits accepted music. */
export class EntryPitch {
  private readonly options: EntryPitchOptions;
  private readonly input: HTMLInputElement;
  private readonly alteration: HTMLSelectElement;
  private readonly status: HTMLElement;
  private readonly abort = new AbortController();
  private failure: { raw: string; message: string } | null = null;
  private disposed = false;

  constructor(options: EntryPitchOptions, root: Document = document) {
    const input = root.getElementById('event-pitch');
    const alteration = root.getElementById('event-alteration');
    const status = root.getElementById('event-alteration-status');
    if (input?.localName !== 'input' || (input as HTMLInputElement).type !== 'text') {
      throw new Error('EntryPitch requires the #event-pitch text input.');
    }
    if (alteration?.localName !== 'select' || (alteration as HTMLSelectElement).multiple) {
      throw new Error('EntryPitch requires the native #event-alteration single-choice select.');
    }
    if (!status || status.getAttribute('role')?.trim() !== 'status') {
      throw new Error('EntryPitch requires #event-alteration-status with role="status".');
    }
    this.options = options;
    this.input = input as HTMLInputElement;
    this.alteration = alteration as HTMLSelectElement;
    this.status = status;
    enhanceSelects(this.alteration);
    for (const field of [this.input, this.alteration]) {
      const descriptions = new Set((field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
      descriptions.add(this.status.id);
      field.setAttribute('aria-describedby', [...descriptions].join(' '));
    }
    for (const type of ['input', 'change']) {
      this.input.addEventListener(type, () => this.refresh(), { signal: this.abort.signal });
    }
    this.alteration.addEventListener('change', event => {
      if (event.target === this.alteration) this.choose();
    }, { signal: this.abort.signal });
    this.refresh();
  }

  /** Read current text without normalizing aliases, changing the recipe, or notifying the parent. */
  refresh(): void {
    if (this.disposed) return;
    const raw = this.input.value;
    const enabled = this.options.isEnabled();
    this.alteration.disabled = !enabled;
    if (this.failure?.raw !== raw) this.failure = null;
    let error = '';
    try {
      this.alteration.value = String(parsePitch(raw).alter);
      this.input.removeAttribute('aria-invalid');
    } catch (problem) {
      // No selected value is safer than implying natural while the musician is still typing.
      this.alteration.selectedIndex = -1;
      this.input.setAttribute('aria-invalid', 'true');
      error = this.pitchError(problem);
    }
    this.message(!enabled ? unavailable : this.failure?.message ?? error);
  }

  dispose(): void { this.disposed = true; this.abort.abort(); }

  private choose(): void {
    if (this.disposed) return;
    // Recheck availability and parse the live text: neither a previous refresh
    // nor a previously opened native picker grants permission to change it.
    if (!this.options.isEnabled()) { this.refresh(); return; }
    const raw = this.input.value;
    let replacement: string;
    try {
      const current = parsePitch(raw);
      const choice = PITCH_ALTERATIONS.find(item => String(item.value) === this.alteration.value);
      if (!choice) throw new RangeError('Choose one of the supported accidentals.');
      const alter = validateAlteration(choice.value);
      this.failure = null;
      if (alter === current.alter) { this.refresh(); return; }
      replacement = pitchText({ ...current, alter });
    } catch (error) {
      this.failure = { raw, message: this.pitchError(error) };
      this.refresh();
      return;
    }
    this.input.value = replacement;
    this.refresh();
    // Native text events already have the parent's handlers. Do not synthesize
    // an input/change event or a musical command for a recipe-only choice.
    this.options.changed();
  }

  private pitchError(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `${detail} Your pitch text is kept.`;
  }

  private message(message: string): void {
    this.status.textContent = message;
    this.status.hidden = !message;
  }
}
