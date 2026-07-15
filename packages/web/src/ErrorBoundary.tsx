import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty">
          <p>Something broke while rendering the map.</p>
          <pre>{String(this.state.error?.stack ?? this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
