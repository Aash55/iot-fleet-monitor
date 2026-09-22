// web/src/DeviceDetail.jsx  -> ye P3.4 step 2 pe daalni hai (poori file replace; khaali Metric dropdown chhupaya)
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { getDevice, getReadings } from './api.js'
import ReadingsChart from './ReadingsChart.jsx'
import { formatDateTime, lastWindow, toChartData } from './chartData.js'

const POLL_MS = 5000
const READINGS_LIMIT = 60 // simulator har 5 s bhejta hai -> 60 readings = ~5 minute
const DEFAULT_METRIC = 'rate'
const WINDOW_MS = 10 * 60 * 1000

// 404 = device nahi hai ya tumhara nahi (P3.1). 400 = id number hi nahi (/devices/abc).
function isNotFound(err) {
  return err?.status === 404 || err?.status === 400
}

export default function DeviceDetail({ token, onAuthError }) {
  const { id } = useParams()
  const [picked, setPicked] = useState(DEFAULT_METRIC)

  // Dono query P3.2 jaisi: har 5 s poll, retry nahi (polling khud retry hai).
  const deviceQuery = useQuery({
    queryKey: ['device', id],
    queryFn: () => getDevice(token, id),
    refetchInterval: POLL_MS,
    retry: false,
  })
  const readingsQuery = useQuery({
    queryKey: ['readings', id, READINGS_LIMIT],
    queryFn: () => getReadings(token, id, READINGS_LIMIT),
    refetchInterval: POLL_MS,
    retry: false,
  })

  const authFailed =
    deviceQuery.error?.status === 401 || readingsQuery.error?.status === 401
  useEffect(() => {
    if (authFailed) onAuthError()
  }, [authFailed, onAuthError])

  if (authFailed) return null // logout ho raha hai; RequireAuth /login bhej dega

  if (isNotFound(deviceQuery.error)) {
    return (
      <section className="space-y-3">
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Device not found. It may have been deleted.
        </p>
        <Link to="/devices" className="text-sm font-medium text-slate-700 hover:underline">
          Back to devices
        </Link>
      </section>
    )
  }

  if (deviceQuery.isPending) {
    return <p className="text-sm text-slate-500">Loading device...</p>
  }

  const device = deviceQuery.data
  const readings = readingsQuery.data ?? []
  const latest = readings.at(-1)
  const shown = lastWindow(readings, WINDOW_MS)
  const names = latest ? Object.keys(latest.metrics).sort() : []
  const metric = names.includes(picked) ? picked : names[0]
  const loadError =
    deviceQuery.isError || (readingsQuery.isError && !isNotFound(readingsQuery.error))

  return (
    <section className="space-y-4">
      <Link to="/devices" className="text-sm font-medium text-slate-700 hover:underline">
        Back to devices
      </Link>

      {device && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{device.name}</h2>
            <p className="text-xs text-slate-500">
              id {device.id} · last seen {device.last_seen ? formatDateTime(device.last_seen) : 'never'}
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
        </div>
      )}

      {loadError && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Cannot reach the API. Is it running? Checking again every 5 seconds.
        </p>
      )}

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* P3.4 step 2: readings na hon to metric ka koi naam hi nahi -> khaali dropdown mat dikhao */}
          {names.length > 0 && (
            <label className="flex items-center gap-2 text-sm font-medium">
              Metric
              <select
                value={metric}
                onChange={(event) => setPicked(event.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {names.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          {readingsQuery.dataUpdatedAt > 0 && (
            <p className="ml-auto text-xs text-slate-500">
              Updated {new Date(readingsQuery.dataUpdatedAt).toLocaleTimeString()}. Refreshes every 5 seconds.
            </p>
          )}
        </div>

        {readingsQuery.isPending ? (
          <p className="text-sm text-slate-500">Loading readings...</p>
        ) : readings.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            No readings yet. They show up here as soon as this device sends data.
          </p>
        ) : (
          <>
            <ReadingsChart data={toChartData(shown, metric)} metric={metric} />
            <p className="text-xs text-slate-500">
              Last {shown.length} readings, {formatDateTime(shown[0].ts)} to{' '}
              {formatDateTime(latest.ts)}. Times are in your browser&apos;s time zone.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
