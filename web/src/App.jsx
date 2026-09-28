import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getHealth, getMe } from './api.js'
import { readToken, saveToken, clearToken, shouldLogout } from './auth.js'
import { HEALTH_CHECKING } from './health.js'
import LoginForm from './LoginForm.jsx'
import DevicesList from './DevicesList.jsx'
import RequireAuth from './RequireAuth.jsx'
import TopBar from './TopBar.jsx'

// Recharts is heavy (~350 kB) and the chart is only needed on the device page, so that page
// is built as a separate chunk and downloaded only when a device is opened.
// This keeps the first load of the devices list light.
const DeviceDetail = lazy(() => import('./DeviceDetail.jsx'))

export default function App() {
  const [apiStatus, setApiStatus] = useState(HEALTH_CHECKING)
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

  // queryClient is created once in main.jsx, so handleLogout keeps a stable identity
  // (it is a dependency of an effect in DevicesList).
  // No redirect here: once session is null, RequireAuth sends the user to /login itself.
  const handleLogout = useCallback(() => {
    clearToken()
    queryClient.clear() // the next user must not see the previous user's cached device list
    setSession(null)
  }, [queryClient])

  // Token from localStorage is only a claim. Ask /me whether the API still accepts it.
  // 401 = token rejected -> log out. Any other error (network, 5xx, cold start) -> ask again
  // after 5 s. Previously any error logged the user out.
  useEffect(() => {
    if (!session || session.user) return
    let active = true
    let timer

    const check = () => {
      getMe(session.token)
        .then((user) => { if (active) setSession((prev) => prev && { ...prev, user }) })
        .catch((err) => {
          if (!active) return
          if (shouldLogout(err)) handleLogout()
          else timer = setTimeout(check, 5000)
        })
    }
    check()

    return () => { active = false; clearTimeout(timer) }
  }, [session, handleLogout])

  function handleLogin({ user, token }) {
    saveToken(token)
    setSession({ user, token })
    navigate(location.state?.from ?? '/devices', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* No session on the login page -> onLogout is undefined -> no Log out button */}
      <TopBar apiStatus={apiStatus} onLogout={session ? handleLogout : undefined} />

      {/* Page container. max-w-5xl = 1024px. px-4 py-6 on phones, px-6 py-8 at 640px+. */}
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route
            path="/login"
            element={
              session ? (
                <Navigate to="/devices" replace />
              ) : (
                // Card is 400px wide. Top spacing: desktop main py-8 (32px) + mt-16 (64px)
                // = 96px; phone py-6 (24px) + mt-4 (16px) = 40px.
                <div className="mx-auto mt-4 w-full max-w-[400px] sm:mt-16">
                  <LoginForm onSuccess={handleLogin} />
                </div>
              )
            }
          />

          <Route
            path="/devices"
            element={
              <RequireAuth session={session}>
                {/* "Signed in as" is shown inside the DevicesList page header */}
                <DevicesList
                  token={session?.token}
                  email={session?.user?.email}
                  onAuthError={handleLogout}
                />
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
