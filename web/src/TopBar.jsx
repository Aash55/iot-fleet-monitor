// This used to be a black header inside App.jsx. Now it is a white bar, and the health colour
// follows its meaning (health.js). On desktop (sm = 640px+) health sits inside the bar; on
// phones there is no room in the bar, so health gets its own strip BELOW it.
import { Link } from 'react-router'
import { healthTone } from './health.js'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'

// Dot colour comes from the tone. checking = hollow circle (not known yet), the rest filled.
const DOT = {
  ok: 'size-2 rounded-full bg-slate-400',
  checking: 'size-2 rounded-full border-[1.5px] border-slate-400',
  warn: 'size-2 rounded-full bg-amber-500',
}

// Desktop: on warn, an amber "pill" (rounded box); otherwise just dot + text.
const DESKTOP = {
  ok: 'text-slate-600',
  checking: 'text-slate-500',
  warn: 'h-7 rounded-full bg-amber-50 px-2.5 text-amber-900 ring-1 ring-amber-300 ring-inset',
}

function HealthText({ status, tone }) {
  return (
    <>
      <span aria-hidden="true" className={`flex-none ${DOT[tone]}`} />
      {status}
    </>
  )
}

export default function TopBar({ apiStatus, onLogout }) {
  const tone = healthTone(apiStatus)

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
        <Link to="/devices" className={`flex items-center gap-2.5 rounded-md ${FOCUS}`}>
          {/* Logo: black square with a hollow white square inside. Decorative only -> aria-hidden. */}
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-slate-900">
            <span className="size-2.5 rounded-[3px] border-2 border-white" />
          </span>
          <span className="text-base font-semibold">Fleet Monitor</span>
        </Link>

        <div className="flex items-center gap-4">
          <p role="status" className={`hidden items-center gap-2 text-sm sm:inline-flex ${DESKTOP[tone]}`}>
            <HealthText status={apiStatus} tone={tone} />
          </p>
          {onLogout && (
            <>
              <span aria-hidden="true" className="hidden h-5 w-px bg-slate-200 sm:block" />
              <button
                type="button"
                onClick={onLogout}
                className={`h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:h-9 ${FOCUS}`}
              >
                Log out
              </button>
            </>
          )}
        </div>
      </header>

      {/* Phone health strip. sm:hidden = hidden at 640px+ (the one in the bar shows instead). */}
      <div
        className={`flex h-9 items-center border-b px-4 sm:hidden ${
          tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
        }`}
      >
        <p
          role="status"
          className={`inline-flex items-center gap-2 text-sm ${
            tone === 'warn' ? 'text-amber-900' : DESKTOP[tone]
          }`}
        >
          <HealthText status={apiStatus} tone={tone} />
        </p>
      </div>
    </>
  )
}
