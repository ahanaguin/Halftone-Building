import { workingSections } from './sectionEdit.js'
import { sectionKey } from './shapeLayout.js'

const DB_NAME = 'halftone-visuals'
const DB_VERSION = 1
const LIBRARY = 'library'
const PROJECTS = 'projects'
const CHANGED = 'halftone:visuals'

export const PREVIEW_VERSION = 5

export const STYLE_LABELS = {
  shapes: 'Liquid',
  halftone: 'Halftone',
  bars: 'Bars',
  wave: 'Wave',
  poster: 'Poster',
  image: 'Image animation',
  bloom: 'Bloom',
  orb: 'Orb',
  chrome: 'Chrome',
}

const COMPOSITION_LABELS = {
  auto: 'Auto',
  free: 'Free',
  mirror: 'Mirror',
  quad: 'Quad',
  radial: 'Radial',
  halftone: 'Halftone',
  collage: 'Collage',
  mosaic: 'Mosaic',
  riso: 'Riso',
  full: 'Full',
  ring: 'Ring',
  sphere: 'Sphere',
}

let dbPromise = null

function requestOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(LIBRARY)) {
        const library = db.createObjectStore(LIBRARY, { keyPath: 'id' })
        library.createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error)
    }
  })
  return dbPromise
}

async function withStores(names, mode, work) {
  const db = await openDb()
  const tx = db.transaction(names, mode)
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  const stores = Object.fromEntries(names.map((name) => [name, tx.objectStore(name)]))
  const result = await work(stores)
  await done
  return result
}

export function notifyVisuals() {
  window.dispatchEvent(new Event(CHANGED))
}

export function onVisualsChange(fn) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}

export function styleLabel(style) {
  return STYLE_LABELS[style] || 'Liquid'
}

export function compositionLabel(studio, track) {
  const sections = workingSections(track, studio)
  const first = sections[0]
  const edit = first ? studio?.edits?.[sectionKey(first)] : null
  if (studio?.style === 'image') {
    if (edit?.composition === 'collage') return 'Collage'
    if (edit?.composition === 'mosaic') return 'Mosaic'
    if (edit?.composition === 'riso') return 'Riso'
    return 'Halftone'
  }
  if (studio?.style === 'bloom') return edit?.composition === 'ring' ? 'Ring' : 'Full'
  if (studio?.style === 'orb') return edit?.composition === 'ring' ? 'Ring' : 'Sphere'
  if (['free', 'mirror', 'quad', 'radial'].includes(edit?.composition)) return COMPOSITION_LABELS[edit.composition]
  return 'Auto'
}

