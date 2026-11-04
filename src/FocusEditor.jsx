import { useEffect, useRef, useState } from 'react'
import { ensureFocus } from './collageField.js'

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

  function onFrameClick(event) {
    if (event.target.closest('.focus-point')) return
    if (points.length >= 6) return
    const point = pointFromEvent(event)
    if (!point || !image) return
    const next = [...points, point]
    setPoints(next)
    onChange(image.id, next)
  }

  function onPointDown(event, index) {
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = { index, pointer: event.pointerId, moved: false }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic and already-released pointers cannot be captured.
    }
  }

  function onPointMove(event) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointer) return
    const point = pointFromEvent(event)
    if (!point) return
    drag.moved = true
    const next = pointsRef.current.map((item, index) => (index === drag.index ? point : item))
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
            <p>{points.length} of 6. Click to add, drag to move.</p>
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
                ? points.map((point, index) => (
                    <div
                      key={index}
                      className="focus-point"
                      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                      onPointerDown={(event) => onPointDown(event, index)}
                      onPointerMove={onPointMove}
                      onPointerUp={onPointUp}
                      onPointerCancel={onPointUp}
                    >
                      <button
                        type="button"
                        aria-label="Remove focus point"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => remove(event, index)}
                      >
                        ×
                      </button>
                    </div>
                  ))
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
