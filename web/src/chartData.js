// Small chart helpers. They live in a separate file because a component file (.jsx) should
// export only components; otherwise Vite's Fast Refresh (instant update on save) breaks.

// The API sends ts in UTC "...Z". Date.parse turns it into a number (ms): one instant = one
// number, independent of time zone. IST only comes in when DISPLAYING.
// attack = the model flagged this reading as an attack (the API's is_attack). Only `true`
// counts as an attack: false = benign, null = not scored (model unavailable), and "unknown"
// must not get a red dot.
export function toChartData(readings, metric) {
  return readings.map((r) => ({
    t: Date.parse(r.ts),
    value: r.metrics[metric],
    attack: r.is_attack === true,
    // Blocked by prevent mode (the API's action field). 'allowed' / null (detect) = not blocked.
    blocked: r.action === 'blocked',
  }))
}

// Uses the browser's own time zone (IST on an Indian laptop). Never add +5:30 in code.
export function formatTime(t) {
  return new Date(t).toLocaleTimeString()
}

export function formatDateTime(t) {
  return new Date(t).toLocaleString()
}

// 83400000 -> "83.4M": keeps large numbers such as iat readable on the Y-axis.
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function formatCompact(v) {
  return compact.format(v)
}

export function lastWindow(readings, windowMs) {
  if (readings.length === 0) {
     return readings
  }
  const end = Date.parse(readings.at(-1).ts)
  return readings.filter((r) => (Date.parse(r.ts) >= end - windowMs))
}