// web/src/BlockedBadge.jsx  -> ye f-step P7-f4b pe daalni hai (NAYI file)
// "N blocked · 15 min". count = API ka recent_blocked (P7-f4a). AttackBadge jaisa hi:
// 0 ya purana API (field hi nahi) -> kuch mat dikhao.
// Laal NAHI: laal = "model ne attack kaha" (AttackBadge). Ye alag baat hai - "rok diya gaya".
export default function BlockedBadge({ count }) {
  if (!count) return null
  return (
    <span
      className="flex-none rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white"
      title="Readings that prevent mode told the gateway to block in the last 15 minutes"
    >
      {count} blocked · 15 min
    </span>
  )
}
