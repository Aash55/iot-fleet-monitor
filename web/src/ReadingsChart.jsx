import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatDateTime, formatTime } from './chartData.js'

const AXIS_TICK = { fontSize: 12, fill: '#64748b' } // slate-500
const AXIS_LINE = { stroke: '#cbd5e1' } // slate-300

// A red dot only on attack readings, nothing on the rest (the line stays as is).
// recharts calls this function for every point; null = no dot at that point.
// Blocked readings get a ✕ instead of the red dot. A blocked reading is almost always an attack
// too, so drawing both would stack one on top of the other; the ✕ wins.
// The ✕ is violet (#6d28d9 = violet-700), the same colour as BlockedBadge.
// A white circle (r=8) sits behind the ✕ so the line does not run through it and it stays clear.
// big = the mouse is over this point (hover) -> the mark is slightly larger.
function Mark({ cx, cy, payload, big }) {
  if (cx == null || cy == null) return null
  if (payload.blocked) {
    const d = big ? 6.5 : 5
    const path = `M${cx - d},${cy - d}L${cx + d},${cy + d}M${cx + d},${cy - d}L${cx - d},${cy + d}`
    return (
      <g>
        <circle cx={cx} cy={cy} r={d + 3} fill="#fff" />
        <path d={path} stroke="#6d28d9" strokeWidth={2.5} strokeLinecap="round" />
      </g>
    )
  }
  if (payload.attack) {
    return <circle cx={cx} cy={cy} r={big ? 5.5 : 4.5} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />
  }
  // Ordinary reading: nothing normally, a black dot on hover.
  return big ? <circle cx={cx} cy={cy} r={4.5} fill="#0f172a" stroke="#fff" strokeWidth={2} /> : null
}

function AttackDot(props) {
  return <Mark {...props} big={false} />
}

// The hover dot keeps the colour meaning too. Previously recharts' default black dot was drawn
// ON TOP of the ✕ (caught in a sandbox screenshot), hiding the blocked mark.
function ActiveDot(props) {
  return <Mark {...props} big />
}

// Custom tooltip box (recharts' default box does not match the design).
// recharts passes `active` (is the mouse over the chart?) and `payload` (the reading there).
function ReadingTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload // { t, value, attack, blocked } - from toChartData
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-[18px] shadow-md tabular-nums">
      <div className="text-slate-600">{formatDateTime(p.t)}</div>
      <div className="font-medium text-slate-900">
        <span className="font-mono">{metric}</span>: {Number(p.value).toLocaleString()}
        {p.blocked ? (
          <span className="font-semibold text-violet-700"> (blocked)</span>
        ) : p.attack ? (
          <span className="font-semibold text-red-700"> (attack)</span>
        ) : null}
      </div>
    </div>
  )
}

export default function ReadingsChart({ data, metric }) {
  // 220px on phones, 300px at 640px+. ResponsiveContainer takes the size of this div.
  return (
    <div className="h-[220px] w-full sm:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          {/* number + time scale: the real gap between readings is the distance on the chart.
              (The design used a category axis, which spaces readings evenly and hides gaps.)
              minTickGap: at least 40px between labels, otherwise times overlap on phones. */}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTime}
            tick={AXIS_TICK}
            tickLine={AXIS_LINE}
            axisLine={AXIS_LINE}
            minTickGap={40}
          />
          <YAxis
            width={48}
            tickFormatter={formatCompact}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }}
            content={<ReadingTooltip metric={metric} />}
          />
          {/* linear: connect only the real points. Animation off: new data arrives every 5 s,
              and with animation on the line would redraw from the start each time.
              dot: only on attack/blocked. */}
          <Line
            type="linear"
            dataKey="value"
            stroke="#0f172a"
            strokeWidth={1.75}
            dot={AttackDot}
            activeDot={ActiveDot}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
