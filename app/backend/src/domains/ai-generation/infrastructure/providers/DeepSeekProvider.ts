import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { PROVIDER_DEFAULT_MODELS } from '../../domain/providerDefaults';

// DeepSeek is OpenAI-API-compatible; not a GPT-5.x model so it always uses plain `max_tokens`.
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      id: 'deepseek',
      displayName: 'DeepSeek',
      baseURL: 'https://api.deepseek.com',
      defaultModel: PROVIDER_DEFAULT_MODELS.deepseek,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      tokenParam: () => ({ 'max_tokens': 8192 }),
    });
  }
}
