import React from 'react';

export const ERROR_TITLE = 'Solna hit an unexpected error.';

export interface ErrorFallbackProps {
  message: string;
  stack: string | null;
  componentStack: string | null;
  /** DEV only. `import.meta.env.DEV` at the App.tsx call site. */
  showDetails: boolean;
  onRetry: () => void;
}

/**
 * The boundary's fallback. A FUNCTION component so it may use hooks later; the
 * class below must not, and that is the whole reason for the split.
 *
 * Deliberately offers no "clear storage": the single project IS the user's only
 * copy, and a crash screen is the worst possible place to hand someone a button
 * that deletes it. Retry re-renders; Refresh restarts the app.
 *
 * Role-based daisyUI tokens only (`bg-base-100`, `text-base-content`,
 * `btn-primary`, `text-error`) — no raw hex and no Tailwind palette class, so
 * it passes `bun run check:theme` in both themes.
 */
export function ErrorFallback({
  message,
  stack,
  componentStack,
  showDetails,
  onRetry,
}: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      className="h-dvh bg-base-100 text-base-content flex flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-lg font-bold text-error">{ERROR_TITLE}</h1>
      {/* The message is ALWAYS shown, unlike the stack below: in production the
          DEV-only <details> is absent, and the message is then the only clue
          the user (or a bug report quoting the screen) has to go on. */}
      <p className="max-w-md text-sm font-medium text-base-content">{message}</p>
      <p className="text-sm text-base-content/70 max-w-md">
        Retry reloads the interface while keeping your current session.
        Refreshing may lose changes that have not been saved.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </div>
      {showDetails && (
        <details className="w-full max-w-2xl text-left">
          <summary className="cursor-pointer text-xs text-base-content/60">Error details</summary>
          <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-base-content/70">
            {message}
            {stack ? `\n\n${stack}` : ''}
            {componentStack ?? ''}
          </pre>
        </details>
      )}
    </div>
  );
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches RENDER errors only. Storage failures are not exceptions here —
 * IndexedDB/localStorage unavailability is the degraded-state notice path
 * (`projectNotice`), which the app keeps running through.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, info: React.ErrorInfo): void {
    // Still logged (React logs too): a production report needs the stack, and
    // the DEV-only <details> is a convenience, not the only copy.
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): React.ReactNode {
    const { error, componentStack } = this.state;
    if (error) {
      return (
        <ErrorFallback
          message={error.message}
          stack={error.stack ?? null}
          componentStack={componentStack}
          showDetails={this.props.showDetails === true}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}
