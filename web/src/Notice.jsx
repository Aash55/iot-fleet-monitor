// web/src/Notice.jsx  -> ye f-step P8-b pe daalni hai (NAYI file - amber "dhyan do" dabba)
// Pehle errors laal (bg-red-50) the. Par laal = attack. API down hona attack nahi hai,
// isliye design ne errors ko amber kiya. Ek hi component: list, device page, login sab yahi use karein.
export default function Notice({ children }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <span
        aria-hidden="true"
        className="grid size-5 flex-none place-items-center rounded-full bg-amber-500 text-[13px] font-bold text-white"
      >
        !
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
