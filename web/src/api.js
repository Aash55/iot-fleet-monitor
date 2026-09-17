const API_URL = import.meta.env.VITE_API_URL

export async function getHealth() {
  const res = await fetch(`${API_URL}/health`)
  if (res.ok) return 'API ok, database ok'
  if (res.status === 503) return 'API ok, database down'
  return `API error: HTTP ${res.status}`
}