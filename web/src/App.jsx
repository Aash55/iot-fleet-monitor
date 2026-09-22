// web/src/App.jsx  -> ye f-step 3 pe daalni hai (P3.3: /devices/:id route)
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getHealth, getMe } from './api.js'
import { readToken, saveToken, clearToken } from './auth.js'
import LoginForm from './LoginForm.jsx'
import DevicesList from './DevicesList.jsx'
import RequireAuth from './RequireAuth.jsx'

// Recharts bhaari hai (~350 kB). Chart sirf device page pe chahiye, isliye wo page alag
// file (chunk) mein banta hai aur tabhi download hota hai jab koi device kholo.
// Devices list ka pehla load halka rehta hai.
const DeviceDetail = lazy(() => import('./DeviceDetail.jsx'))

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking API...')
  const [session, setSession] = useState(() => {
    const token = readToken()
    return token ? { token, user: null } : null
  })
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  useEffect(() => {
    getHealth()
      .then(setApiStatus)
      .catch(() => setApiStatus('API unreachable. Check the browser console.'))
  }, [])

  // queryClient main.jsx mein ek hi baar banta hai, isliye handleLogout ki identity
  // stable rehti hai (DevicesList ke effect ki dependency hai).
  // Redirect yahan nahi - session null hote hi RequireAuth khud /login bhej dega.
  const handleLogout = useCallback(() => {
    clearToken()
    queryClient.clear() // agla user pichhle user ki device list cache se na dekhe
    setSession(null)
  }, [queryClient])

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

          <Route
            path="/devices/:id"
            element={
              <RequireAuth session={session}>
                <Suspense fallback={<p className="text-sm text-slate-500">Loading device...</p>}>
                  <DeviceDetail token={session?.token} onAuthError={handleLogout} />
                </Suspense>
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </main>
    </div>
  )
}
