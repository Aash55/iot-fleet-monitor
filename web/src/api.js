const API_URL = import.meta.env.VITE_API_URL

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// /status, not /health: EasyPrivacy blocks onrender.com/health (Brave Shields).
// 200 is not enough: a wrong URL can return an HTML page with 200.
// "ok" only when the body is our JSON and says status "ok".
export async function getHealth() {
  const res = await fetch(`${API_URL}/status`)
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await res.json().catch(() => null) : null
  if (res.ok && body?.status === 'ok') return 'API ok, database ok'
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
  return readings // oldest -> newest, ts in UTC "...Z"
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

  // 400 = invalid name, 409 = name already exists (UNIQUE constraint). The API sends the
  // same shape for both: { error: { name: [message] } }
  if (res.status === 400 || res.status === 409) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error?.name?.[0] ?? 'Device name is not valid.', res.status)
  }
  if (!res.ok) {
    throw new ApiError(`Could not add device: HTTP ${res.status}`, res.status)
  }

  return res.json() // { device, api_key }
}

// detect <-> prevent (the API's PATCH). The response contains the full updated device
// (RETURNING), so no separate GET is needed. 404 = device does not exist / is not yours.
export async function setDeviceMode(token, id, mode) {
  const res = await fetch(`${API_URL}/devices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) {
    throw new ApiError(`Could not change mode: HTTP ${res.status}`, res.status)
  }
  const { device } = await res.json()
  return device
}

export async function deleteDevice(token, id) {
  const res = await fetch(`${API_URL}/devices/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 = already deleted (e.g. from another tab). The user's goal is achieved,
  // so it is not an error: delete is idempotent.
  if (res.status === 404) return
  if (!res.ok) {
    throw new ApiError(`Could not delete device: HTTP ${res.status}`, res.status)
  }
}
