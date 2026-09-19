const API_URL = import.meta.env.VITE_API_URL

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

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
    throw new ApiError('Email or password is incorrect.', res.status)
  }
  if (!res.ok) {
    throw new ApiError(`Login failed: HTTP ${res.status}`, res.status)
  }

  return res.json()
}

export async function getMe(token) {
  const res = await fetch(`${API_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new ApiError(`Session check failed: HTTP ${res.status}`, res.status)
  }
  const { user } = await res.json()
  return user
}

export async function getDevices(token) {
  const res = await fetch(`${API_URL}/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new ApiError(`Could not load devices: HTTP ${res.status}`, res.status)
  }
  const { devices } = await res.json()
  return devices
}

export async function createDevice(token, name) {
  const res = await fetch(`${API_URL}/devices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  })

  if (res.status === 400) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error?.name?.[0] ?? 'Device name is not valid.', 400)
  }
  if (!res.ok) {
    throw new ApiError(`Could not add device: HTTP ${res.status}`, res.status)
  }

  return res.json() // { device, api_key }
}