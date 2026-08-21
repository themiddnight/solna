import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { PROVIDER_DEFAULT_MODELS } from '../../domain/providerDefaults';

// GPT-5.x on Chat Completions expects `max_completion_tokens`, not `max_tokens`.
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      id: 'openai',
      displayName: 'OpenAI',
      defaultModel: PROVIDER_DEFAULT_MODELS.openai,
      tokenParam: (model) =>
        model.startsWith('gpt-5')
          // eslint-disable-next-line @typescript-eslint/naming-convention
          ? { 'max_completion_tokens': 8192 }
          // eslint-disable-next-line @typescript-eslint/naming-convention
          : { 'max_tokens': 8192 },
    });
  }
}
