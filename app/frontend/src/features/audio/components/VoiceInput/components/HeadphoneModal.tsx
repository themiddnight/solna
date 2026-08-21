import { Icon } from "@/shared/ui";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ConfirmDialog } from "@/features/ui";

interface HeadphoneModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onProceed: () => void;
  onCancel: () => void;
}

export function HeadphoneModal({ open, setOpen, onProceed, onCancel }: HeadphoneModalProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={t`Clean Mode - Headphone Recommendation`}
      showCancelButton={true}
      showOkButton={true}
      okText={t`Enable Clean Mode`}
      cancelText={t`Cancel`}
      onOk={onProceed}
      onCancel={onCancel}
      size="md"
    >
      <div className="space-y-4">
        <p className="text-base">
          <Trans>
            You're about to enable <strong>Clean Mode</strong> for ultra-low latency audio.
            We strongly recommend using headphones to prevent audio feedback.
          </Trans>
          <Icon name="headphones" className="inline" />
        </p>

        <div className="bg-warning/10 p-4 rounded-lg border border-warning/20">
          <h5 className="font-semibold text-sm mb-2">
            <Icon name="alert" className="inline" /> {t`Clean Mode Effects:`}
          </h5>
          <ul className="text-sm space-y-1">
            <li>• <Trans>Disables echo cancellation</Trans></li>
            <li>• <Trans>Disables noise suppression</Trans></li>
            <li>• <Trans>Raw audio for minimal latency</Trans></li>
            <li>• <strong><Trans>Higher risk of feedback without headphones</Trans></strong></li>
          </ul>
        </div>

        <div className="bg-info/10 p-4 rounded-lg">
          <h5 className="font-semibold text-sm mb-2">
            <Icon name="headphones" className="inline" /> {t`Why headphones help:`}
          </h5>
          <ul className="text-sm space-y-1">
            <li>• <Trans>Prevents audio feedback loops</Trans></li>
            <li>• <Trans>Clearer sound for everyone</Trans></li>
            <li>• <Trans>Essential for clean mode operation</Trans></li>
          </ul>
        </div>

        <p className="text-sm text-base-content/70">
          <Trans>
            Without headphones, Clean Mode may cause echo or feedback issues for other participants.
          </Trans>
        </p>
      </div>
    </ConfirmDialog>
  );
}
