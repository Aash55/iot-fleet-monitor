// web/src/health.js  -> ye f-step P8-a pe daalni hai (NAYI file)
// Top bar ka health text (getHealth ka jawab) -> kaunsa rang dikhana hai.
// Alag .js file kyun: pure function hai, `node --test` se bina browser ke test ho jaata hai
// (chartData.js jaisa). Component file (.jsx) se sirf component export hone chahiye.

export const HEALTH_CHECKING = 'Checking API...'
// Ye text api.js ke getHealth() se AKSHAR-SHA-AKSHAR milna chahiye. Dono jagah test isi
// string ko pakad ke rakhte hain (getHealth T1 + health.test.js), to ek badla to test tootega.
export const HEALTH_OK = 'API ok, database ok'

// 'ok'       -> slate (grey) dot. Hara NAHI: hara = device online, uska matlab alag hai.
// 'checking' -> khaali (hollow) dot, abhi jawab nahi aaya.
// 'warn'     -> amber. Database down, HTTP error, API unreachable - sab "dhyan do".
//               Laal NAHI: laal sirf attack ke liye hai.
export function healthTone(status) {
  if (status === HEALTH_OK) return 'ok'
  if (status === HEALTH_CHECKING) return 'checking'
  return 'warn'
}
