// web/src/AddDeviceForm.jsx  -> ye f-step P8-b pe daalni hai (P3.2: form; P8-b: design ka card + inline amber error)
import { useState } from 'react'
import { createDevice } from './api.js'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'

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

  // Phone: sab ek ke neeche ek (flex-col), button poori chaudai. 640px+: input aur button
  // ek line mein (sm:flex-row). items-start + button pe sm:mt-[26px]: label (20px) + gap (6px)
  // = 26px, to button input ki line pe baithta hai, aur error aane pe bhi upar hi rehta hai.
  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:p-5"
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="device-name" className="text-sm font-medium text-slate-700">
          New device name
        </label>
        <input
          id="device-name"
          type="text"
          required
          maxLength={100}
          placeholder="e.g. thermostat-bldg-c"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'device-name-error' : undefined}
          // text-base (16px) phone pe: iPhone 16px se chhote input pe zoom kar deta hai.
          className={`h-11 w-full rounded-lg border bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 sm:h-10 sm:text-sm ${FOCUS} ${
            error ? 'border-amber-600' : 'border-slate-300'
          }`}
        />
        {/* Error input ke theek neeche - kis cheez ki galti hai, saaf dikhe. Amber, laal nahi. */}
        {error && (
          <p id="device-name-error" role="alert" className="inline-flex items-start gap-1.5 text-sm text-amber-800">
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-3.5 flex-none place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-white"
            >
              !
            </span>
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={busy || trimmed === ''}
        className={`h-11 flex-none rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-[26px] sm:h-10 ${FOCUS}`}
      >
        {busy ? 'Adding...' : 'Add device'}
      </button>
    </form>
  )
}
