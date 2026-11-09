import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { captureStills } from './previewCapture.js'
import { useTrack } from './track.jsx'
import {
  buildLibraryRecord,
  buildProjectRecord,
  fingerprintOf,
  getLibraryItem,
  getProject,
  hydrateImages,
  persistStorage,
  putProject,
  putVisual,
  releaseImages,
  serializeImages,
} from './visuals.js'

const VisualSessionContext = createContext(null)

export function VisualSessionProvider({ children }) {
  const { track, studio, setTrack, replaceStudio } = useTrack()
  const [visualId, setVisualId] = useState(null)
  const [visualName, setVisualName] = useState('')
  const [status, setStatus] = useState('idle')
  const trackRef = useRef(track)
  const studioRef = useRef(studio)
  const visualIdRef = useRef(visualId)
  const visualNameRef = useRef(visualName)
  const fingerprintRef = useRef('')
  const queueRef = useRef(Promise.resolve())
  const abortRef = useRef(null)

  trackRef.current = track
  studioRef.current = studio
  visualIdRef.current = visualId
  visualNameRef.current = visualName

  useEffect(() => {
    persistStorage()
  }, [])

  useEffect(() => {
    if (status !== 'saved') return undefined
    const timer = window.setTimeout(() => setStatus('idle'), 2500)
    return () => window.clearTimeout(timer)
  }, [status])

  const beginNewVisual = useCallback(() => {
    visualIdRef.current = null
    visualNameRef.current = ''
    fingerprintRef.current = ''
    setVisualId(null)
    setVisualName('')
    setStatus('idle')
  }, [])

  const saveNow = useCallback((extra = {}) => {
    const run = async () => {
      const currentTrack = extra.track || trackRef.current
      const currentStudio = extra.studio || studioRef.current
      if (!currentTrack?.file) return null
      const view = {
        format: extra.view?.format || currentStudio.format || '16:9',
        playhead: extra.view?.playhead ?? 0,
      }
      const fingerprint = fingerprintOf({
        track: currentTrack,
        studio: currentStudio,
        view: { format: view.format },
      })
      const id = visualIdRef.current || crypto.randomUUID()
      const name = visualNameRef.current || currentTrack.fileName || 'Untitled'
      if (visualIdRef.current && fingerprint === fingerprintRef.current) {
        const project = await getProject(id).catch(() => null)
        if (project) {
          project.view = view
          if (project.track) project.track.playhead = view.playhead
          await putProject(project)
        }
        return id
      }
      setStatus('saving')
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const images = await serializeImages(currentStudio.images)
        const existing = visualIdRef.current ? await getLibraryItem(id).catch(() => null) : null
        const stills = await captureStills({
          track: currentTrack,
          studio: currentStudio,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return visualIdRef.current
        const thumbnail = stills.thumbnail || existing?.thumbnail || null
        const preview = stills.preview || existing?.preview || null
        const createdAt = existing?.createdAt || Date.now()
        await putVisual({
          library: buildLibraryRecord({
            id,
            name,
            track: currentTrack,
            studio: currentStudio,
            createdAt,
            thumbnail,
            preview,
            fingerprint,
          }),
          project: buildProjectRecord({
            id,
            track: currentTrack,
            studio: currentStudio,
            images,
            view,
            fingerprint,
          }),
        })
        fingerprintRef.current = fingerprint
        visualIdRef.current = id
        visualNameRef.current = name
        setVisualId(id)
        setVisualName(name)
        setStatus('saved')
        return id
      } catch {
        setStatus('error')
        return visualIdRef.current
      }
    }

    const pending = queueRef.current.then(run, run)
    queueRef.current = pending.then(
      () => {},
      () => {},
    )
    return pending
  }, [])

  const restoreVisual = useCallback(
    async (id) => {
      const project = await getProject(id)
      const library = await getLibraryItem(id)
      if (!project?.track?.file) throw new Error('That visual could not be opened.')
      releaseImages(studioRef.current?.images)
      const images = hydrateImages(project.images)
      const file = project.track.file
      const fileName = project.track.fileName || library?.fileName || 'track'
      const type = file.type || 'audio/mpeg'
      const restoredFile = file instanceof File ? file : new File([file], fileName, { type })
      setTrack({
        fileName,
        duration: project.track.duration,
        bpm: project.track.bpm,
        beats: project.track.beats,
        energy: project.track.energy,
        mood: project.track.mood,
        brightness: project.track.brightness,
        bars: project.track.bars,
        sections: project.track.sections,
        profile: project.track.profile,
        file: restoredFile,
        playhead: project.view?.playhead || project.track.playhead || 0,
      })
      replaceStudio({
        ...project.studio,
        format: project.view?.format || project.studio?.format || '16:9',
        images,
      })
      visualIdRef.current = id
      visualNameRef.current = library?.name || fileName
      fingerprintRef.current = project.fingerprint || library?.fingerprint || ''
      setVisualId(id)
      setVisualName(visualNameRef.current)
      setStatus('saved')
      return project
    },
    [replaceStudio, setTrack],
  )

  const nameVisual = useCallback((name) => {
    visualNameRef.current = name
    setVisualName(name)
  }, [])

  const value = useMemo(
    () => ({
      visualId,
      visualName,
      status,
      saveNow,
      restoreVisual,
      beginNewVisual,
      setVisualName: nameVisual,
    }),
    [visualId, visualName, status, saveNow, restoreVisual, beginNewVisual, nameVisual],
  )

  return <VisualSessionContext.Provider value={value}>{children}</VisualSessionContext.Provider>
}

export function useVisualSession() {
  const value = useContext(VisualSessionContext)
  if (!value) throw new Error('useVisualSession must be used within VisualSessionProvider')
  return value
}
