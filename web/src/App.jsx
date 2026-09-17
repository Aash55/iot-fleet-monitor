import { useEffect, useState } from 'react'
import { getHealth } from './api.js'

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking API...')
  useEffect(() => {
    getHealth()
      .then(setApiStatus)
      .catch(() => setApiStatus('API unreachable. Check the browser console.'))
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
        <h1 className="text-xl font-semibold">Fleet Monitor</h1>
        <p className="text-sm text-slate-300">{apiStatus}</p>
      </header>
    </div>
  )
}