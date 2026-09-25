import { Wordmark } from '@/components/ui/Wordmark';
import { useOpenAppModal } from './useAppModal';

/** The wordmark wired to the app modal — the one both frames render (R348). */
export function AppWordmark() {
  const openAppModal = useOpenAppModal();
  return <Wordmark onClick={openAppModal} />;
}
