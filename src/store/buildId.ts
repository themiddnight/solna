/** Overridable at build time; reports name the build so a duplicate search can match it. */
export const BUILD_ID = String(import.meta.env.VITE_BUILD_ID ?? 'dev');
