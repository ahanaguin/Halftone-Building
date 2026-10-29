import { shapeFill } from './calibrate.js'
import p5 from 'p5'
import { layoutShapes } from './shapeLayout.js'

export function mountShapes(node, liveRef, sizeRef) {
  const token = {}
  node.__halftoneSketch = token

  const sketch = (p) => {
    p.setup = () => {
      if (node.__halftoneSketch !== token) {
        p._loop = false
        p.canvas?.remove()
        return
      }
      for (const canvas of [...node.querySelectorAll('canvas')]) {
        if (canvas !== p.canvas) canvas.remove()
      }
      const { w, h } = sizeRef.current
      p.createCanvas(Math.max(10, w), Math.max(10, h))
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1))
      p.background(liveRef.current.background || '#1c3a44')
    }

    p.draw = () => {
      if (node.__halftoneSketch !== token) {
        p._loop = false
        return
      }
      const { w, h } = sizeRef.current
      if (w > 10 && h > 10 && (p.width !== w || p.height !== h)) p.resizeCanvas(w, h)

      const live = liveRef.current
      const colors = live.colors?.length ? live.colors : ['#2a6d78', '#314878', '#243d38']
      p.background(live.background || '#1c3a44')
      const shown = layoutShapes({
        seed: live.seed || 1,
        width: p.width,
        height: p.height,
        time: live.time || 0,
        loud: live.loud ?? 0.35,
        bass: live.bass ?? 0.4,
        high: live.high ?? 0.25,
        tempo: live.tempo || 100,
        roundness: live.roundness ?? 0.7,
      })

      for (const shape of shown) {
        p.push()
        p.translate(shape.x, shape.y)
        p.rotate(shape.rot)
        p.noStroke()
        const fill = live.groups
          ? shapeFill(shape, live.groups, live.sectionLabel, live.references)
          : colors[shape.index % colors.length]
        p.fill(fill)
        p.drawingContext.globalAlpha = shape.band === 'low' ? 0.92 : 0.78
        if (shape.kind === 'circle') p.circle(0, 0, shape.size)
        else if (shape.kind === 'arc') p.arc(0, 0, shape.size, shape.size, 0, p.PI)
        else if (shape.kind === 'wedge') p.arc(0, 0, shape.size, shape.size, -0.5, 0.85, p.PIE)
        else p.triangle(-shape.size / 2, shape.size / 2.5, shape.size / 2, shape.size / 2.5, 0, -shape.size / 2.1)
        p.drawingContext.globalAlpha = 1
        p.pop()
      }
    }
  }

  const instance = new p5(sketch, node)
  return () => {
    if (node.__halftoneSketch === token) node.__halftoneSketch = null
    instance._loop = false
    instance.canvas?.remove()
    instance.remove()
  }
}
