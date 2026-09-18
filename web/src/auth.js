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
