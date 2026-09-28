// Maps the top bar's health text (the result of getHealth) to the colour to show.
// Why a separate .js file: it is a pure function, testable with `node --test` without a browser
// (like chartData.js). A component file (.jsx) should export only components.

export const HEALTH_CHECKING = 'Checking API...'
// This text must match api.js getHealth() EXACTLY, character for character. Tests pin this
// string in both places (getHealth T1 + health.test.js), so changing one breaks a test.
export const HEALTH_OK = 'API ok, database ok'

// 'ok'       -> slate (grey) dot. NOT green: green = device online, which means something else.
// 'checking' -> hollow dot, no answer yet.
// 'warn'     -> amber. Database down, HTTP error, API unreachable: all mean "pay attention".
//               NOT red: red is only for attacks.
export function healthTone(status) {
  if (status === HEALTH_OK) return 'ok'
  if (status === HEALTH_CHECKING) return 'checking'
  return 'warn'
}
