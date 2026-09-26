import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SCALES, SCALE_CATEGORIES } from '@/data/scales';
import { ScaleTypeOptions } from './ScaleTypeOptions';

// No store read: the options are static content, so renderToString sees
// exactly what the browser gets (the R257 trap does not apply).
const html = renderToString(
  <select>
    <ScaleTypeOptions />
  </select>,
);

/** `[label, optionValues[]]` for each optgroup, in document order. */
function groups(markup: string): [string, string[]][] {
  // renderToString escapes `&` in the label (Jazz & Other).
  return [...markup.matchAll(/<optgroup label="([^"]*)">(.*?)<\/optgroup>/g)].map(([, label, body]) => [
    label.replaceAll('&amp;', '&'),
    [...body.matchAll(/<option value="([^"]*)"/g)].map(([, value]) => value),
  ]);
}

describe('ScaleTypeOptions', () => {
  test('one optgroup per category, in SCALE_CATEGORIES order', () => {
    expect(groups(html).map(([label]) => label)).toEqual([...SCALE_CATEGORIES]);
  });

  test('every SCALES key is one option, in SCALES order, under its own category', () => {
    const rendered = groups(html);
    expect(rendered.flatMap(([, values]) => values)).toEqual(Object.keys(SCALES));
    for (const [label, values] of rendered) {
      for (const key of values) expect(SCALES[key].category, key).toBe(label);
    }
  });

  test('an option shows the display name and keeps the key as its value', () => {
    expect(html).toContain('<option value="Locrian #2">Locrian ♯2</option>');
    expect(html).toContain('<option value="Blues">Minor Blues</option>');
    expect(html).toContain('<option value="Natural Minor">Minor (Natural)</option>');
  });
});
