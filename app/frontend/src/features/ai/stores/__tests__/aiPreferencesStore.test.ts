/* eslint-disable */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAiPreferencesStore } from '../aiPreferencesStore';

// Mock getDefaultModel
vi.mock('../../constants/models', () => ({
  getDefaultModel: vi.fn((provider: string) => {
    const defaults: Record<string, string> = {
      'openai': 'gpt-4',
      'anthropic': 'claude-3-opus',
      'google': 'gemini-pro',
    };
    return defaults[provider] || 'default-model';
  }),
}));

describe('aiPreferencesStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAiPreferencesStore.setState({
      selectedModels: {},
    });
    
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Initial State', () => {
    it('should have empty selectedModels by default', () => {
      const state = useAiPreferencesStore.getState();
      
      expect(state.selectedModels).toEqual({});
    });
  });

  describe('setModel', () => {
    it('should set model for a provider', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4-turbo');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['openai']).toBe('gpt-4-turbo');
    });

    it('should set models for multiple providers', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      setModel('anthropic', 'claude-3-sonnet');
      setModel('google', 'gemini-pro');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['openai']).toBe('gpt-4');
      expect(state.selectedModels['anthropic']).toBe('claude-3-sonnet');
      expect(state.selectedModels['google']).toBe('gemini-pro');
    });

    it('should update existing model for provider', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-3.5-turbo');
      setModel('openai', 'gpt-4');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['openai']).toBe('gpt-4');
    });

    it('should not affect other providers when updating one', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      setModel('anthropic', 'claude-3-opus');
      setModel('openai', 'gpt-4-turbo');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['openai']).toBe('gpt-4-turbo');
      expect(state.selectedModels['anthropic']).toBe('claude-3-opus');
    });
  });

  describe('getModel', () => {
    it('should return set model for provider', () => {
      const { setModel, getModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4-turbo');
      
      const model = getModel('openai');
      expect(model).toBe('gpt-4-turbo');
    });

    it('should return default model for provider without selection', () => {
      const { getModel } = useAiPreferencesStore.getState();
      
      const model = getModel('openai');
      expect(model).toBe('gpt-4'); // From mock
    });

    it('should return different defaults for different providers', () => {
      const { getModel } = useAiPreferencesStore.getState();
      
      const openaiModel = getModel('openai');
      const anthropicModel = getModel('anthropic');
      const googleModel = getModel('google');
      
      expect(openaiModel).toBe('gpt-4');
      expect(anthropicModel).toBe('claude-3-opus');
      expect(googleModel).toBe('gemini-pro');
    });

    it('should return default for unknown provider', () => {
      const { getModel } = useAiPreferencesStore.getState();
      
      const model = getModel('unknown-provider');
      expect(model).toBe('default-model');
    });

    it('should return set model even after multiple gets', () => {
      const { setModel, getModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4-turbo');
      
      getModel('openai');
      getModel('openai');
      const model = getModel('openai');
      
      expect(model).toBe('gpt-4-turbo');
    });
  });

  describe('clearPreferences', () => {
    it('should clear all selected models', () => {
      const { setModel, clearPreferences } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      setModel('anthropic', 'claude-3-opus');
      
      clearPreferences();
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels).toEqual({});
    });

    it('should allow setting models after clearing', () => {
      const { setModel, clearPreferences } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      clearPreferences();
      setModel('anthropic', 'claude-3-sonnet');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['anthropic']).toBe('claude-3-sonnet');
      expect(state.selectedModels['openai']).toBeUndefined();
    });

    it('should handle clearing empty preferences', () => {
      const { clearPreferences } = useAiPreferencesStore.getState();
      
      clearPreferences();
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels).toEqual({});
    });

    it('should handle multiple clear calls', () => {
      const { setModel, clearPreferences } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      clearPreferences();
      clearPreferences();
      clearPreferences();
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels).toEqual({});
    });
  });

  describe('Persistence', () => {
    it('should persist selected models to localStorage', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4-turbo');
      
      const stored = localStorage.getItem('ai-preferences');
      expect(stored).toBeTruthy();
      
      const parsed = JSON.parse(stored!);
      expect(parsed.state.selectedModels['openai']).toBe('gpt-4-turbo');
    });

    it('should persist multiple models', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      setModel('anthropic', 'claude-3-opus');
      
      const stored = localStorage.getItem('ai-preferences');
      const parsed = JSON.parse(stored!);
      
      expect(parsed.state.selectedModels['openai']).toBe('gpt-4');
      expect(parsed.state.selectedModels['anthropic']).toBe('claude-3-opus');
    });

    it('should persist after clearing', () => {
      const { setModel, clearPreferences } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      clearPreferences();
      
      const stored = localStorage.getItem('ai-preferences');
      const parsed = JSON.parse(stored!);
      
      expect(parsed.state.selectedModels).toEqual({});
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle rapid model changes', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-3.5-turbo');
      setModel('openai', 'gpt-4');
      setModel('openai', 'gpt-4-turbo');
      setModel('openai', 'gpt-4');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['openai']).toBe('gpt-4');
    });

    it('should handle set, get, clear workflow', () => {
      const { setModel, getModel, clearPreferences } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4-turbo');
      let model = getModel('openai');
      expect(model).toBe('gpt-4-turbo');
      
      clearPreferences();
      model = getModel('openai');
      expect(model).toBe('gpt-4'); // Falls back to default
    });

    it('should handle multiple providers simultaneously', () => {
      const { setModel, getModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      setModel('anthropic', 'claude-3-opus');
      setModel('google', 'gemini-pro');
      
      expect(getModel('openai')).toBe('gpt-4');
      expect(getModel('anthropic')).toBe('claude-3-opus');
      expect(getModel('google')).toBe('gemini-pro');
    });

    it('should handle setting same model multiple times', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', 'gpt-4');
      setModel('openai', 'gpt-4');
      setModel('openai', 'gpt-4');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['openai']).toBe('gpt-4');
    });

    it('should handle get before set (fallback to default)', () => {
      const { getModel, setModel } = useAiPreferencesStore.getState();
      
      const defaultModel = getModel('openai');
      expect(defaultModel).toBe('gpt-4');
      
      setModel('openai', 'gpt-4-turbo');
      const customModel = getModel('openai');
      expect(customModel).toBe('gpt-4-turbo');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string provider', () => {
      const { setModel, getModel } = useAiPreferencesStore.getState();
      
      setModel('', 'some-model');
      const model = getModel('');
      
      expect(model).toBeDefined();
    });

    it('should handle empty string model', () => {
      const { setModel } = useAiPreferencesStore.getState();
      
      setModel('openai', '');
      
      const state = useAiPreferencesStore.getState();
      expect(state.selectedModels['openai']).toBe('');
    });

    it('should handle special characters in provider name', () => {
      const { setModel, getModel } = useAiPreferencesStore.getState();
      
      setModel('provider-with-dash', 'model-1');
      setModel('provider_with_underscore', 'model-2');
      
      expect(getModel('provider-with-dash')).toBe('model-1');
      expect(getModel('provider_with_underscore')).toBe('model-2');
    });

    it('should handle very long model names', () => {
      const { setModel, getModel } = useAiPreferencesStore.getState();
      const longModelName = 'a'.repeat(1000);
      
      setModel('openai', longModelName);
      
      expect(getModel('openai')).toBe(longModelName);
    });
  });
});
