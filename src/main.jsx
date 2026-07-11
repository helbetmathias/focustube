import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// YouTube rejects some licensed embeds when the local referring origin is the
// numeric loopback address, while the same videos work from the canonical
// localhost origin. Production hosts are left untouched.
if (window.location.hostname === '127.0.0.1') {
  const canonicalUrl = new URL(window.location.href)
  canonicalUrl.hostname = 'localhost'
  window.location.replace(canonicalUrl.href)
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
