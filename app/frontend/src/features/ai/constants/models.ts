export interface AiProvider {
  value: string;
  label: string;
  description?: string;
  apiKeyUrl: string;
  models: AiModel[];
}

export interface AiModel {
  value: string;
  label: string;
  description?: string;
}

export const MODELS_BY_PROVIDER: AiProvider[] = [
  {
    value: "gemini",
    label: "Gemini (Google)",
    description: "Google's AI model",
    apiKeyUrl: "aistudio.google.com/apikey",
    models: [
      {
        value: "gemini-2.5-flash-lite",
        label: "Gemini 2.5 Flash-Lite",
        description: "Cheapest, fastest, low latency"
      },
      {
        value: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        description: "Balanced price/performance"
      },
      {
        value: "gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash-Lite",
        description: "Newer gen, frontier perf at low cost"
      },
      {
        value: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        description: "Most capable flash, higher cost"
      },
      {
        value: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        description: "Complex reasoning, highest cost"
      },
    ],
  },
  {
    value: "openai",
    label: "ChatGPT (OpenAI)",
    description: "OpenAI's AI model",
    apiKeyUrl: "platform.openai.com/api-keys",
    models: [
      {
        value: "gpt-5.4-nano",
        label: "GPT-5.4 Nano",
        description: "Cheapest, fast, high-volume"
      },
      {
        value: "gpt-5.4-mini",
        label: "GPT-5.4 Mini",
        description: "Cost-effective small model"
      },
      {
        value: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        description: "Cost-optimized frontier model"
      },
      {
        value: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        description: "Balances intelligence and cost"
      },
      {
        value: "gpt-5.6-sol",
        label: "GPT-5.6",
        description: "Flagship, highest quality"
      },
    ],
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek's AI model",
    apiKeyUrl: "platform.deepseek.com/api_keys",
    models: [
      {
        value: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        description: "Fast and cheapest, supports JSON output"
      },
      {
        value: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        description: "Deeper reasoning and coding"
      },
    ],
  },
  {
    value: "glm",
    label: "GLM (Z.ai)",
    description: "Z.ai's GLM model",
    apiKeyUrl: "z.ai/manage-apikey/apikey-list",
    models: [
      {
        value: "glm-4.5-flash",
        label: "GLM-4.5 Flash",
        description: "Free tier, supports JSON output"
      },
      {
        value: "glm-4.7-flash",
        label: "GLM-4.7 Flash",
        description: "Free tier, newer"
      },
      {
        value: "glm-4.5-air",
        label: "GLM-4.5 Air",
        description: "Lightweight, low-cost"
      },
      {
        value: "glm-4.6",
        label: "GLM-4.6",
        description: "200K context, strong general"
      },
      {
        value: "glm-4.7",
        label: "GLM-4.7",
        description: "Newer mid-tier"
      },
      {
        value: "glm-5.2",
        label: "GLM-5.2",
        description: "Flagship, most capable"
      },
    ],
  },
];

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: string): string {
  const model = MODELS_BY_PROVIDER.find(p => p.value === provider)?.models[0]?.value ?? "";
  return model;
}

/**
 * Get models for a provider
 */
export function getModelsForProvider(provider: string): AiModel[] {
  return MODELS_BY_PROVIDER.find(p => p.value === provider)?.models ?? [];
}
