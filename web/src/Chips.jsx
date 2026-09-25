// web/src/Chips.jsx  -> ye f-step P9-e pe daalni hai (P8-b: NAYI file - design ke chips ek jagah; P9-e: tooltip mein number nahi)
// Chip = chhota gol label (online, prevent, "3 attacks · 15 min"). Sabka dhaancha same:
// h-6, rounded-full, text-xs, aage ek chhota nishaan (dot / ✕ / diamond). Sirf rang alag.
// RANG KA MATLAB (tootna nahi chahiye): laal = attack, violet = blocked, hara = online.
// Baaki sab slate (grey). Is file se sirf components export hote hain (Fast Refresh ke liye).

const BASE = 'inline-flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium'

const TONE = {
  attack: 'bg-red-50 text-red-700 ring-1 ring-red-200 ring-inset',
  blocked: 'bg-violet-700 text-white',
  online: 'bg-green-50 text-green-700 ring-1 ring-green-200 ring-inset',
  offline: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200 ring-inset',
  prevent: 'bg-white text-slate-700 ring-1 ring-slate-300 ring-inset',
}

// Nishaan aria-hidden: screen reader ke liye text hi kaafi hai ("online"), gola padhna bekaar.
const MARK = {
  attack: <span aria-hidden="true" className="size-1.5 rounded-full bg-red-600" />,
  blocked: <span aria-hidden="true" className="text-[11px] leading-none font-bold">✕</span>,
  online: <span aria-hidden="true" className="size-1.5 rounded-full bg-green-600" />,
  offline: <span aria-hidden="true" className="size-1.5 rounded-full border-[1.5px] border-slate-400" />,
  prevent: <span aria-hidden="true" className="size-1.5 rotate-45 bg-slate-700" />,
}

export function Chip({ tone, title, children }) {
  return (
    <span className={`${BASE} ${TONE[tone]}`} title={title}>
      {MARK[tone]}
      {children}
    </span>
  )
}

// online / offline - server last_seen se nikalta hai (P3.1). Koi aur value aaye to grey.
export function StatusChip({ status }) {
  return <Chip tone={status === 'online' ? 'online' : 'offline'}>{status}</Chip>
}

export function PreventChip({ mode }) {
  if (mode !== 'prevent') return null
  return (
    <Chip tone="prevent" title="Prevent mode: high-confidence attacks are blocked">
      prevent
    </Chip>
  )
}
