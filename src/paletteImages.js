const DB_NAME = 'halftone-palette'
const DB_VERSION = 1
const STORE = 'images'

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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
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

async function withStore(mode, work) {
  const db = await openDb()
  const tx = db.transaction(STORE, mode)
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  const result = await work(tx.objectStore(STORE))
  await done
  return result
}

export async function listPaletteImages() {
  return withStore('readonly', async (store) => {
    const rows = await requestOf(store.getAll())
    return (rows || []).sort((left, right) => left.id - right.id)
  })
}

export async function replacePaletteImages(files) {
  return withStore('readwrite', async (store) => {
    await requestOf(store.clear())
    for (const file of files || []) {
      const blob = file instanceof Blob ? file : file.blob
      if (!blob) continue
      await requestOf(
        store.add({
          name: file.name || 'image',
          type: file.type || blob.type || 'image/jpeg',
          blob,
        }),
      )
    }
  })
}

export function recordsToFiles(records) {
  return (records || []).map((item) => {
    const blob = item.blob || item
    const name = item.name || 'image'
    const type = item.type || blob.type || 'image/jpeg'
    return blob instanceof File ? blob : new File([blob], name, { type })
  })
}
