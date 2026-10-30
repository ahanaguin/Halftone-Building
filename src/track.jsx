import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { loadCalibration, paletteFromCalibration } from './calibrate.js'
import { paletteForSection, paletteFromPreset } from './palette.js'

const TrackContext = createContext(null)

function initialStudio() {
  const saved = loadCalibration()
  if (saved?.groups) {
    return {
      style: 'shapes',
      roundness: saved.roundness ?? 0.7,
      seeds: {},
      palette: paletteFromCalibration(saved),
      calibration: saved,
      shine: true,
    }
  }
  return {
    style: 'shapes',
    roundness: 0.7,
    seeds: {},
    palette: paletteFromPreset(paletteForSection('Quiet')),
    calibration: null,
    shine: true,
  }
}

export function TrackProvider({ children }) {
  const [track, setTrack] = useState(null)
  const [studio, setStudio] = useState(initialStudio)
  const [past, setPast] = useState([])
  const [calibrateChrome, setCalibrateChrome] = useState(null)
  const skipRef = useRef(null)

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

    function replaceStudio(next) {
      setPast([])
      setStudio(next)
    }

    return {
      track,
      setTrack,
      studio,
      editStudio,
      syncStudio,
      undoStudio,
      commitStudio,
      replaceStudio,
      canUndo: past.length > 0,
      calibrateChrome,
      setCalibrateChrome,
      registerCalibrateSkip(fn) {
        skipRef.current = fn
      },
      skipCalibration() {
        skipRef.current?.()
      },
    }
  }, [track, studio, past.length, calibrateChrome])

  return <TrackContext.Provider value={value}>{children}</TrackContext.Provider>
}

export function useTrack() {
  const value = useContext(TrackContext)
  if (!value) throw new Error('useTrack must be used within TrackProvider')
  return value
}
