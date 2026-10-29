import { createContext, useContext, useMemo, useState } from 'react'

const TrackContext = createContext(null)

export function TrackProvider({ children }) {
  const [track, setTrack] = useState(null)
  const value = useMemo(() => ({ track, setTrack }), [track])
  return <TrackContext.Provider value={value}>{children}</TrackContext.Provider>
}

export function useTrack() {
  const value = useContext(TrackContext)
  if (!value) throw new Error('useTrack must be used within TrackProvider')
  return value
}
