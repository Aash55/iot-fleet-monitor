// web/src/DeviceDetail.jsx  -> ye f-step P8-c pe daalni hai (P3.4 step 2; P5-f4: AttackBadge + attack note; P7-f4b: mode toggle + BlockedBadge + ✕ note; P8-c: Claude Design layout + states)
// P8-c mein LOGIC nahi badla (dono query 5 s poll, retry false, 404/400 = not found,
// 401 -> logout, mode ka jawab cache mein cancelQueries ke baad). Sirf dikhawat.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getDevice, getReadings } from './api.js'
import ReadingsChart from './ReadingsChart.jsx'
import AttackBadge from './AttackBadge.jsx'
import BlockedBadge from './BlockedBadge.jsx'
import { StatusChip } from './Chips.jsx'
import ModeToggle from './ModeToggle.jsx'
import Notice from './Notice.jsx'
import Spinner from './Spinner.jsx'
import { formatDateTime, lastWindow, toChartData } from './chartData.js'

const POLL_MS = 5000
const READINGS_LIMIT = 60 // simulator har 5 s bhejta hai -> 60 readings = ~5 minute
const DEFAULT_METRIC = 'rate'
const WINDOW_MS = 10 * 60 * 1000
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'

// 404 = device nahi hai ya tumhara nahi (P3.1). 400 = id number hi nahi (/devices/abc).
function isNotFound(err) {
  return err?.status === 404 || err?.status === 400
}

// "← Back to devices". Phone pe min-h-11 (44px): ungli se dabane layak oonchaai.
function BackLink() {
  return (
    <Link
      to="/devices"
      className={`inline-flex min-h-11 items-center gap-1.5 self-start rounded text-sm font-medium text-slate-600 hover:text-slate-900 sm:min-h-0 ${FOCUS}`}
    >
      <span aria-hidden="true">←</span>
      Back to devices
    </Link>
  )
}

// Chart ki jagah jitna hi dabba (220 / 300px), taaki data aane pe page upar-neeche na kude.
function ChartPlaceholder({ children, busy }) {
  return (
    <div
      aria-busy={busy || undefined}
      className="flex h-[220px] items-center justify-center rounded-lg bg-[repeating-linear-gradient(0deg,transparent_0_43px,#f1f5f9_43px_44px)] px-6 text-center sm:h-[300px]"
    >
      {children}
    </div>
  )
}

export default function DeviceDetail({ token, onAuthError }) {
  const { id } = useParams()
  const [picked, setPicked] = useState(DEFAULT_METRIC)
  const queryClient = useQueryClient()

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

  // P7-f4b: PATCH ka jawab (naya device) seedha cache mein. Pehle chalu poll roko - warna jo
  // GET PATCH se pehle nikla tha wo purana mode laa ke naya mita deta (DevicesList jaisa).
  // List ka cache bhi - wapas jaane pe list mein purana mode na dikhe.
  async function handleModeChanged(updated) {
    await queryClient.cancelQueries({ queryKey: ['device', id] })
    queryClient.setQueryData(['device', id], updated)
    queryClient.setQueryData(['devices'], (list) =>
      list?.map((d) => (d.id === updated.id ? updated : d))
    )
  }

  if (authFailed) return null // logout ho raha hai; RequireAuth /login bhej dega

  if (isNotFound(deviceQuery.error)) {
    return (
      <section className="flex flex-col gap-3">
        <BackLink />
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-base font-semibold text-slate-900">Device not found.</p>
          <p className="mt-1 text-sm text-slate-600">It may have been deleted.</p>
        </div>
      </section>
    )
  }

  if (deviceQuery.isPending) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-slate-600">
        <Spinner />
        Loading device...
      </p>
    )
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
    <section className="flex flex-col gap-4 sm:gap-5">
      <BackLink />

      {device && (
        // Phone: naam, meta, phir chips neeche. 640px+: naam/meta baayein, chips daayein.
        <div className="-mt-2 flex flex-col gap-2.5 sm:mt-0 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-0.5 sm:gap-1">
            <h1 className="text-xl font-semibold tracking-tight wrap-anywhere sm:text-2xl">{device.name}</h1>
            <p className="text-sm text-slate-500 tabular-nums">
              id {device.id} · last seen {device.last_seen ? formatDateTime(device.last_seen) : 'never'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:pt-1">
            <AttackBadge count={device.recent_attacks} />
            <BlockedBadge count={device.recent_blocked} />
            <StatusChip status={device.status} />
          </div>
        </div>
      )}

      {device && (
        <ModeToggle
          token={token}
          device={device}
          onChanged={handleModeChanged}
          onAuthError={onAuthError}
        />
      )}

      {loadError && (
        <Notice>
          <span className="font-semibold">Cannot reach the API.</span> Is it running? Checking again every 5 seconds.
        </Notice>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:gap-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          {/* P3.4 step 2: readings na hon to metric ka koi naam hi nahi -> khaali dropdown mat dikhao */}
          {names.length > 0 && (
            <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2.5">
              <span className="text-sm font-semibold">Metric</span>
              {/* font-mono: metric ke naam code jaise (syn_count) - design. Phone pe text-base (iOS zoom nahi). */}
              <select
                value={metric}
                onChange={(event) => setPicked(event.target.value)}
                className={`h-11 rounded-lg border border-slate-300 bg-white pr-8 pl-3 font-mono text-base text-slate-900 sm:h-9 sm:text-sm ${FOCUS}`}
              >
                {names.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          {readingsQuery.dataUpdatedAt > 0 && (
            <p className="text-sm text-slate-500 tabular-nums sm:ml-auto">
              Updated {new Date(readingsQuery.dataUpdatedAt).toLocaleTimeString()}. Refreshes every 5 seconds.
            </p>
          )}
        </div>

        {readingsQuery.isPending ? (
          <ChartPlaceholder busy>
            <span className="inline-flex items-center gap-2 bg-white px-2 py-1 text-sm text-slate-600">
              <Spinner />
              Loading readings...
            </span>
          </ChartPlaceholder>
        ) : readings.length === 0 ? (
          <ChartPlaceholder>
            <p className="max-w-[300px] bg-white px-2 text-sm text-slate-600">
              No readings yet. They show up here as soon as this device sends data.
            </p>
          </ChartPlaceholder>
        ) : (
          <>
            <ReadingsChart data={toChartData(shown, metric)} metric={metric} />
            {/* Legend: har nishaan ka matlab, wahi rang jo chart pe. Phone pe ek ke neeche ek. */}
            <div className="flex flex-col gap-1 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-4">
              <span>
                Last {shown.length} readings, {formatDateTime(shown[0].ts)} to{' '}
                {formatDateTime(latest.ts)}. Times are in your browser&apos;s time zone.
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 flex-none rounded-full bg-red-600" />
                Red dots: readings the ML model flagged as an attack.
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="font-bold text-violet-700">✕</span>
                Readings blocked in prevent mode.
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
