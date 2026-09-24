// web/src/chartData.js  -> ye f-step P7-f4b pe daalni hai (P3.3; P5-f4: attack flag; P7-f4b: blocked flag)
// Chart ke chhote helper. Alag file mein kyunki component file (.jsx) se sirf component
// export hone chahiye - warna Vite ka Fast Refresh (save pe turant update) toot-ta hai.

// API ts ko UTC "...Z" mein bhejta hai. Date.parse usse ek number (ms) bana deta hai:
// ek pal = ek number, timezone ka koi lena-dena nahi. IST sirf DIKHATE waqt aata hai.
// P5-f4: attack = model ne is reading ko attack kaha (API ka is_attack). Sirf `true` hi
// attack hai: false = benign, null = score hi nahi hua (model unavailable) - "pata nahi"
// ko laal dot nahi dikhana.
export function toChartData(readings, metric) {
  return readings.map((r) => ({
    t: Date.parse(r.ts),
    value: r.metrics[metric],
    attack: r.is_attack === true,
    // P7-f4b: prevent mode ne roka (API P7-f4a ka action). 'allowed' / null (detect) = nahi.
    blocked: r.action === 'blocked',
  }))
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

// P3.4 f-step 1 pe daala
export function lastWindow(readings, windowMs) {
  if (readings.length === 0) {
     return readings
  }
  const end = Date.parse(readings.at(-1).ts)
  return readings.filter((r) => (Date.parse(r.ts) >= end - windowMs))
}