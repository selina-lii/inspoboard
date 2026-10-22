// Shows an error in one view instead of a blank window. The data is not affected:
// the store and the save cycle are outside React.

import { logError } from "./debugLog";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey?: unknown };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("View error:", error, info.componentStack);
    logError("View error", error);
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) this.setState({ error: null });
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="view-error">
        <strong>This view stopped because of an error.</strong>
        <div className="muted">Your data is safe. The error is in the console.</div>
        <code>{this.state.error.message}</code>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
