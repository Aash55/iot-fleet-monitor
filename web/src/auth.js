// web/src/auth.js  -> ye f-step P9-e pe badli (P9-e: shouldLogout - sirf 401 pe logout)
const TOKEN_KEY = 'fleet_token'

export function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null // storage blocked (private mode): session stays memory-only
  }
}

export function saveToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore: login still works for this tab, it just won't survive a reload
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore: nothing was stored in the first place
  }
}

// P9-e: /me fail hone pe logout SIRF tab jab API ne token thukraya (401). Network error / 5xx
// (Render so raha, Neon jaag raha, deploy chal raha) = token galat nahi, API abhi jawab nahi de
// pa rahi. Us pe logout karna = har cold start pe user ko bahar phenk dena.
export function shouldLogout(err) {
  return err?.status === 401
}
