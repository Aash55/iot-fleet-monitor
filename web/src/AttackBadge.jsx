// web/src/AttackBadge.jsx  -> ye f-step P8-b pe daalni hai (P5-f4: NAYI file; P8-b: design ka Chip)
// Device list aur device page dono pe same laal badge. count = API ka recent_attacks.
// "15 min" API ke ALERT_WINDOW (api/src/routes/devices.js) se match karna chahiye.
import { Chip } from './Chips.jsx'

export default function AttackBadge({ count }) {
  // 0 ya purana API (field hi nahi) -> kuch mat dikhao. Hara "0 attacks" badge nahi: model
  // unavailable ho to bhi 0 aata hai, aur hara badge "sab safe" ka jhootha bharosa deta.
  if (!count) return null
  return (
    <Chip tone="attack" title="Readings the ML model flagged as an attack in the last 15 minutes">
      {count} {count === 1 ? 'attack' : 'attacks'} · 15 min
    </Chip>
  )
}
