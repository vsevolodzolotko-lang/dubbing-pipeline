import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RunStateProvider } from './api/useRunState'
import { CartProvider } from './api/cart'
import { RunMediaProvider } from './api/runMedia'
import App from './App'
// Brand fonts (offline-safe, bundled — no CDN). Lora = serif display headings
// (Cyrillic-capable), JetBrains Mono = technical text (lang codes, segment IDs).
import '@fontsource/lora/500.css'
import '@fontsource/lora/600.css'
import '@fontsource/lora/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 3000, refetchOnWindowFocus: false, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RunStateProvider>
        <CartProvider>
          <RunMediaProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </RunMediaProvider>
        </CartProvider>
      </RunStateProvider>
    </QueryClientProvider>
  </StrictMode>,
)
