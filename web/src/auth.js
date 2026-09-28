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

// When /me fails, log out ONLY if the API rejected the token (401). A network error / 5xx
// (Render asleep, Neon waking up, a deploy in progress) does not mean the token is bad, only
// that the API cannot answer right now. Logging out on those would kick the user out on every
// cold start.
export function shouldLogout(err) {
  return err?.status === 401
}
