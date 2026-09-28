// Used in "Saving..." (mode toggle) and "Loading readings...". A round border with a darker top
// segment, rotated by animate-spin (Tailwind). aria-hidden: the text next to it is enough.
export default function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-slate-900"
    />
  )
}
