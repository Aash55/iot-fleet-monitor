// web/src/Spinner.jsx  -> ye f-step P8-c pe daalni hai (NAYI file - chhota ghoomta gola)
// "Saving..." (mode toggle) aur "Loading readings..." dono mein. Ek gol border, upar wala
// hissa gehra, animate-spin (Tailwind) use ghumaata hai. aria-hidden: saath ka text hi kaafi.
export default function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 flex-none animate-spin rounded-full border-2 border-slate-300 border-t-slate-900"
    />
  )
}
