import { createContext, useContext, useMemo, useState } from 'react'
import { paletteForSection } from './palette.js'

const TrackContext = createContext(null)

export function TrackProvider({ children }) {
  const [track, setTrack] = useState(null)
  const [palette, setPalette] = useState(() => ({ source: 'default', ...paletteForSection('Quiet') }))
  const value = useMemo(() => ({ track, setTrack, palette, setPalette }), [track, palette])
  return <TrackContext.Provider value={value}>{children}</TrackContext.Provider>
}

export function useTrack() {
  const value = useContext(TrackContext)
  if (!value) throw new Error('useTrack must be used within TrackProvider')
  return value
}
