import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="app-shell"><div className="screen screen-centered">
      <p>Не удалось открыть экран. Попробуйте перезагрузить игру.</p>
      <button className="primary" onClick={() => window.location.reload()}>Перезагрузить</button>
    </div></div>;
  }
}
