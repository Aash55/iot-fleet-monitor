// "N blocked · 15 min". count = API recent_blocked. Same as AttackBadge:
// 0 or an older API (field missing) -> render nothing.
// NOT red: red means "the model called it an attack" (AttackBadge). This means "was blocked".
// Violet instead of black: black looked like the buttons (Log in, Add device); violet is used
// only for "blocked", so it stands out in the list immediately.
import { Chip } from './Chips.jsx'

export default function BlockedBadge({ count }) {
  if (!count) return null
  return (
    <Chip tone="blocked" title="Readings that prevent mode told the gateway to block in the last 15 minutes">
      {count} blocked · 15 min
    </Chip>
  )
}
