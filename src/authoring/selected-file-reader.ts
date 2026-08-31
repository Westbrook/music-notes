/** Reads the latest file choice without authorizing or mutating a project. */
export class SelectedFileReader {
  private readonly input: HTMLInputElement;
  private generation = 0;
  private disposed = false;

  constructor(input: HTMLInputElement) { this.input = input; }

  async read(handle: (file: File, text: string, isCurrent: () => boolean) => void | Promise<void>): Promise<void> {
    const generation = ++this.generation;
    if (this.disposed) return;
    // Claim the choice before any asynchronous work. Metadata and FileList
    // wrapper identity do not distinguish one selection from another.
    const files = Array.from(this.input.files ?? []);
    const file = files[0];
    if (!file) return;
    let finished = false;
    const isCurrent = (): boolean => {
      if (finished || this.disposed || generation !== this.generation) return false;
      const current = this.input.files;
      return !!current && current.length === files.length && files.every((selected, index) => current[index] === selected);
    };
    try {
      if (file.size > 8_000_000) throw new Error('This file is too large. Projects are limited to 8 MB.');
      const text = await file.text();
      // The handler must check again after its own asynchronous confirmation.
      if (isCurrent()) await handle(file, text, isCurrent);
    } catch (error) {
      // An obsolete read or dialog must not report an error for a newer choice.
      if (isCurrent()) throw error;
    } finally {
      const ownsInput = isCurrent();
      finished = true;
      if (ownsInput) this.input.value = '';
    }
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
  }
}
