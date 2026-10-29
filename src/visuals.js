const STORAGE_KEY = 'halftone.visuals'

export function loadVisuals() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveVisual(entry) {
  const next = [
    {
      id: crypto.randomUUID(),
      fileName: entry.fileName,
      style: entry.style,
      createdAt: Date.now(),
    },
    ...loadVisuals(),
  ].slice(0, 40)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
