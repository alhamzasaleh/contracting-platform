import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * React calls whatever an effect returns as its cleanup. A DOM call like scrollIntoView / scrollTo /
 * focus may return a value (newer Chrome: a Promise) — React then calls it and the whole page
 * crashes (the assistant, Nov 2026). An effect must return nothing, or a cleanup function.
 * Read from the code's syntax tree (any formatting): a concise body must be a function / a name /
 * a property reference; a block body may only `return;` or return one of those; no async effects.
 */
const EFFECTS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
}
const cleanupLike = (e: ts.Expression): boolean => {
  const x = ts.isParenthesizedExpression(e) ? e.expression : e;
  return ts.isArrowFunction(x) || ts.isFunctionExpression(x) || ts.isIdentifier(x) || ts.isPropertyAccessExpression(x);
};

export function effectProblems(source: string, file = "x.tsx"): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const fn = n.arguments[0];
      if (EFFECTS.has(name) && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        const where = `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
        if (fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) out.push(`${where} async effect`);
        if (!ts.isBlock(fn.body)) {
          if (!cleanupLike(fn.body)) out.push(`${where} returns ${fn.body.getText().slice(0, 60)}`);
        } else {
          const own = (m: ts.Node): void => {
            if (ts.isFunctionLike(m) && m !== fn) return; // a nested function's returns are its own
            if (ts.isReturnStatement(m) && m.expression && !cleanupLike(m.expression)) out.push(`${where} returns ${m.expression.getText().slice(0, 60)}`);
            ts.forEachChild(m, own);
          };
          ts.forEachChild(fn.body, own);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("effects return nothing or a cleanup function", () => {
  it("catches every way of returning a call's value, and accepts real cleanups", () => {
    const bad = [
      `useEffect(() => el.current?.scrollIntoView({ behavior: "smooth" }), [n]);`,
      `React.useEffect(() =>\n  el.current?.scrollIntoView({ behavior: "smooth" }),\n  [n],\n);`,
      `useInsertionEffect(() => el.scrollIntoView())`,
      `useEffect((): void => el.focus(), [a[0]])`,
      `useEffect(() => { return el.scrollIntoView(); }, [n])`,
      `useEffect(async () => { await x(); }, [])`,
    ];
    for (const s of bad) expect(effectProblems(s), s).not.toEqual([]);
    const good = [
      `useEffect(() => { el.scrollIntoView(); }, [n])`,
      `useEffect(() => () => clearTimeout(t), [])`,
      `useEffect(() => dropDoc, [])`,
      `useEffect(() => sub.unsubscribe, [])`,
      `useEffect(() => { if (!x) return; const f = () => 1; return () => f(); }, [x])`,
      `useEffect(() => { const g = () => { return 5; }; g(); }, [])`,
    ];
    for (const s of good) expect(effectProblems(s), s).toEqual([]);
  });
  it("no effect in the app returns anything but a cleanup", () => {
    expect(files("src").flatMap((f) => effectProblems(fs.readFileSync(f, "utf8"), f))).toEqual([]);
  });
});
