const API_URL = import.meta.env.VITE_API_URL

export async function getHealth() {
  const res = await fetch(`${API_URL}/health`)
  if (res.ok) return 'API ok, database ok'
  if (res.status === 503) return 'API ok, database down'
  return `API error: HTTP ${res.status}`
}

export async function login(email, password) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (res.status === 400 || res.status === 401) {
    throw new Error('Email or password is incorrect.')
  }
  if (!res.ok) {
    throw new Error(`Login failed: HTTP ${res.status}`)
  }

  return res.json()
}

export async function getMe(token) {
  const res = await fetch(`${API_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`Session check failed: HTTP ${res.status}`)
  }
  const { user } = await res.json()
  return user
}
