// Behaviour: poll every 5 s, retry off, cancelQueries before cache writes, confirm before
// delete, 401 -> log out. UI: page header, amber notices, loading skeleton, phone row layout.
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDevice, getDevices } from './api.js'
import AddDeviceForm from './AddDeviceForm.jsx'
import AttackBadge from './AttackBadge.jsx'
import BlockedBadge from './BlockedBadge.jsx'
import { PreventChip, StatusChip } from './Chips.jsx'
import Notice from './Notice.jsx'

// The server derives status (online/offline) from last_seen on every request.
// The only way to see a new status is to fetch the list again, hence the 5 s poll.
const POLL_MS = 5000
const DEVICES_KEY = ['devices']
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : 'never'
}

function messageFor(err, networkMessage) {
  return err instanceof TypeError ? networkMessage : err.message
}

// First load: grey bars shaped like the real rows (skeleton). Less jarring than "Loading..."
// text, because the page layout stays the same when data arrives. sr-only = screen readers only.
function ListSkeleton() {
  return (
    <div aria-busy="true" className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <span className="sr-only">Loading devices...</span>
      {[['w-44', 'w-60'], ['w-36', 'w-52']].map(([a, b]) => (
        <div key={a} className="flex flex-col gap-2 p-4 sm:px-5">
          <span className={`h-3.5 rounded bg-slate-200 ${a}`} />
          <span className={`h-3 rounded bg-slate-100 ${b}`} />
          <span className="mt-1 h-6 w-28 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

export default function DevicesList({ token, email, onAuthError }) {
  const queryClient = useQueryClient()
  const [revealed, setRevealed] = useState(null) // { name, api_key } - kept in memory only
  const [copyState, setCopyState] = useState('') // '' | 'copied' | 'blocked'

  const devicesQuery = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => getDevices(token),
    refetchInterval: POLL_MS,
    // Polling is itself the retry: a failed request is repeated 5 s later. The default retry
    // (3 times, waiting 1+2+4 s) would send 4 requests per round while the API is down and
    // show the error ~7 s late.
    retry: false,
  })

  const deleteMutation = useMutation({
    mutationFn: (device) => deleteDevice(token, device.id),
    onSuccess: (_result, device) =>
      updateList((list) => list.filter((d) => d.id !== device.id)),
  })

  // A 401 from anywhere (poll or delete) -> log out. Done in an effect, not during render.
  const authFailed =
    devicesQuery.error?.status === 401 || deleteMutation.error?.status === 401
  useEffect(() => {
    if (authFailed) onAuthError()
  }, [authFailed, onAuthError])

  // Update the list by hand, but cancel the running poll FIRST. Otherwise a GET sent before
  // the change would return the old list and overwrite our change.
  async function updateList(change) {
    await queryClient.cancelQueries({ queryKey: DEVICES_KEY })
    queryClient.setQueryData(DEVICES_KEY, (list) => (list ? change(list) : list))
  }

  function handleCreated(device, apiKey) {
    // No refetch after adding: prepend the device from the POST response to the list.
    // GET also returns created_at DESC, so the top is the correct position.
    updateList((list) => [device, ...list])
    setRevealed({ name: device.name, api_key: apiKey })
    setCopyState('')
  }

  function handleDelete(device) {
    // ON DELETE CASCADE: deleting a device also deletes all of its readings from the DB.
    const ok = window.confirm(
      `Delete "${device.name}"? All of its readings will be deleted too. This cannot be undone.`
    )
    if (ok) deleteMutation.mutate(device)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(revealed.api_key)
      setCopyState('copied')
    } catch {
      setCopyState('blocked')
    }
  }

  if (authFailed) return null // logging out; RequireAuth will redirect to /login

  const devices = devicesQuery.data ?? []
  const loadError = devicesQuery.isError
    ? messageFor(devicesQuery.error, 'Cannot reach the API. Is it running? Checking again every 5 seconds.')
    : ''
  const deleteError = deleteMutation.isError
    ? messageFor(deleteMutation.error, 'Cannot reach the API. The device was not deleted.')
    : ''
  const deletingId = deleteMutation.isPending ? deleteMutation.variables.id : null

  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      {/* Page header: stacked on phones; at 640px+ "Updated" sits on the right, bottom-aligned. */}
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-slate-500">
            {email ? (
              <>Signed in as <span className="font-medium text-slate-700">{email}</span></>
            ) : (
              'Signed in, verifying session...'
            )}
          </p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Devices</h1>
        </div>
        {devicesQuery.dataUpdatedAt > 0 && (
          <p className="text-sm text-slate-500 tabular-nums">
            Updated {new Date(devicesQuery.dataUpdatedAt).toLocaleTimeString()}. Refreshes every 5 seconds.
          </p>
        )}
      </div>

      {devicesQuery.isPending ? (
        <ListSkeleton />
      ) : (
        <>
          <AddDeviceForm token={token} onCreated={handleCreated} onAuthError={onAuthError} />

          {revealed && (
            <div role="alert" className="flex flex-col gap-3.5 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
              <div className="flex items-start gap-2.5 sm:gap-3">
                <span
                  aria-hidden="true"
                  className="mt-px grid size-5 flex-none place-items-center rounded-full bg-amber-500 text-[13px] font-bold text-white"
                >
                  !
                </span>
                <div className="flex min-w-0 flex-col gap-0.5 text-sm text-amber-900">
                  <p className="font-semibold">API key for {revealed.name}. Copy it now.</p>
                  <p>
                    This key is shown only once. The server stores only its hash, so it cannot be
                    shown again. If you lose it, create a new device.
                  </p>
                </div>
              </div>
              <code className="block rounded-lg border border-amber-200 bg-white px-3 py-3 font-mono text-[13px] leading-5 break-all text-slate-900 sm:px-3.5 sm:text-sm">
                {revealed.api_key}
              </code>
              {/* Phone: two equal buttons (grid-cols-2, 44px tall). 640px+: smaller, on one line. */}
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`h-11 min-w-[76px] rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:h-9 ${FOCUS}`}
                >
                  {copyState === 'copied' ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => setRevealed(null)}
                  className={`h-11 rounded-lg bg-slate-900 px-3.5 text-sm font-medium text-white hover:bg-slate-800 sm:h-9 ${FOCUS}`}
                >
                  I saved it
                </button>
              </div>
              {copyState === 'blocked' && (
                <p className="text-sm text-amber-800">Copy was blocked. Select the key and copy it by hand.</p>
              )}
            </div>
          )}

          {loadError && <Notice>{loadError}</Notice>}
          {deleteError && <Notice>{deleteError}</Notice>}

          {devices.length === 0 && !loadError ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <span aria-hidden="true" className="grid size-10 place-items-center rounded-[10px] bg-slate-100">
                <span className="size-3.5 rounded border-2 border-slate-400" />
              </span>
              <p className="text-sm text-slate-600">No devices yet. Use the form above to add your first one.</p>
            </div>
          ) : devices.length > 0 && (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {devices.map((device) => (
                // Phone layout fix: name + 4 chips + Delete used to share one line, so at 375px
                // the row overflowed the screen and the name disappeared. Now:
                //   phone  = [name/meta ... Delete] on top, chips BELOW on their own line (wrap)
                //   640px+ = all on one line: name/meta | chips | Delete
                // `sm:contents`: at 640px+ the top wrapper div "disappears" (display: contents),
                // so its children become direct flex items of the li. sm:order-last on Delete
                // puts it AFTER the chips on desktop.
                <li key={device.id} className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="flex items-start gap-3 sm:contents">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Link
                        to={`/devices/${device.id}`}
                        className={`self-start rounded text-base font-semibold wrap-anywhere text-slate-900 hover:underline ${FOCUS}`}
                      >
                        {device.name}
                      </Link>
                      <p className="text-sm text-slate-500 tabular-nums">
                        id {device.id} · last seen {formatWhen(device.last_seen)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(device)}
                      disabled={deletingId !== null}
                      aria-label={`Delete ${device.name}`}
                      className={`h-11 flex-none rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:opacity-50 sm:order-last sm:h-8 ${FOCUS}`}
                    >
                      {deletingId === device.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                  {/* Mode is changed on the device page; the list only shows who is in prevent */}
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    <PreventChip mode={device.mode} />
                    <AttackBadge count={device.recent_attacks} />
                    <BlockedBadge count={device.recent_blocked} />
                    <StatusChip status={device.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
