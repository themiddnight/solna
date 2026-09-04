/**
 * Joins class-name fragments, dropping the falsy ones and collapsing runs of
 * whitespace.
 *
 * Every primitive in this folder composes a fixed base string with optional
 * caller-supplied extras. Template interpolation leaves a double space when an
 * optional fragment is absent, which then has to be reproduced in every
 * renderToString assertion; this makes the rendered attribute the same whether
 * or not the optional prop was passed.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
