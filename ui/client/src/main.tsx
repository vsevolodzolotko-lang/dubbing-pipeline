import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RunStateProvider } from './api/useRunState'
import { CartProvider } from './api/cart'
import App from './App'
import './index.css'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 3000, refetchOnWindowFocus: false, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RunStateProvider>
        <CartProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </CartProvider>
      </RunStateProvider>
    </QueryClientProvider>
  </StrictMode>,
)
