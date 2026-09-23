// web/src/api.js  -> ye f-step P6.3-f2C pe daalni hai (P3.3: getDevice + getReadings; P6.3-f2C: /health -> /status)
const API_URL = import.meta.env.VITE_API_URL

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// /status, not /health: EasyPrivacy blocks onrender.com/health (Brave Shields).
export async function getHealth() {
  const res = await fetch(`${API_URL}/status`)
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

export async function getDevice(token, id) {
  const res = await fetch(`${API_URL}/devices/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new ApiError(`Could not load device: HTTP ${res.status}`, res.status)
  }
  const { device } = await res.json()
  return device
}

export async function getReadings(token, id, limit) {
  const res = await fetch(
    `${API_URL}/devices/${encodeURIComponent(id)}/readings?limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    throw new ApiError(`Could not load readings: HTTP ${res.status}`, res.status)
  }
  const { readings } = await res.json()
  return readings // P3.1: purana -> naya, ts UTC "...Z"
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

  // 400 = naam galat, 409 = ye naam pehle se hai (P3.1 ka UNIQUE). API dono mein
  // same shape bhejta hai: { error: { name: [message] } }
  if (res.status === 400 || res.status === 409) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error?.name?.[0] ?? 'Device name is not valid.', res.status)
  }
  if (!res.ok) {
    throw new ApiError(`Could not add device: HTTP ${res.status}`, res.status)
  }

  return res.json() // { device, api_key }
}

export async function deleteDevice(token, id) {
  const res = await fetch(`${API_URL}/devices/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 = pehle hi hat chuka (jaise doosre tab se). User ka maqsad poora ho gaya,
  // isliye error nahi - delete idempotent hai.
  if (res.status === 404) return
  if (!res.ok) {
    throw new ApiError(`Could not delete device: HTTP ${res.status}`, res.status)
  }
}
