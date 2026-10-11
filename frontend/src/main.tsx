import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { retryPending } from './lib/queue'

// Email links point at the home page (/?go=verify-email&token=…) because static hosting may not serve deep links.
// Move to the requested page before the router starts. Only known pages are accepted.
const go = new URLSearchParams(location.search).get('go')
if (go && ['verify-email', 'reset-password', 'forgot-password', 'login'].includes(go)) {
  const token = new URLSearchParams(location.search).get('token')
  history.replaceState(null, '', `/${go}${token ? `?token=${encodeURIComponent(token)}` : ''}`)
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
addEventListener('online', () => retryPending())
