import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Stay independent of the Electron bridge so this fallback can mount even
    // when the bridge itself is unavailable. Do not upload error details.
    console.error('Renderer failed', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="card" role="alert" style={{ margin: 24 }}>
        <h1>Mechvibes could not display this window</h1>
        <p>Your soundpacks and settings have not been deleted. Reload to try again.</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload window
        </button>
      </main>
    );
  }
}
