/**
 * Explicit immutable artwork, imported by its caller. There is no runtime name
 * registry: bundlers can remove every definition the application does not use.
 */
export interface IconDefinition {
  readonly name: string;
  readonly viewBox: string;
  readonly paths: readonly string[];
}
