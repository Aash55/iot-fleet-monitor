// web/src/BlockedBadge.jsx  -> ye f-step P8-b pe daalni hai (P7-f4b: NAYI file; P8-b: kaala -> violet Chip)
// "N blocked · 15 min". count = API ka recent_blocked (P7-f4a). AttackBadge jaisa hi:
// 0 ya purana API (field hi nahi) -> kuch mat dikhao.
// Laal NAHI: laal = "model ne attack kaha" (AttackBadge). Ye alag baat hai - "rok diya gaya".
// P8-b: kaala -> violet (design). Kaala button (Log in, Add device) jaisa dikhta tha; violet
// sirf "blocked" ke liye hai, isliye list mein turant alag pehchaan aata hai.
import { Chip } from './Chips.jsx'

export default function BlockedBadge({ count }) {
  if (!count) return null
  return (
    <Chip tone="blocked" title="Readings that prevent mode told the gateway to block in the last 15 minutes">
      {count} blocked · 15 min
    </Chip>
  )
}
