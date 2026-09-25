// web/src/ModeToggle.jsx  -> ye f-step P8-c pe daalni hai (P7-f4b: NAYI file; P8-c: design ka card + segmented + spinner)
// Device page pe Detect | Prevent. Click -> PATCH /devices/:id -> jawab ka naya device
// parent ko (onChanged), jo cache mein daal deta hai. Screen tabhi badalti hai jab SERVER
// haan bol de - pehle se "prevent" dikha dena (optimistic) galat hota agar PATCH fail ho.
// P8-c: design ke "Saving..." mock mein naya button PEHLE hi kaala ho jaata tha (optimistic).
// Wo copy NAHI kiya: Saving ke dauran PURANA mode hi kaala rehta hai, bas dono button dhundhle
// + disabled + spinner. Kaala tabhi badalta hai jab device.mode (server ka jawab) badle.
import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { setDeviceMode } from './api.js'
import Notice from './Notice.jsx'
import Spinner from './Spinner.jsx'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600'

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
  const saving = mutation.isPending
  const error = mutation.isError && !authFailed
    ? (mutation.error instanceof TypeError
        ? 'Cannot reach the API. Mode was not changed.'
        : mutation.error.message)
    : ''

  return (
    <div className="flex flex-col gap-3">
      {/* Phone: sab ek ke neeche ek. 640px+: "Mode" | buttons | help, ek line mein. */}
      <div
        aria-busy={saving || undefined}
        className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-5"
      >
        <span className="text-sm font-semibold">Mode</span>
        {/* Segmented control: grey patti (track), andar do button, chuna hua kaala.
            Phone pe grid-cols-2 = dono barabar chaude aur 40px oonche (ungli se dabana aasaan). */}
        <div
          role="group"
          aria-label="Device mode"
          className={`grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex ${
            saving ? 'cursor-wait opacity-70' : ''
          }`}
        >
          {MODES.map((m) => {
            const active = m.value === device.mode // SIRF server wala mode
            return (
              <button
                key={m.value}
                type="button"
                aria-pressed={active}
                disabled={active || saving}
                onClick={() => mutation.mutate(m.value)}
                className={`h-10 rounded-md px-4 text-sm font-medium sm:h-8 ${FOCUS} ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 enabled:hover:bg-white enabled:hover:text-slate-900'
                } ${saving ? 'cursor-wait' : ''}`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        {/* aria-live: "Saving..." aur naya help text screen reader bhi bolta hai */}
        <span aria-live="polite" className="inline-flex items-center gap-2 text-sm text-slate-600">
          {saving ? (
            <>
              <Spinner />
              Saving...
            </>
          ) : (
            current.help
          )}
        </span>
      </div>
      {error && <Notice>{error}</Notice>}
    </div>
  )
}
