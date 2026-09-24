// web/src/ReadingsChart.jsx  -> ye f-step P5-f4 pe daalni hai (P3.3; P5-f4: attack dots)
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatDateTime, formatTime } from './chartData.js'

// P5-f4: sirf attack wali reading pe laal dot, baaki pe kuch nahi (line waisi hi).
// recharts har point ke liye ye function bulata hai; null = us point pe dot nahi.
function AttackDot({ cx, cy, payload }) {
  if (!payload.attack || cx == null || cy == null) return null
  return <circle cx={cx} cy={cy} r={4} fill="#dc2626" stroke="#fff" strokeWidth={1} />
}

export default function ReadingsChart({ data, metric }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          {/* number + time scale: readings ke beech jitna asli gap, chart pe utni hi doori */}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTime}
            tick={{ fontSize: 12, fill: '#64748b' }}
          />
          <YAxis
            width={56}
            tickFormatter={formatCompact}
            tick={{ fontSize: 12, fill: '#64748b' }}
          />
          <Tooltip
            labelFormatter={formatDateTime}
            formatter={(v, _name, item) => [
              Number(v).toLocaleString() + (item.payload.attack ? '  (attack)' : ''),
              metric,
            ]}
          />
          {/* linear: sirf asli points ko jodo. Animation band: har 5 s naya data aata hai,
              animation on rehti to line baar-baar shuru se banti. dot: sirf attack pe (P5-f4). */}
          <Line
            type="linear"
            dataKey="value"
            stroke="#0f172a"
            strokeWidth={2}
            dot={AttackDot}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
