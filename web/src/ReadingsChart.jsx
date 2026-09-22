// web/src/ReadingsChart.jsx  -> ye f-step 3 pe daalni hai (P3.3, nayi file)
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatDateTime, formatTime } from './chartData.js'

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
            formatter={(v) => [Number(v).toLocaleString(), metric]}
          />
          {/* linear: sirf asli points ko jodo. Animation band: har 5 s naya data aata hai,
              animation on rehti to line baar-baar shuru se banti. */}
          <Line
            type="linear"
            dataKey="value"
            stroke="#0f172a"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
