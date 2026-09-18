import { useEffect, useState } from 'react'
import { getHealth, getMe } from './api.js'
import { readToken, saveToken, clearToken } from './auth.js'
import LoginForm from './LoginForm.jsx'

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking API...')
  const [session, setSession] = useState(() => {
    const token = readToken()
    return token ? { token, user: null } : null
  })

  useEffect(() => {
    getHealth()
      .then(setApiStatus)
      .catch(() => setApiStatus('API unreachable. Check the browser console.'))
  }, [])

  // Token from localStorage is only a claim. Ask /me whether the API still accepts it.
  useEffect(() => {
    if (!session || session.user) return
    let active = true

    getMe(session.token)
      .then((user) => { if (active) setSession((prev) => prev && { ...prev, user }) })
      .catch(() => {
        if (!active) return
        clearToken()
        setSession(null)
      })

    return () => { active = false }
  }, [session])

  function handleLogin({ user, token }) {
    saveToken(token)
    setSession({ user, token })
  }

  function handleLogout() {
    clearToken()
    setSession(null)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
        <h1 className="text-xl font-semibold">Fleet Monitor</h1>
        <div className="flex items-center gap-4">
          <p className="text-sm text-slate-300">{apiStatus}</p>
          {session && (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded border border-slate-500 px-3 py-1 text-sm hover:bg-slate-800"
            >
              Log out
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-md px-6 py-10">
        {session ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm">
            Signed in{session.user ? ` as ${session.user.email}` : ', verifying session...'}.
            Devices list 4.4 mein aayegi.
          </p>
        ) : (
          <LoginForm onSuccess={handleLogin} />
        )}
      </main>
    </div>
  )
}
