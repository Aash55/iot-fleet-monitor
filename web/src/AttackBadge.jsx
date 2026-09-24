// web/src/AttackBadge.jsx  -> ye f-step P5-f4 pe daalni hai (NAYI file)
// Device list aur device page dono pe same laal badge. count = API ka recent_attacks.
// "15 min" API ke ALERT_WINDOW (api/src/routes/devices.js) se match karna chahiye.
export default function AttackBadge({ count }) {
  // 0 ya purana API (field hi nahi) -> kuch mat dikhao. Hara "0 attacks" badge nahi: model
  // unavailable ho to bhi 0 aata hai, aur hara badge "sab safe" ka jhootha bharosa deta.
  if (!count) return null
  return (
    <span
      className="flex-none rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800"
      title="Readings the ML model flagged as an attack in the last 15 minutes"
    >
      {count} {count === 1 ? 'attack' : 'attacks'} · 15 min
    </span>
  )
}
