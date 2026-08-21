import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAiSettings,
  updateAiSettings,
  type AiSettings,
  type AiSettingsResponse,
  type UpdateAiSettingsRequest,
} from "@/shared/api/aiSettings";
import { queryKeys } from "@/shared/api/queryKeys";
import { useUserStore } from "@/shared/stores/userStore";

/**
 * Shared AI provider settings query.
 *
 * Dedupes the fetch across all consumers (settings editor, generation popup,
 * step sequencer, multitrack view) into a single cached request. Transport-level
 * retries are handled by axios-retry; see docs/DATA_FETCHING_POLICY.md.
 *
 * Gated on authentication: AI settings are per-user and guests cannot store them,
 * so the endpoint always 401s for guests. Skipping the request avoids the console
 * noise and a pointless round-trip; `useIsAiEnabled` then resolves to false.
 */
export function useAiSettings() {
  const isAuthenticated = useUserStore((state) => state.isAuthenticated);
  return useQuery<AiSettings>({
    queryKey: queryKeys.aiSettings.all,
    queryFn: async () => (await getAiSettings()).settings,
    enabled: isAuthenticated,
  });
}

/** Whether AI generation is usable (provider enabled AND an API key is stored). */
export function useIsAiEnabled(): boolean {
  const { data } = useAiSettings();
  return data?.enabled === true && data.hasApiKey === true;
}

/**
 * Update AI provider settings. On success the shared cache is updated in place so
 * every `useAiSettings` consumer reflects the change without an extra round-trip.
 */
export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAiSettingsRequest) => updateAiSettings(data),
    onSuccess: (response: AiSettingsResponse) => {
      queryClient.setQueryData(queryKeys.aiSettings.all, response.settings);
    },
  });
}
