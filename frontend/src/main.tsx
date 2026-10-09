import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { retryPending } from './lib/queue'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
addEventListener('online', () => retryPending())
