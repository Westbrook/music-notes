/** A consumer can observe state without gaining the authority to change it. */
export interface ReadonlySignal<T> { get(): T }

export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

/** Hide implementation-specific signal methods at the public state boundary. */
export function readonlySignal<T>(signal: ReadonlySignal<T>): ReadonlySignal<T> {
  return Object.freeze({ get: () => signal.get() });
}
