import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { PROVIDER_DEFAULT_MODELS } from '../../domain/providerDefaults';

// GLM (Z.ai) is OpenAI-API-compatible; not a GPT-5.x model so it always uses plain `max_tokens`.
export class GlmProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      id: 'glm',
      displayName: 'GLM',
      baseURL: 'https://api.z.ai/api/paas/v4/',
      defaultModel: PROVIDER_DEFAULT_MODELS.glm,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      tokenParam: () => ({ 'max_tokens': 8192 }),
    });
  }
}
