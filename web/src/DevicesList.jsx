import { useEffect, useState } from 'react'
import { getDevices } from './api.js'

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : 'never'
}

export default function DevicesList({ token, onAuthError }) {
  const [devices, setDevices] = useState(null) // null = abhi load ho rahi hai
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    getDevices(token)
      .then((list) => { if (active) setDevices(list) })
      .catch((err) => {
        if (!active) return
        if (err.status === 401) return onAuthError()
        setError(
          err instanceof TypeError
            ? 'Cannot reach the API. Is it running?'
            : err.message
        )
        setDevices([])
      })

    return () => { active = false }
  }, [token, onAuthError])

  if (devices === null && !error) {
    return <p className="text-sm text-slate-500">Loading devices...</p>
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Devices</h2>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {devices.length === 0 && !error ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          Abhi koi device nahi hai. Add-device form 4.4b mein aayega; tab tak curl se bana sakte ho.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{device.name}</p>
                <p className="text-xs text-slate-500">
                  id {device.id} · last seen {formatWhen(device.last_seen)}
                </p>
              </div>
              <span
                className={`flex-none rounded-full px-2.5 py-1 text-xs font-medium ${
                  device.status === 'online'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {device.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
