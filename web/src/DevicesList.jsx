// web/src/DevicesList.jsx  -> ye f-step 3 pe daalni hai (P3.3: naam ab detail page ka link)
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDevice, getDevices } from './api.js'
import AddDeviceForm from './AddDeviceForm.jsx'

// status (online/offline) server har request pe last_seen se nikalta hai (P3.1).
// Naya status dekhne ka ek hi tareeka hai: list dobara maango. Isliye har 5 s poll.
const POLL_MS = 5000
const DEVICES_KEY = ['devices']

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : 'never'
}

function messageFor(err, networkMessage) {
  return err instanceof TypeError ? networkMessage : err.message
}

export default function DevicesList({ token, onAuthError }) {
  const queryClient = useQueryClient()
  const [revealed, setRevealed] = useState(null) // { name, api_key } - sirf memory mein
  const [copyNote, setCopyNote] = useState('')

  const devicesQuery = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => getDevices(token),
    refetchInterval: POLL_MS,
    // Polling khud hi retry hai: fail hua to 5 s baad dobara maangegi. Default retry
    // (3 baar, 1+2+4 s ruk ke) API band hone pe har round mein 4 request bhejta aur
    // error ~7 s der se dikhata.
    retry: false,
  })

  const deleteMutation = useMutation({
    mutationFn: (device) => deleteDevice(token, device.id),
    onSuccess: (_result, device) =>
      updateList((list) => list.filter((d) => d.id !== device.id)),
  })

  // 401 kahin se bhi aaye (poll ya delete) -> logout. Render ke andar nahi, effect mein.
  const authFailed =
    devicesQuery.error?.status === 401 || deleteMutation.error?.status === 401
  useEffect(() => {
    if (authFailed) onAuthError()
  }, [authFailed, onAuthError])

  // List ko haath se badlo, par PEHLE chalu poll rok do. Warna jo GET badlaav se pehle
  // nikal chuka tha, wo purani list laa ke hamara badlaav mita deta.
  async function updateList(change) {
    await queryClient.cancelQueries({ queryKey: DEVICES_KEY })
    queryClient.setQueryData(DEVICES_KEY, (list) => (list ? change(list) : list))
  }

  function handleCreated(device, apiKey) {
    // Locked (P1): add ke baad refetch nahi - POST ka device list ke upar jodo.
    // GET bhi created_at DESC deta hai, isliye upar hi sahi jagah hai.
    updateList((list) => [device, ...list])
    setRevealed({ name: device.name, api_key: apiKey })
    setCopyNote('')
  }

  function handleDelete(device) {
    // ON DELETE CASCADE: device ke saath uski saari readings bhi DB se hat jaati hain.
    const ok = window.confirm(
      `Delete "${device.name}"? All of its readings will be deleted too. This cannot be undone.`
    )
    if (ok) deleteMutation.mutate(device)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(revealed.api_key)
      setCopyNote('Copied.')
    } catch {
      setCopyNote('Copy blocked - key ko select karke manually copy karo.')
    }
  }

  if (authFailed) return null // logout ho raha hai; RequireAuth /login bhej dega

  if (devicesQuery.isPending) {
    return <p className="text-sm text-slate-500">Loading devices...</p>
  }

  const devices = devicesQuery.data ?? []
  const loadError = devicesQuery.isError
    ? messageFor(devicesQuery.error, 'Cannot reach the API. Is it running? Checking again every 5 seconds.')
    : ''
  const deleteError = deleteMutation.isError
    ? messageFor(deleteMutation.error, 'Cannot reach the API. The device was not deleted.')
    : ''
  const deletingId = deleteMutation.isPending ? deleteMutation.variables.id : null

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Devices</h2>
        {devicesQuery.dataUpdatedAt > 0 && (
          <p className="text-xs text-slate-500">
            Updated {new Date(devicesQuery.dataUpdatedAt).toLocaleTimeString()}. Refreshes every 5 seconds.
          </p>
        )}
      </div>

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

      {loadError && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      )}
      {deleteError && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p>
      )}

      {devices.length === 0 && !loadError ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          Abhi koi device nahi hai. Upar wale form se pehla device banao.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <Link
                  to={`/devices/${device.id}`}
                  className="block truncate font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  {device.name}
                </Link>
                <p className="text-xs text-slate-500">
                  id {device.id} · last seen {formatWhen(device.last_seen)}
                </p>
              </div>
              <div className="flex flex-none items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    device.status === 'online'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {device.status}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(device)}
                  disabled={deletingId !== null}
                  aria-label={`Delete ${device.name}`}
                  className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
                >
                  {deletingId === device.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
