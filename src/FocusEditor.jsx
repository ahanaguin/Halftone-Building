import { useEffect, useRef, useState } from 'react'
import { FOCUS_SPAN, ensureFocus } from './collageField.js'

function fit(stage, width, height) {
  if (!stage || !(width > 0) || !(height > 0)) return null
  const box = stage.getBoundingClientRect()
  const scale = Math.min(box.width / width, box.height / height)
  const w = width * scale
  const h = height * scale
  return { left: (box.width - w) / 2, top: (box.height - h) / 2, width: w, height: h }
}

export function FocusEditor({ images, focus, onChange, onClose }) {
  const [active, setActive] = useState(images[0]?.id || '')
  const [points, setPoints] = useState([])
  const [selected, setSelected] = useState(0)
  const [natural, setNatural] = useState(null)
  const [frame, setFrame] = useState(null)
  const stageRef = useRef(null)
  const frameRef = useRef(null)
  const pointsRef = useRef(points)
  const dragRef = useRef(null)
  pointsRef.current = points
  const image = images.find((item) => item.id === active) || images[0]
  const savedKey = image && Array.isArray(focus?.[image.id]) ? JSON.stringify(focus[image.id]) : ''

  useEffect(() => {
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    let cancel = false
    if (!image) return undefined
    if (savedKey) {
      setPoints(JSON.parse(savedKey).slice(0, 6))
      return undefined
    }
    ensureFocus(image.url).then((found) => {
      if (!cancel) setPoints(found.slice(0, 6))
    })
    return () => {
      cancel = true
    }
  }, [image, savedKey])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const measure = () => setFrame(fit(stage, natural?.width, natural?.height))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [natural])

  function pointFromEvent(event) {
    const node = frameRef.current
    if (!node) return null
    const box = node.getBoundingClientRect()
    if (!(box.width > 0) || !(box.height > 0)) return null
    return {
      x: Math.min(0.98, Math.max(0.02, (event.clientX - box.left) / box.width)),
      y: Math.min(0.98, Math.max(0.02, (event.clientY - box.top) / box.height)),
    }
  }

  function spanOf(point) {
    const span = Number(point?.span)
    return Number.isFinite(span) ? Math.min(0.95, Math.max(0.12, span)) : FOCUS_SPAN
  }

  function spanFromEvent(event, point) {
    const node = frameRef.current
    if (!node || !point) return null
    const box = node.getBoundingClientRect()
    if (!(box.width > 0)) return null
    const cx = box.left + point.x * box.width
    const cy = box.top + point.y * box.height
    const dist = Math.hypot(event.clientX - cx, event.clientY - cy)
    return Math.min(0.95, Math.max(0.12, (dist * 2) / box.width))
  }

  function onFrameClick(event) {
    if (event.target.closest('.focus-point')) return
    if (points.length >= 6) return
    const point = pointFromEvent(event)
    if (!point || !image) return
    const next = [...points, { ...point, span: FOCUS_SPAN }]
    setPoints(next)
    setSelected(next.length - 1)
    onChange(image.id, next)
  }

  function onPointDown(event, index) {
    event.stopPropagation()
    event.preventDefault()
    setSelected(index)
    dragRef.current = { index, pointer: event.pointerId, moved: false, resize: false }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic and already-released pointers cannot be captured.
    }
  }

  function onResizeDown(event, index) {
    event.stopPropagation()
    event.preventDefault()
    setSelected(index)
    dragRef.current = { index, pointer: event.pointerId, moved: false, resize: true }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic and already-released pointers cannot be captured.
    }
  }

  function onPointMove(event) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointer) return
    const current = pointsRef.current[drag.index]
    if (!current) return
    if (drag.resize) {
      const span = spanFromEvent(event, current)
      if (span == null || Math.abs(span - spanOf(current)) < 0.004) return
      drag.moved = true
      const next = pointsRef.current.map((item, index) => (index === drag.index ? { ...item, span } : item))
      pointsRef.current = next
      setPoints(next)
      return
    }
    const point = pointFromEvent(event)
    if (!point) return
    drag.moved = true
    const next = pointsRef.current.map((item, index) => (index === drag.index ? { ...item, x: point.x, y: point.y } : item))
    pointsRef.current = next
    setPoints(next)
  }

  function onPointUp(event) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointer) return
    dragRef.current = null
    if (drag.moved && image) onChange(image.id, pointsRef.current)
  }

  function remove(event, index) {
    event.stopPropagation()
    event.preventDefault()
    if (!image) return
    const next = points.filter((_, cursor) => cursor !== index)
    setPoints(next)
    setSelected((current) => (current === index ? 0 : current > index ? current - 1 : current))
    onChange(image.id, next)
  }

  return (
    <div className="focus-editor" onClick={onClose}>
      <div
        className="focus-card"
        role="dialog"
        aria-modal="true"
        aria-label="Edit focus points"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="focus-head">
          <div>
            <strong>Focus points</strong>
            <p>Point 1 is the largest frame. Each point is a crop, and the ring is how much of that photo the frame shows.</p>
          </div>
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        </div>
        {images.length > 1 ? (
          <div className="focus-images">
            {images.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === image?.id ? 'focus-thumb is-on' : 'focus-thumb'}
                aria-label={item.name || 'Image'}
                onClick={() => setActive(item.id)}
              >
                <img src={item.url} alt="" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="focus-stage" ref={stageRef}>
          {image ? (
            <div className="focus-frame" ref={frameRef} style={frame || undefined} onClick={onFrameClick}>
              <img
                src={image.url}
                alt=""
                draggable={false}
                onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              />
              {frame
                ? points.map((point, index) => {
                    const span = spanOf(point)
                    const ring = span * frame.width
                    return (
                      <div
                        key={index}
                        className={index === selected ? 'focus-point is-on' : 'focus-point'}
                        style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                        onPointerDown={(event) => onPointDown(event, index)}
                        onPointerMove={onPointMove}
                        onPointerUp={onPointUp}
                        onPointerCancel={onPointUp}
                      >
                        <span className="focus-index">{index + 1}</span>
                        {index === selected ? (
                          <>
                            <span className="focus-ring" style={{ width: ring, height: ring }} />
                            <button
                              type="button"
                              className="focus-handle"
                              aria-label="Show more or less around this point"
                              style={{ left: `calc(50% + ${ring / 2}px)` }}
                              onPointerDown={(event) => onResizeDown(event, index)}
                              onPointerMove={onPointMove}
                              onPointerUp={onPointUp}
                              onPointerCancel={onPointUp}
                            />
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="focus-remove"
                          aria-label="Remove focus point"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => remove(event, index)}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })
                : null}
            </div>
          ) : (
            <p className="focus-empty">Add a photo to place focus points.</p>
          )}
        </div>
      </div>
    </div>
  )
}
