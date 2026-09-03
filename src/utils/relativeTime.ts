const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 minutes ago" / "yesterday" for list rows; the absolute time goes in a title. */
export function formatRelativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) {
    const n = Math.floor(diff / MINUTE);
    return `${n} minute${n === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return new Date(timestamp).toLocaleDateString();
}
