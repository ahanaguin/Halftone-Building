import { createContext, useContext, useMemo, useState } from 'react'
import { paletteForSection, paletteFromPreset } from './palette.js'

const TrackContext = createContext(null)

function initialStudio() {
  return {
    style: 'shapes',
    roundness: 0.7,
    seeds: {},
    palette: paletteFromPreset(paletteForSection('Quiet')),
  }
}

export function TrackProvider({ children }) {
  const [track, setTrack] = useState(null)
  const [studio, setStudio] = useState(initialStudio)
  const [past, setPast] = useState([])

  const value = useMemo(() => {
    function editStudio(recipe) {
      setStudio((current) => {
        const next = recipe(current)
        if (next === current) return current
        setPast((items) => [...items.slice(-39), current])
        return next
      })
    }

    function syncStudio(recipe) {
      setStudio((current) => {
        const next = recipe(current)
        return next === current ? current : next
      })
    }

    function undoStudio() {
      setPast((items) => {
        if (!items.length) return items
        setStudio(items[items.length - 1])
        return items.slice(0, -1)
      })
    }

    function commitStudio(base) {
      setStudio((current) => {
        if (!base || current === base) return current
        setPast((items) => [...items.slice(-39), base])
        return current
      })
    }

    return {
      track,
      setTrack,
      studio,
      editStudio,
      syncStudio,
      undoStudio,
      commitStudio,
      canUndo: past.length > 0,
    }
  }, [track, studio, past.length])

  return <TrackContext.Provider value={value}>{children}</TrackContext.Provider>
}

export function useTrack() {
  const value = useContext(TrackContext)
  if (!value) throw new Error('useTrack must be used within TrackProvider')
  return value
}
