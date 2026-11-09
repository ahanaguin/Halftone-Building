import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { previewIsStale, refreshStalePreview } from './previewCapture.js'
import { useVisualSession } from './visualSession.jsx'
import {
  deleteVisual,
  duplicateVisual,
  formatVisualDate,
  listVisuals,
  onVisualsChange,
  renameVisual,
  storageStatus,
  styleLabel,
} from './visuals.js'

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  )
}

function VisualCard({ item, urls, live, menuOpen, onHover, onLeave, onOpen, onMenu, onRename, onDuplicate, onDownload, onDelete }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (live && !reduce && item.preview) {
      video.currentTime = 0
      const play = video.play()
      if (play) play.catch(() => {})
      return () => {
        video.pause()
        video.currentTime = 0
      }
    }
    video.pause()
    video.currentTime = 0
    return undefined
  }, [live, item.preview])

  return (
    <article
      className={live || menuOpen ? 'library-card is-hot' : 'library-card'}
      onPointerEnter={onHover}
      onPointerLeave={onLeave}
    >
      <button type="button" className="library-card-hit" onClick={onOpen} aria-label={`Open ${item.name}`}>
        <span className="library-card-preview">
          {item.preview ? (
            <video
              ref={videoRef}
              poster={urls.thumbnail || undefined}
              src={urls.preview}
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
          ) : urls.thumbnail ? (
            <img src={urls.thumbnail} alt="" />
          ) : null}
        </span>
        <span className="library-card-copy">
          <strong>{item.name}</strong>
          <span className="library-meta">
            {styleLabel(item.style)} · {item.composition || 'Auto'}
          </span>
          <time dateTime={new Date(item.updatedAt || item.createdAt).toISOString()}>
            {formatVisualDate(item.updatedAt || item.createdAt)}
          </time>
        </span>
      </button>
      <div className="library-card-actions">
        <button type="button" className="button library-open" onClick={onOpen}>
          Open in studio
        </button>
        <button
          type="button"
          className={menuOpen ? 'library-more is-on' : 'library-more'}
          aria-label="More"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation()
            onMenu()
          }}
        >
          <MoreIcon />
        </button>
        {menuOpen ? (
          <div className="library-menu" role="menu">
            <button type="button" role="menuitem" onClick={onRename}>
              Rename
            </button>
            <button type="button" role="menuitem" onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" role="menuitem" onClick={onDownload}>
              Download
            </button>
            <button type="button" role="menuitem" onClick={onDelete}>
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function Modal({ title, body, children, onClose }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="library-modal" role="presentation" onClick={onClose}>
      <div
        className="library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="library-dialog-title">{title}</h2>
        {body ? <p>{body}</p> : null}
        {children}
      </div>
    </div>
  )
}

export function MyVisuals() {
  const navigate = useNavigate()
  const { restoreVisual, beginNewVisual, setVisualName, visualId } = useVisualSession()
  const [items, setItems] = useState([])
  const [urls, setUrls] = useState({})
  const [hover, setHover] = useState(null)
  const [menu, setMenu] = useState(null)
  const [warning, setWarning] = useState(false)
  const [rename, setRename] = useState(null)
  const [remove, setRemove] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const renameRef = useRef(null)
  const urlsRef = useRef({})

  async function load() {
    try {
      const next = await listVisuals()
      const nextUrls = {}
      for (const item of next) {
        nextUrls[item.id] = {
          thumbnail: item.thumbnail ? URL.createObjectURL(item.thumbnail) : '',
          preview: item.preview ? URL.createObjectURL(item.preview) : '',
        }
      }
      const previous = urlsRef.current
      urlsRef.current = nextUrls
      setItems(next)
      setUrls(nextUrls)
      for (const pack of Object.values(previous)) {
        if (pack.thumbnail) URL.revokeObjectURL(pack.thumbnail)
        if (pack.preview) URL.revokeObjectURL(pack.preview)
      }
      const space = await storageStatus()
      setWarning(space.warning)
      setError('')
    } catch {
      setError('Visuals could not be read from this browser.')
    }
  }

  useEffect(() => {
    load()
    return onVisualsChange(load)
  }, [])

  useEffect(() => {
    let cancel = false
    async function refresh() {
      for (const item of items) {
        if (cancel || !previewIsStale(item)) continue
        try {
          await refreshStalePreview(item.id)
        } catch {
          /* ignore */
        }
      }
    }
    refresh()
    return () => {
      cancel = true
    }
  }, [items])

  useEffect(
    () => () => {
      for (const pack of Object.values(urlsRef.current)) {
        if (pack.thumbnail) URL.revokeObjectURL(pack.thumbnail)
        if (pack.preview) URL.revokeObjectURL(pack.preview)
      }
    },
    [],
  )

  useEffect(() => {
    if (rename) renameRef.current?.focus()
  }, [rename])

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') setMenu(null)
    }
    function onPointer(event) {
      if (!event.target.closest('.library-card')) setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  async function openItem(item, to) {
    setBusy(true)
    setError('')
    try {
      await restoreVisual(item.id)
      navigate(to, { state: { skipIntro: true } })
    } catch (caught) {
      setError(caught?.message || 'That visual could not be opened.')
      setBusy(false)
    }
  }

  async function handleDuplicate(item) {
    setMenu(null)
    try {
      await duplicateVisual(item.id)
      await load()
    } catch {
      setError('That visual could not be duplicated.')
    }
  }

  async function confirmRename() {
    if (!rename) return
    const ok = await renameVisual(rename.id, rename.value)
    if (ok && rename.id === visualId) setVisualName(rename.value.trim())
    setRename(null)
    await load()
  }

  async function confirmDelete() {
    if (!remove) return
    try {
      await deleteVisual(remove.id)
      setRemove(null)
      await load()
    } catch {
      setError('That visual could not be deleted.')
    }
  }

  return (
    <main className="screen-library">
      <div className="screen-library-inner">
        <h1>My visuals</h1>
        <p className="lede">Saved in this browser only. Clearing your browser data removes them.</p>
        {warning ? (
          <p className="library-warning" role="status">
            This browser is almost out of space. Delete old visuals to keep saving.
          </p>
        ) : null}
        {error ? (
          <p className="library-warning" role="alert">
            {error}
          </p>
        ) : null}
        {items.length ? (
          <div className="library-grid">
            {items.map((item) => (
              <VisualCard
                key={item.id}
                item={item}
                urls={urls[item.id] || {}}
                live={hover === item.id}
                menuOpen={menu === item.id}
                onHover={() => setHover(item.id)}
                onLeave={() => setHover((current) => (current === item.id ? null : current))}
                onOpen={() => openItem(item, '/studio')}
                onMenu={() => setMenu((current) => (current === item.id ? null : item.id))}
                onRename={() => {
                  setMenu(null)
                  setRename({ id: item.id, value: item.name })
                }}
                onDuplicate={() => handleDuplicate(item)}
                onDownload={() => openItem(item, '/export')}
                onDelete={() => {
                  setMenu(null)
                  setRemove(item)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="library-empty">
            <p>Nothing here yet.</p>
            <Link className="button" to="/" onClick={beginNewVisual}>
              Make your first visual
            </Link>
          </div>
        )}
      </div>
      {rename ? (
        <Modal title="Rename" onClose={() => setRename(null)}>
          <input
            ref={renameRef}
            className="library-rename"
            value={rename.value}
            onChange={(event) => setRename({ ...rename, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirmRename()
            }}
            maxLength={60}
          />
          <div className="library-dialog-actions">
            <button type="button" className="button-outline" onClick={() => setRename(null)}>
              Cancel
            </button>
            <button type="button" className="button" onClick={confirmRename} disabled={!rename.value.trim()}>
              Save
            </button>
          </div>
        </Modal>
      ) : null}
      {remove ? (
        <Modal
          title="Delete this visual?"
          body="This can't be undone."
          onClose={() => setRemove(null)}
        >
          <div className="library-dialog-actions">
            <button type="button" className="button-outline" onClick={() => setRemove(null)}>
              Cancel
            </button>
            <button type="button" className="button" onClick={confirmDelete}>
              Delete
            </button>
          </div>
        </Modal>
      ) : null}
      {busy ? <div className="library-busy" aria-hidden="true" /> : null}
    </main>
  )
}
