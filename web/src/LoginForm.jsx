import { useState } from 'react'
import { login } from './api.js'

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
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Sign in</h2>

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2"
        />
      </div>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  )
}
