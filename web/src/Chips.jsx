// Chip = small pill label (online, prevent, "3 attacks · 15 min"). All share one shape:
// h-6, rounded-full, text-xs, with a small leading mark (dot / ✕ / diamond). Only colour differs.
// COLOUR MEANING (must not break): red = attack, violet = blocked, green = online.
// Everything else is slate (grey). This file exports only components (for Fast Refresh).

const BASE = 'inline-flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium'

const TONE = {
  attack: 'bg-red-50 text-red-700 ring-1 ring-red-200 ring-inset',
  blocked: 'bg-violet-700 text-white',
  online: 'bg-green-50 text-green-700 ring-1 ring-green-200 ring-inset',
  offline: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200 ring-inset',
  prevent: 'bg-white text-slate-700 ring-1 ring-slate-300 ring-inset',
}

// Marks are aria-hidden: the text ("online") is enough for screen readers, and announcing
// the dot would add nothing.
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

// online / offline, derived by the server from last_seen. Any other value renders grey.
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
