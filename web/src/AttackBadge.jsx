// The same red badge on both the device list and the device page. count = API recent_attacks.
// "15 min" must match the API's ALERT_WINDOW (api/src/routes/devices.js).
import { Chip } from './Chips.jsx'

export default function AttackBadge({ count }) {
  // 0 or an older API (field missing) -> render nothing. No green "0 attacks" badge: the count
  // is also 0 when the model is unavailable, and a green badge would falsely suggest "all safe".
  if (!count) return null
  return (
    <Chip tone="attack" title="Readings the ML model flagged as an attack in the last 15 minutes">
      {count} {count === 1 ? 'attack' : 'attacks'} · 15 min
    </Chip>
  )
}
