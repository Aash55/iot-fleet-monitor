import { Navigate, useLocation } from 'react-router'

export default function RequireAuth({ session, children }) {
  const location = useLocation()

  if (!session) {
    // Remember where the user was going, so login can send them back there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}