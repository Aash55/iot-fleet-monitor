// web/src/main.jsx  -> ye f-step 3 pe daalni hai (P3.2)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'

// Poori app ke liye EK QueryClient = ek hi cache. Component ke andar banate to har
// render pe naya, khaali cache ban jaata aur har baar data shuru se aata.
const queryClient = new QueryClient()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
