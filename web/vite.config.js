import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// VITE_API_URL is baked into the JS at build time (it cannot change later).
// If it is missing, Vite silently inserts `undefined` -> fetch("undefined/health")
// -> Vercel's SPA rewrite returns index.html (200) -> the header falsely says "API ok".
// So a bad value FAILS THE BUILD. A failed deploy is not the same as a site that is down.
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
    // loadEnv: .env.production files + the real environment (where Vercel's variable comes from)
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
