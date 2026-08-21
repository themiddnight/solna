/**
 * Last-resort fallback model per provider, used only when neither the request
 * nor the {PROVIDER}_DEFAULT_MODEL env var specifies one. Provider model IDs are
 * retired/renamed often — when a default here starts failing, the no-redeploy fix
 * is to set the matching env var (OPENAI_DEFAULT_MODEL / GEMINI_DEFAULT_MODEL /
 * DEEPSEEK_DEFAULT_MODEL / GLM_DEFAULT_MODEL); update these literals on the next deploy.
 */
export const PROVIDER_DEFAULT_MODELS: Record<'openai' | 'gemini' | 'deepseek' | 'glm', string> = {
  openai: 'gpt-5.4-nano',
  gemini: 'gemini-2.5-flash-lite',
  deepseek: 'deepseek-v4-flash',
  glm: 'glm-4.5-flash',
};
