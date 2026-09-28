// Detect | Prevent on the device page. Click -> PATCH /devices/:id -> the updated device from
// the response goes to the parent (onChanged), which writes it to the cache. The screen changes
// only once the SERVER confirms; showing "prevent" up front (optimistic) would be wrong if the
// PATCH failed. The design mock for "Saving..." turned the new button black immediately
// (optimistic); that was NOT copied. While saving, the OLD mode stays black and both buttons are
// just dimmed + disabled + spinner. The black highlight moves only when device.mode (the server
// response) changes.
import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { setDeviceMode } from './api.js'
import Notice from './Notice.jsx'
import Spinner from './Spinner.jsx'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600'

const MODES = [
  { value: 'detect', label: 'Detect', help: 'Alerts only. Every reading is accepted.' },
  // No number in the text on purpose. The threshold lives in ml/model.json (it changes with the
  // model); a hardcoded 0.90 in the UI became wrong when the model changed (actual 0.931).
  { value: 'prevent', label: 'Prevent', help: 'High-confidence attacks are blocked. Lower scores only raise an alert.' },
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

  // Older API (no mode field) -> hide the toggle; showing "detect" would be false.
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
      {/* Phone: everything stacked. 640px+: "Mode" | buttons | help, on one line. */}
      <div
        aria-busy={saving || undefined}
        className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-5"
      >
        <span className="text-sm font-semibold">Mode</span>
        {/* Segmented control: grey track with two buttons inside; the selected one is black.
            grid-cols-2 on phones = both equally wide and 40px tall (easy to tap). */}
        <div
          role="group"
          aria-label="Device mode"
          className={`grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex ${
            saving ? 'cursor-wait opacity-70' : ''
          }`}
        >
          {MODES.map((m) => {
            const active = m.value === device.mode // ONLY the mode from the server
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
        {/* aria-live: screen readers also announce "Saving..." and the new help text */}
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
