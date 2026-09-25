// web/src/LoginForm.jsx  -> ye f-step P8-d pe daalni hai (P2: login form; P8-d: Claude Design card + amber error)
// P8-d mein LOGIC nahi badla: galat password pe password khaali, network error ka alag text,
// busy mein button band. Sirf dikhawat + shabd "Sign in" -> "Log in" (design).
import { useState } from 'react'
import { login } from './api.js'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
// Phone: 44px ooncha + text-base (16px, iOS zoom nahi). 640px+: 40px + text-sm.
const INPUT = `h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 sm:h-10 sm:text-sm ${FOCUS}`

export default function LoginForm({ onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const session = await login(email, password)
      onSuccess(session)
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Cannot reach the API. Is it running, and does CORS allow this origin?'
          : err.message
      )
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Log in</h1>
        <p className="text-sm text-slate-600">Fleet Monitor console</p>
      </div>

      {/* Error form ke UPAR, fields se pehle: pehle galti dikhe, phir theek karne ki jagah.
          Amber, laal nahi (laal = attack). */}
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <span
            aria-hidden="true"
            className="mt-px grid size-[18px] flex-none place-items-center rounded-full bg-amber-500 text-xs font-bold text-white"
          >
            !
          </span>
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={INPUT}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={INPUT}
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className={`h-11 w-full rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-50 sm:h-10 ${FOCUS}`}
      >
        {busy ? 'Logging in...' : 'Log in'}
      </button>
    </form>
  )
}
