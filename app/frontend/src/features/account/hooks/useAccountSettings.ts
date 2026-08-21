import { useMutation } from "@tanstack/react-query";
import {
  updateUsername,
  type UpdateUsernameResponse,
} from "@/shared/api/auth";

interface UseAccountSettingsOptions {
  onUsernameError: (message: string) => void;
  onUsernameUpdated: (response: UpdateUsernameResponse) => void;
}

export function useAccountSettings({
  onUsernameError,
  onUsernameUpdated,
}: UseAccountSettingsOptions) {
  const updateUsernameMutation = useMutation({
    mutationFn: (newUsername: string) => updateUsername(newUsername),
    onSuccess: onUsernameUpdated,
    onError: (err: unknown) => {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      onUsernameError(
        error.response?.data?.error ||
          error.message ||
          "Failed to update username",
      );
    },
  });

  return {
    isUpdatingUsername: updateUsernameMutation.isPending,
    updateUsername: (newUsername: string) =>
      updateUsernameMutation.mutate(newUsername),
    updateUsernameMutation,
  };
}

