import type { AiProvider } from '../../domain/providers/AiProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { GlmProvider } from './GlmProvider';

export class AiProviderFactory {
  private readonly providers: Map<string, AiProvider> = new Map();

  constructor() {
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new DeepSeekProvider());
    this.registerProvider(new GlmProvider());
  }

  registerProvider(provider: AiProvider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): AiProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`AI Provider '${id}' not found`);
    }
    return provider;
  }
  
  getAvailableProviders(): string[] {
      return Array.from(this.providers.keys());
  }
}

// Singleton
export const aiProviderFactory = new AiProviderFactory();
