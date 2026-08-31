// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const forbiddenMethods = ['alert', 'prompt', 'confirm'] as const;
const browserGlobals = ['window', 'globalThis', 'self'] as const;
interface CallSite { api: string; line: number; column: number }

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)) expression = expression.expression;
  return expression;
}

/** Direct calls only: no execution or speculative resolution of aliases. */
function blockingDialogCalls(source: string, filename = 'example.ts'): CallSite[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const calls: CallSite[] = [];
  const forbidden = (name: string) => forbiddenMethods.some(method => method === name);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      let api: string | undefined;
      if (ts.isIdentifier(callee) && forbidden(callee.text)) api = callee.text;
      else if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const receiver = unwrap(callee.expression);
        const key = ts.isElementAccessExpression(callee) ? unwrap(callee.argumentExpression) : undefined;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
          : key && ts.isStringLiteralLike(key) ? key.text : undefined;
        if (ts.isIdentifier(receiver) && browserGlobals.some(global => global === receiver.text)
          && name && forbidden(name)) api = `${receiver.text}.${name}`;
      }
      if (api) {
        const position = file.getLineAndCharacterOfPosition(node.getStart(file));
        calls.push({ api, line: position.line + 1, column: position.character + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path)
      : entry.isFile() && /\.(?:ts|tsx|mts|cts)$/.test(entry.name) ? [path] : [];
  }).sort();
}

describe('authoring uses in-page decisions instead of blocking browser prompts', () => {
  it.each(forbiddenMethods)('detects direct %s calls, including simple bracket and optional access', method => {
    const examples = [method + '()', `(${method})?.()`, `(${method} as Function)()`];
    for (const global of browserGlobals) examples.push(
      `${global}.${method}()`, `${global}?.${method}?.()`, `${global}['${method}']()`,
      `${global}?.["${method}"]?.()`, `${global}[\`${method}\`]?.()`,
      `(${global} as Window)['${method}']?.()`, `${global}!.${method}!()`,
      `(<Window>${global}).${method}()`, `(${global} satisfies Window).${method}()`,
    );
    for (const example of examples) {
      const calls = blockingDialogCalls(example);
      expect(calls, example).toHaveLength(1);
      expect(calls[0].api.split('.').at(-1), example).toBe(method);
    }
  });

  it('reports nested calls and decoded literal keys with useful source locations', () => {
    expect(blockingDialogCalls('// Not executed.\n  window["\\u0063onfirm"](prompt("Name"));')).toEqual([
      { api: 'window.confirm', line: 2, column: 3 },
      { api: 'prompt', line: 2, column: 26 },
    ]);
  });

  it('ignores comments, strings, and other objects while permitting dialog, print, and unload protection', () => {
    const source = [
      '// window.confirm("Example only");',
      '/* alert("Example only"); self.prompt("Example only"); */',
      'const help = "Use a dialog instead of globalThis.confirm()";',
      'const example = `window["alert"]("Example only")`;',
      'const dialog = { confirm() {}, prompt() {}, alert() {} };',
      'dialog.confirm(); dialog["confirm"]?.(); dialog?.prompt(); dialog.alert();',
      'this.confirm(); editor.confirmation.confirm();',
      'dialog.showModal(); dialog.close();',
      'print(); window.print(); globalThis["print"]?.(); self?.print?.();',
      'window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = ""; });',
    ].join('\n');
    expect(blockingDialogCalls(source)).toEqual([]);
  });

  it('keeps all authoring TypeScript source free of direct alert, prompt, and confirm calls', () => {
    const directory = resolve('src/authoring');
    const files = sourceFiles(directory);
    expect(files.map(file => relative(directory, file))).toContain('main.ts');
    const violations = files.flatMap(file => blockingDialogCalls(readFileSync(file, 'utf8'), file)
      .map(call => `src/authoring/${relative(directory, file)}:${call.line}:${call.column} ${call.api}()`));
    expect(violations, 'Use the in-page ActionConfirmation dialog or inline feedback; keep browser printing and unload protection intact.').toEqual([]);
  });
});
