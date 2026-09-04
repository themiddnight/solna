import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx$/.test(name) || /\.test\.tsx$/.test(name)) return [];
    return [path];
  });
}

/**
 * Walks to the `>` that ends a JSX opening tag, ignoring `>` inside strings and
 * inside `{...}` expression containers (`onClick={() => x > 1}` is not the end
 * of the tag).
 */
function endOfOpeningTag(text: string, from: number): number {
  let i = from;
  let depth = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
    i++;
  }
  return text.length;
}

/**
 * The regression `ui/IconButton.tsx` exists for: 32 buttons whose only child
 * was an SVG icon rendered no accessible name at all — a screen reader
 * announced "button" and nothing else. Use `IconButton`, which requires a
 * label; a bare `<button>` with an icon and no `aria-label` fails here.
 *
 * Known limitations: a body that is a single `{cond ? <A/> : <B/>}` still
 * reads as text to this scanner and is skipped — Header's theme toggle was
 * the one such case and it is an IconButton; a new one would slip through.
 * Likewise a body that is a bare variable reference to a pre-built icon
 * (`<button>{icon}</button>`) has no `<[A-Z]` for the scanner to match and is
 * also skipped; no current call site does this.
 */
describe('icon-only buttons', () => {
  test('every icon-only <button> in src/ carries an aria-label', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      const re = /<button\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const end = endOfOpeningTag(text, m.index + '<button'.length);
        const open = text.slice(m.index, end + 1);
        if (open.includes('aria-label')) continue;
        const close = text.indexOf('</button>', end);
        if (close === -1) continue;
        const body = text.slice(end + 1, close).trim().replace(/\s+/g, ' ');
        if (/<span|<div/.test(body)) continue;          // has a text slot
        if (!/<[A-Z]/.test(body)) continue;             // not an icon component
        const withoutTags = body.replace(/<[^>]*>/g, '').replace(/[{}?:()/\\'"]/g, ' ').trim();
        if (withoutTags !== '') continue;               // has literal text
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line} ${body.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * `<label className="btn ...">` wrapping a hidden file input (the
   * Export/Import pattern in the preset libraries) is a button in every way
   * that matters, but jsx-a11y has no rule for it and the scan above only
   * matches `<button\b`. The label *is* the wrapped input's accessible name,
   * so an icon-only one with no `aria-label` anywhere announces as nothing —
   * `SynthPresetLibrary.tsx`'s Import control did exactly this until its
   * `<input>` gained an `aria-label`.
   */
  test('every icon-only <label className="btn ..."> in src/ carries an accessible name', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      const re = /<label\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const end = endOfOpeningTag(text, m.index + '<label'.length);
        const open = text.slice(m.index, end + 1);
        if (!/\bclassName=["'`][^"'`]*\bbtn\b/.test(open)) continue; // not button-styled
        if (open.includes('aria-label')) continue;
        const close = text.indexOf('</label>', end);
        if (close === -1) continue;
        const body = text.slice(end + 1, close);
        if (body.includes('aria-label')) continue;      // named via a wrapped child, e.g. the <input>
        const withoutInput = body.replace(/<input\b[^>]*\/?>/g, ' ').trim().replace(/\s+/g, ' ');
        if (/<span|<div/.test(withoutInput)) continue;  // has a text slot
        if (!/<[A-Z]/.test(withoutInput)) continue;      // not an icon component
        const withoutTags = withoutInput.replace(/<[^>]*>/g, '').replace(/[{}?:()/\\'"]/g, ' ').trim();
        if (withoutTags !== '') continue;                // has literal text
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line} ${withoutInput.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
