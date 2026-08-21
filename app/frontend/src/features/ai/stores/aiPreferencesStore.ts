import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getDefaultModel } from "../constants/models";

interface AiPreferencesState {
  // Store selected model per provider
  selectedModels: Record<string, string>; // provider -> model

  // Actions
  setModel: (provider: string, model: string) => void;
  getModel: (provider: string) => string;
  clearPreferences: () => void;
}

export const useAiPreferencesStore = create<AiPreferencesState>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedModels: {},

      // Set model for a provider
      setModel: (provider: string, model: string) => {
        set((state) => ({
          selectedModels: {
            ...state.selectedModels,
            [provider]: model,
          },
        }));
      },

      // Get model for a provider, fallback to default if not set
      getModel: (provider: string) => {
        const { selectedModels } = get();
        return selectedModels[provider] || getDefaultModel(provider);
      },

      // Clear all preferences
      clearPreferences: () => {
        set({ selectedModels: {} });
      },
    }),
    {
      name: "ai-preferences", // localStorage key
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

