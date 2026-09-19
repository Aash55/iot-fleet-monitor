import { Navigate, useLocation } from 'react-router'

export default function RequireAuth({ session, children }) {
  const location = useLocation()

  if (!session) {
    // Kahan jaana chahta tha, wo yaad rakho - login ke baad wahin bhej denge.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}