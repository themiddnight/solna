/**
 * `crypto.randomUUID` exists only in secure contexts (https/localhost); a LAN
 * http dev page on a phone lacks it. A report id is a local key, not a secret,
 * so a non-cryptographic fallback is acceptable.
 */
export function newIncidentId(source: Pick<Crypto, 'randomUUID'> | undefined = globalThis.crypto): string {
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  const rand = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `${Date.now().toString(16)}-${rand()}-${rand()}`;
}
