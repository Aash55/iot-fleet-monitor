// web/vite.config.js  -> ye P6.3-f1 pe daalni hai (build pe VITE_API_URL guard)
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// VITE_API_URL build ke waqt JS mein "bake" hota hai (baad mein badalta nahi).
// Na mile to Vite chup-chaap `undefined` daal deta hai -> fetch("undefined/health")
// -> Vercel ka SPA rewrite index.html (200) lauta deta -> header "API ok" jhooth bolta.
// Isliye galat value pe BUILD HI FAIL karo. Failed deploy != down (P6.2).
function apiUrlProblem(value) {
  if (!value) return 'VITE_API_URL is missing'
  let url
  try {
    url = new URL(value)
  } catch {
    return `VITE_API_URL is not a full URL: "${value}"`
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    return `VITE_API_URL must use https (http only for localhost): "${value}"`
  }
  if (value.endsWith('/')) return `VITE_API_URL must not end with "/": "${value}"`
  return null
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    // loadEnv: .env.production files + asli environment (Vercel ka var yahin aata hai)
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const problem = apiUrlProblem(env.VITE_API_URL)
    if (problem) {
      throw new Error(`${problem}. Set it before "vite build" (Vercel: Settings -> Environment Variables).`)
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true },
  }
})
