/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useState, useEffect } from "react";
import { t } from "@lingui/core/macro";
import { Select, Switch } from "@/features/ui";
import { useAiSettings, useUpdateAiSettings } from "../hooks/useAiSettings";
import { MODELS_BY_PROVIDER } from "../constants/models";

interface AiSettingsSectionProps {
  inline?: boolean;
}

export function AiSettingsSection({ inline = false }: AiSettingsSectionProps) {
  // Shared cached AI settings query + mutation (see useAiSettings)
  const { data: settings, isLoading, isError: isLoadError } = useAiSettings();
  const updateMutation = useUpdateAiSettings();

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form state
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setEnabled] = useState(false);

  // Derived: key-acquisition URL hint for the selected provider
  const keyUrl = MODELS_BY_PROVIDER.find((item) => item.value === provider)?.apiKeyUrl ?? "";

  // Seed the form from the loaded settings (apiKey is never returned, so clear it)
  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setEnabled(settings.enabled);
    setApiKey("");
  }, [settings]);

  const handleSave = async () => {
    setError("");
    setSuccess("");

    try {
      await updateMutation.mutateAsync({
        provider,
        enabled: isEnabled,
        apiKey: apiKey || undefined, // Send undefined if empty to not update
      });

      setApiKey(""); // Clear input after save
      setSuccess(t`Settings saved successfully`);

      // Clear success message after 3s
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: unknown) {
      console.error("Failed to save AI settings:", err);
      const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
      setError(apiErr.response?.data?.error || t`Failed to save settings`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <span className="loading loading-spinner loading-md"></span>
      </div>
    );
  }

  const content = (
    <>
      {!inline && (
        <>
          <h3 className="card-title text-lg">{t`AI Assistant Settings`}</h3>
          <p className="text-sm text-base-content/70 mb-4">
            {t`Configure AI provider to enable note generation features in Arrange and Perform rooms. Your API key is encrypted and stored securely.`}
          </p>
        </>
      )}

      <div className={`form-control ${inline ? 'lg:col-span-2' : ''}`}>
        <label className="label cursor-pointer justify-start gap-4">
          <span className="label-text font-medium">{t`Enable AI Features`}</span>
          <Switch
            checked={isEnabled}
            onCheckedChange={setEnabled}
            aria-label={t`Enable AI Features`}
          />
        </label>
      </div>

      {isEnabled && (
        <div className={`${inline ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-4'}`}>
          <div className="form-control w-full">
            <label className="label">
              <span className="label-text">{t`Provider`}</span>
            </label>
            <Select.Simple
              className="w-full"
              value={provider}
              onValueChange={(value) => setProvider(value)}
              ariaLabel={t`Provider`}
              options={MODELS_BY_PROVIDER.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </div>

          <div className="form-control w-full">
            <label className="label">
              <span className="label-text">{t`API Key`}</span>
              {settings?.hasApiKey && (
                <span className="label-text-alt text-success">
                  {t`✓ Saved`}
                </span>
              )}
            </label>
            <input
              type="password"
              className="input input-bordered w-full"
              placeholder={settings?.hasApiKey ? "••••••••••••••••" : t`Enter API Key`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {keyUrl && (
              <label className="label">
                <span className="label-text-alt text-base-content/60">
                  {t`Get your key from ${keyUrl}`}
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {(error || isLoadError) && (
        <div className={`alert alert-error text-sm py-2 ${inline ? 'lg:col-span-2' : ''}`}>
          <span>{error || t`Failed to load AI settings`}</span>
        </div>
      )}

      {success && (
        <div className={`alert alert-success text-sm py-2 ${inline ? 'lg:col-span-2' : ''}`}>
          <span>{success}</span>
        </div>
      )}

      <div className={`${inline ? 'lg:col-span-2 flex justify-end' : 'card-actions justify-end'} mt-2`}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? <span className="loading loading-spinner loading-xs"></span> : t`Save Settings`}
        </button>
      </div>
    </>
  );

  if (inline) {
    return content;
  }

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body p-4">
        {content}
      </div>
    </div>
  );
}
