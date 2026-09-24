// web/src/ModeToggle.jsx  -> ye f-step P7-f4b pe daalni hai (NAYI file)
// Device page pe Detect | Prevent. Click -> PATCH /devices/:id -> jawab ka naya device
// parent ko (onChanged), jo cache mein daal deta hai. Screen tabhi badalti hai jab SERVER
// haan bol de - pehle se "prevent" dikha dena (optimistic) galat hota agar PATCH fail ho.
import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { setDeviceMode } from './api.js'

const MODES = [
  { value: 'detect', label: 'Detect', help: 'Alerts only. Every reading is accepted.' },
  { value: 'prevent', label: 'Prevent', help: 'Readings the model scores 0.90 or higher are blocked.' },
]

export default function ModeToggle({ token, device, onChanged, onAuthError }) {
  const mutation = useMutation({
    mutationFn: (mode) => setDeviceMode(token, device.id, mode),
    onSuccess: onChanged,
  })

  const authFailed = mutation.error?.status === 401
  useEffect(() => {
    if (authFailed) onAuthError()
  }, [authFailed, onAuthError])

  // Purana API (mode field hi nahi) -> toggle mat dikhao, galat "detect" dikhana jhooth hoga.
  if (!MODES.some((m) => m.value === device.mode)) return null

  const current = MODES.find((m) => m.value === device.mode)
  const error = mutation.isError && !authFailed
    ? (mutation.error instanceof TypeError
        ? 'Cannot reach the API. Mode was not changed.'
        : mutation.error.message)
    : ''

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Mode</span>
        <div role="group" aria-label="Device mode" className="inline-flex rounded border border-slate-300 p-0.5">
          {MODES.map((m) => {
            const active = m.value === device.mode
            return (
              <button
                key={m.value}
                type="button"
                aria-pressed={active}
                disabled={active || mutation.isPending}
                onClick={() => mutation.mutate(m.value)}
                className={`rounded px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                  active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100 disabled:opacity-50'
                }`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        <span className="text-xs text-slate-500">
          {mutation.isPending ? 'Saving...' : current.help}
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  )
}
