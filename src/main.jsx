import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { lazy, Suspense, Component } from 'react'
import './index.css'
const App = lazy(() => /^\/customer(?:\/|$)/.test(window.location.pathname)
  ? import('./customer/CustomerApp.jsx') : import('./App.jsx'))
class StartupBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert">This page could not load. <button onClick={() => window.location.reload()}>Reload</button></p> : this.props.children }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StartupBoundary><Suspense fallback={<p role="status">Loading Homestead…</p>}><App /></Suspense></StartupBoundary>
  </StrictMode>,
)
