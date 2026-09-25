// web/src/App.jsx  -> ye f-step P9-e pe daalni hai (P3.3: /devices/:id route; P8-a: TopBar + naya page container; P8-b: email -> DevicesList; P8-d: login card jagah; P9-e: /me sirf 401 pe logout, baaki pe retry)
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

// Recharts bhaari hai (~350 kB). Chart sirf device page pe chahiye, isliye wo page alag
// file (chunk) mein banta hai aur tabhi download hota hai jab koi device kholo.
// Devices list ka pehla load halka rehta hai.
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

  // queryClient main.jsx mein ek hi baar banta hai, isliye handleLogout ki identity
  // stable rehti hai (DevicesList ke effect ki dependency hai).
  // Redirect yahan nahi - session null hote hi RequireAuth khud /login bhej dega.
  const handleLogout = useCallback(() => {
    clearToken()
    queryClient.clear() // agla user pichhle user ki device list cache se na dekhe
    setSession(null)
  }, [queryClient])

  // Token from localStorage is only a claim. Ask /me whether the API still accepts it.
  // P9-e: 401 = token thukraya -> logout. Baaki error (network, 5xx, cold start) -> 5 s baad
  // dobara poochho. Pehle koi bhi error logout kar deta tha.
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
      {/* Login page pe session nahi -> onLogout undefined -> Log out button nahi dikhta */}
      <TopBar apiStatus={apiStatus} onLogout={session ? handleLogout : undefined} />

      {/* P8-a: design ka container. max-w-5xl = 1024px. Phone pe px-4 py-6, 640px+ pe px-6 py-8. */}
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route
            path="/login"
            element={
              session ? (
                <Navigate to="/devices" replace />
              ) : (
                // P8-d: design - card 400px chauda. Upar ki doori: desktop main ka py-8 (32px)
                // + mt-16 (64px) = 96px; phone py-6 (24px) + mt-4 (16px) = 40px.
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
                {/* P8-b: "Signed in as" ab DevicesList ke page header ke andar (design) */}
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
