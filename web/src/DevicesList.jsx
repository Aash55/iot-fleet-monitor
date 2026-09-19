import { useEffect, useState } from 'react'
import { getDevices } from './api.js'
import AddDeviceForm from './AddDeviceForm.jsx'

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : 'never'
}

export default function DevicesList({ token, onAuthError }) {
  const [devices, setDevices] = useState(null) // null = abhi load ho rahi hai
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(null) // { name, api_key } - sirf memory mein
  const [copyNote, setCopyNote] = useState('')

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

  function handleCreated(device, apiKey) {
    setDevices((prev) => [device, ...prev]) // GET bhi created_at DESC deta hai
    setRevealed({ name: device.name, api_key: apiKey })
    setCopyNote('')
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(revealed.api_key)
      setCopyNote('Copied.')
    } catch {
      setCopyNote('Copy blocked - key ko select karke manually copy karo.')
    }
  }

  if (devices === null && !error) {
    return <p className="text-sm text-slate-500">Loading devices...</p>
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Devices</h2>

      <AddDeviceForm token={token} onCreated={handleCreated} onAuthError={onAuthError} />

      {revealed && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            "{revealed.name}" ban gaya. Ye API key sirf ab dikhegi - server ke paas
            iska hash hai, key nahi. Kho gayi to naya device banana padega.
          </p>
          <code className="block break-all rounded border border-amber-200 bg-white px-3 py-2 font-mono text-xs">
            {revealed.api_key}
          </code>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-amber-400 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="rounded border border-amber-400 px-3 py-1 text-sm text-amber-900 hover:bg-amber-100"
            >
              I saved it
            </button>
            {copyNote && <span className="text-xs text-amber-800">{copyNote}</span>}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {devices.length === 0 && !error ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          Abhi koi device nahi hai. Upar wale form se pehla device banao.
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
