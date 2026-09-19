import { useState } from 'react'
import { createDevice } from './api.js'

export default function AddDeviceForm({ token, onCreated, onAuthError }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const { device, api_key } = await createDevice(token, trimmed)
      setName('')
      onCreated(device, api_key)
    } catch (err) {
      if (err.status === 401) return onAuthError()
      setError(
        err instanceof TypeError
          ? 'Cannot reach the API. Is it running?'
          : err.message
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1">
        <label htmlFor="device-name" className="block text-sm font-medium">
          New device name
        </label>
        <input
          id="device-name"
          type="text"
          required
          maxLength={100}
          placeholder="sensor-01"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2"
        />
      </div>

      <button
        type="submit"
        disabled={busy || trimmed === ''}
        className="flex-none rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Adding...' : 'Add device'}
      </button>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 sm:order-last sm:w-full">
          {error}
        </p>
      )}
    </form>
  )
}
