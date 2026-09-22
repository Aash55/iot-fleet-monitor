// web/src/chartData.js  -> ye f-step 3 pe daalni hai (P3.3, nayi file)
// Chart ke chhote helper. Alag file mein kyunki component file (.jsx) se sirf component
// export hone chahiye - warna Vite ka Fast Refresh (save pe turant update) toot-ta hai.

// API ts ko UTC "...Z" mein bhejta hai. Date.parse usse ek number (ms) bana deta hai:
// ek pal = ek number, timezone ka koi lena-dena nahi. IST sirf DIKHATE waqt aata hai.
export function toChartData(readings, metric) {
  return readings.map((r) => ({ t: Date.parse(r.ts), value: r.metrics[metric] }))
}

// Browser ka apna timezone (tumhare laptop pe IST). Code mein +5:30 kahin nahi jodna.
export function formatTime(t) {
  return new Date(t).toLocaleTimeString()
}

export function formatDateTime(t) {
  return new Date(t).toLocaleString()
}

// 83400000 -> "83.4M": iat jaise bade number bhi Y-axis pe padhne layak rahein.
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function formatCompact(v) {
  return compact.format(v)
}
