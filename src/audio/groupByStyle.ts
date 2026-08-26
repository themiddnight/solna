/**
 * Groups pattern rows by their `style` for the style-grouped select UIs,
 * preserving first-appearance order. Extracted because bassPatterns.ts and
 * rhythmPatterns.ts carried this same IIFE character for character.
 */
export function groupByStyle<T extends { style: string }>(
  items: readonly T[],
): { style: string; patterns: T[] }[] {
  const byStyle = new Map<string, T[]>();
  for (const item of items) {
    const list = byStyle.get(item.style);
    if (list) list.push(item);
    else byStyle.set(item.style, [item]);
  }
  return Array.from(byStyle, ([style, patterns]) => ({ style, patterns }));
}
