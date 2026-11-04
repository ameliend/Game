import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main className="error-screen">
        <h1>Une escale imprévue</h1>
        <p>{this.state.error}</p>
        <button onClick={() => window.location.reload()}>Recharger le jeu</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
