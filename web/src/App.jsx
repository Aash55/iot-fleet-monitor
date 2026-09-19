import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { getHealth, getMe } from './api.js'
import { readToken, saveToken, clearToken } from './auth.js'
import LoginForm from './LoginForm.jsx'
import DevicesList from './DevicesList.jsx'
import RequireAuth from './RequireAuth.jsx'

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking API...')
  const [session, setSession] = useState(() => {
    const token = readToken()
    return token ? { token, user: null } : null
  })
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    getHealth()
      .then(setApiStatus)
      .catch(() => setApiStatus('API unreachable. Check the browser console.'))
  }, [])

  // Deps khaali: identity stable rehni chahiye, DevicesList ke effect ki dependency hai.
  // Redirect yahan nahi - session null hote hi RequireAuth khud /login bhej dega.
  const handleLogout = useCallback(() => {
    clearToken()
    setSession(null)
  }, [])

  // Token from localStorage is only a claim. Ask /me whether the API still accepts it.
  useEffect(() => {
    if (!session || session.user) return
    let active = true

    getMe(session.token)
      .then((user) => { if (active) setSession((prev) => prev && { ...prev, user }) })
      .catch(() => { if (active) handleLogout() })

    return () => { active = false }
  }, [session, handleLogout])

  function handleLogin({ user, token }) {
    saveToken(token)
    setSession({ user, token })
    navigate(location.state?.from ?? '/devices', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
        <Link to="/devices" className="text-xl font-semibold hover:text-slate-300">
          Fleet Monitor
        </Link>
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

      <main className="mx-auto max-w-3xl px-6 py-10">
        <Routes>
          <Route
            path="/login"
            element={
              session ? (
                <Navigate to="/devices" replace />
              ) : (
                <div className="mx-auto max-w-md">
                  <LoginForm onSuccess={handleLogin} />
                </div>
              )
            }
          />

          <Route
            path="/devices"
            element={
              <RequireAuth session={session}>
                <p className="mb-6 text-sm text-slate-500">
                  Signed in{session?.user ? ` as ${session.user.email}` : ', verifying session...'}
                </p>
                <DevicesList token={session?.token} onAuthError={handleLogout} />
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </main>
    </div>
  )
}