export function formatVisualDate(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function cloneStudio(studio) {
  const copy = {}
  for (const key of Object.keys(studio || {})) {
    if (key === 'images') continue
    copy[key] = studio[key]
  }
  return structuredClone(copy)
}

async function blobFromImage(image) {
  if (image?.blob instanceof Blob) return image.blob
  if (image?.file instanceof Blob) return image.file
  if (image?.url) {
    try {
      const response = await fetch(image.url)
      if (response.ok) return response.blob()
    } catch {
      /* ignore */
    }
  }
  return null
}

export async function serializeImages(images) {
  const out = []
  for (const image of images || []) {
    const blob = await blobFromImage(image)
    if (!blob) continue
    out.push({
      id: image.id,
      name: image.name || 'image',
      type: blob.type || 'image/jpeg',
      blob,
    })
  }
  return out
}

export function hydrateImages(images) {
  return (images || []).map((image) => ({
    id: image.id,
    name: image.name || 'image',
    blob: image.blob,
    url: image.blob ? URL.createObjectURL(image.blob) : '',
  }))
}

export function releaseImages(images) {
  for (const image of images || []) {
    if (typeof image?.url === 'string' && image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
  }
}

function trackMeta(track) {
  if (!track) return null
  return {
    fileName: track.fileName,
    duration: track.duration,
    bpm: track.bpm,
    beats: track.beats,
    energy: track.energy,
    mood: track.mood,
    brightness: track.brightness,
    bars: track.bars,
    sections: track.sections,
    profile: track.profile,
  }
}

export function fingerprintOf({ track, studio, view }) {
  return JSON.stringify({
    fileName: track?.fileName,
    duration: track?.duration,
    sections: studio?.sections || track?.sections,
    studio: { ...cloneStudio(studio), images: (studio?.images || []).map((image) => image.id) },
    view: view || null,
  })
}

export async function putVisual(record) {
  await withStores([LIBRARY, PROJECTS], 'readwrite', async (stores) => {
    stores[LIBRARY].put(record.library)
    stores[PROJECTS].put(record.project)
  })
  notifyVisuals()
}

export async function putProject(project) {
  await withStores([PROJECTS], 'readwrite', async (stores) => {
    stores[PROJECTS].put(project)
  })
}

export async function listVisuals() {
  const items = await withStores([LIBRARY], 'readonly', async (stores) => requestOf(stores[LIBRARY].getAll()))
  return (items || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export async function getProject(id) {
  return withStores([PROJECTS], 'readonly', async (stores) => requestOf(stores[PROJECTS].get(id)))
}

export async function getLibraryItem(id) {
  return withStores([LIBRARY], 'readonly', async (stores) => requestOf(stores[LIBRARY].get(id)))
}

export async function renameVisual(id, name) {
  const next = String(name || '').trim()
  if (!next) return false
  await withStores([LIBRARY], 'readwrite', async (stores) => {
    const item = await requestOf(stores[LIBRARY].get(id))
    if (!item) return
    stores[LIBRARY].put({ ...item, name: next, updatedAt: Date.now() })
  })
  notifyVisuals()
  return true
}

export async function deleteVisual(id) {
  await withStores([LIBRARY, PROJECTS], 'readwrite', async (stores) => {
    stores[LIBRARY].delete(id)
    stores[PROJECTS].delete(id)
  })
  notifyVisuals()
}

export async function duplicateVisual(id) {
  const now = Date.now()
  const copyId = crypto.randomUUID()
  let created = null
  await withStores([LIBRARY, PROJECTS], 'readwrite', async (stores) => {
    const library = await requestOf(stores[LIBRARY].get(id))
    const project = await requestOf(stores[PROJECTS].get(id))
    if (!library || !project) return
    created = {
      ...library,
      id: copyId,
      name: `Copy of ${library.name || library.fileName || 'visual'}`,
      createdAt: now,
      updatedAt: now,
    }
    stores[LIBRARY].put(created)
    stores[PROJECTS].put({ ...project, id: copyId })
  })
  notifyVisuals()
  return created
}

export function buildLibraryRecord({ id, name, track, studio, createdAt, thumbnail, preview, fingerprint }) {
  return {
    id,
    name: name || track?.fileName || 'Untitled',
    fileName: track?.fileName || 'Untitled',
    style: studio?.style || 'shapes',
    composition: compositionLabel(studio, track),
    createdAt: createdAt || Date.now(),
    updatedAt: Date.now(),
    thumbnail: thumbnail || null,
    preview: preview || null,
    previewVersion: PREVIEW_VERSION,
    fingerprint: fingerprint || '',
  }
}

export function buildProjectRecord({ id, track, studio, images, view, fingerprint }) {
  return {
    id,
    track: {
      ...trackMeta(track),
      file: track.file,
      playhead: view?.playhead || 0,
    },
    studio: cloneStudio(studio),
    images,
    view: {
      format: view?.format || studio?.format || '16:9',
      playhead: view?.playhead || 0,
    },
    fingerprint: fingerprint || '',
  }
}

export async function storageStatus() {
  if (!navigator.storage?.estimate) return { warning: false, usage: 0, quota: 0 }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    const remain = quota - usage
    const warning = quota > 0 && (usage / quota >= 0.85 || remain < 40 * 1024 * 1024)
    return { warning, usage, quota }
  } catch {
    return { warning: false, usage: 0, quota: 0 }
  }
}

export async function persistStorage() {
  try {
    await navigator.storage?.persist?.()
  } catch {
    /* ignore */
  }
}
