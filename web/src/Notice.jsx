// Errors used to be red (bg-red-50), but red means attack. The API being down is not an attack,
// so errors are amber. One shared component for the list, the device page, login, etc.
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
