// web/src/ReadingsChart.jsx  -> ye f-step P8-c pe daalni hai (P3.3; P5-f4: attack dots; P7-f4b: blocked ✕; P8-b: ✕ violet; P8-c: design ka axis/tooltip/height)
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatDateTime, formatTime } from './chartData.js'

const AXIS_TICK = { fontSize: 12, fill: '#64748b' } // slate-500
const AXIS_LINE = { stroke: '#cbd5e1' } // slate-300

// P5-f4: sirf attack wali reading pe laal dot, baaki pe kuch nahi (line waisi hi).
// recharts har point ke liye ye function bulata hai; null = us point pe dot nahi.
// P7-f4b: blocked reading pe ✕ (laal dot ki jagah). Blocked lagbhag hamesha attack bhi hota
// hai, to dono ek saath banate to ek ke upar ek dab jaate - ✕ jeet-ta hai.
// P8-b: ✕ violet (#6d28d9 = violet-700), BlockedBadge ke saath same rang.
// P8-c (design): ✕ ke peeche safed gola (r=8) - line ✕ ke beech se nahi guzarti, saaf dikhta hai.
// big = mouse is point pe hai (hover) -> nishaan thoda bada.
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
  // Aam reading: normal mein kuch nahi, hover pe kaala gola.
  return big ? <circle cx={cx} cy={cy} r={4.5} fill="#0f172a" stroke="#fff" strokeWidth={2} /> : null
}

function AttackDot(props) {
  return <Mark {...props} big={false} />
}

// P8-c: hover wala dot bhi rang ka matlab rakhe. Pehle recharts ka default kaala gola
// ✕ ke UPAR chadh jaata tha (sandbox screenshot mein pakda) - blocked ka nishaan chhup jaata.
function ActiveDot(props) {
  return <Mark {...props} big />
}

// P8-c: apna tooltip dabba (recharts ka default dabba design se match nahi karta).
// recharts khud `active` (mouse chart pe hai?) aur `payload` (us jagah ki reading) bhejta hai.
function ReadingTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload // { t, value, attack, blocked } - toChartData se
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
  // Phone pe 220px, 640px+ pe 300px (design). ResponsiveContainer is div ka size leta hai.
  return (
    <div className="h-[220px] w-full sm:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          {/* number + time scale: readings ke beech jitna asli gap, chart pe utni hi doori.
              (Design ne category axis diya tha - wo har reading ko barabar doori pe rakhta, gap chhupta.)
              minTickGap: labels ke beech kam se kam 40px, warna phone pe time ek doosre pe chadh jaate. */}
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
          {/* linear: sirf asli points ko jodo. Animation band: har 5 s naya data aata hai,
              animation on rehti to line baar-baar shuru se banti. dot: sirf attack/blocked pe. */}
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
