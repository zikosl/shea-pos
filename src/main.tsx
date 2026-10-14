import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/urbanist/400.css";
import "@fontsource/urbanist/500.css";
import "@fontsource/urbanist/600.css";
import "@fontsource/urbanist/700.css";
import "@fontsource/zain/400.css";
import "@fontsource/zain/700.css";
import App from "./App";
import "./styles.css";

class RendererErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Shea POS renderer failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="renderer-failure" role="alert">
          <h1>Shea POS could not display this screen</h1>
          <p>The error has been recorded. Restart the screen to try again.</p>
          <details>
            <summary>Technical details</summary>
            <pre>{this.state.error.message}</pre>
          </details>
          <button type="button" onClick={() => window.location.reload()}>
            Restart Shea POS
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>,
);
