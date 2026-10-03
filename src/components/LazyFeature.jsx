import { Component, Suspense, lazy, useMemo, useState } from 'react';
import { createFeatureLoader } from '../utils/feature-loaders.js';
export function FeatureReloadButton() {
  return <button type="button" className="secondary-button" onClick={() => window.location.reload()}>Reload app</button>;
}
class FeatureErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn(`${this.props.label} could not load`, error); }
  render() {
    if (this.state.failed) return <div role="alert"><p>Could not load {this.props.label}. Retry, or reload the app if it still fails.</p><button type="button" className="secondary-button" onClick={this.props.onRetry}>Retry</button> <FeatureReloadButton /></div>;
    return this.props.children;
  }
}
export function lazyFeature(load, label) {
  const loadModule = createFeatureLoader(load);
  return function Feature(props) {
    const [attempt, setAttempt] = useState(0);
    const Loaded = useMemo(() => lazy(loadModule), [attempt]);
    return <FeatureErrorBoundary key={attempt} label={label} onRetry={() => setAttempt((value) => value + 1)}>
      <Suspense fallback={<p className="small-muted" role="status">Loading {label}…</p>}><Loaded {...props} /></Suspense>
    </FeatureErrorBoundary>;
  };
}
