import p5 from 'p5'

const SHAPE_COUNT = 36

export function mountShapes(node, liveRef, sizeRef) {
  const token = {}
  node.__halftoneSketch = token

  const sketch = (p) => {
    const shapes = []
    let seen = false
    let lastKey = ''

    function seed() {
      const width = p.width
      const height = p.height
      for (let index = 0; index < SHAPE_COUNT; index += 1) {
        const band = index % 3 === 0 ? 'low' : index % 3 === 1 ? 'mid' : 'high'
        const next = {
          band,
          x: p.random(width),
          y: band === 'low' ? height * p.random(0.7, 0.94) : band === 'high' ? height * p.random(0.05, 0.24) : height * p.random(0.36, 0.62),
          drift: p.random(-1, 1),
          wobble: p.random(p.TWO_PI),
          spin: p.random(-0.02, 0.02),
          rot: p.random(p.TWO_PI),
          colorIndex: index % 3,
        }
        if (shapes[index]) Object.assign(shapes[index], next)
        else shapes.push(next)
      }
    }

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
      p.background(10, 10, 10)
      seed()
    }

    p.draw = () => {
      if (node.__halftoneSketch !== token) {
        p._loop = false
        return
      }
      const { w, h } = sizeRef.current
      if (w > 10 && h > 10 && (p.width !== w || p.height !== h)) {
        const previousWidth = p.width
        const previousHeight = p.height
        p.resizeCanvas(w, h)
        for (const shape of shapes) {
          shape.x = (shape.x / previousWidth) * w
          shape.y = (shape.y / previousHeight) * h
        }
      }

      const live = liveRef.current
      if (seen && live.sectionKey && live.sectionKey !== lastKey) seed()
      seen = true
      lastKey = live.sectionKey || ''

      p.background(10, 10, 10)
      const loud = live.loud ?? 0.35
      const visible = Math.max(5, Math.round(p.lerp(6, shapes.length, loud)))
      const tempo = live.tempo || 100
      const speed = p.lerp(0.35, 2.5, p.constrain((tempo - 70) / 90, 0, 1))
      const colors = live.colors?.length ? live.colors : ['#2a6d78', '#314878', '#243d38']
      const order = { high: 0, mid: 1, low: 2 }
      const shown = shapes.slice(0, visible).sort((left, right) => order[left.band] - order[right.band])

      for (let index = 0; index < shown.length; index += 1) {
        const shape = shown[index]
        const harsh = live.harsh ?? 0.2
        const kind = harsh > 0.55 ? (shape.band === 'low' ? 'wedge' : 'triangle') : shape.band === 'high' ? 'arc' : 'circle'
        const size =
          shape.band === 'low'
            ? p.lerp(48, 156, live.bass ?? 0.4) * p.lerp(0.68, 1.28, loud)
            : shape.band === 'high'
              ? p.lerp(8, 26, live.high ?? 0.3)
              : p.lerp(18, 58, loud)

        shape.x += shape.drift * speed
        shape.wobble += 0.012 * speed
        shape.rot += shape.spin * speed
        if (shape.x < -size) shape.x = p.width + size
        if (shape.x > p.width + size) shape.x = -size

        const y = shape.y + Math.sin(shape.wobble) * (shape.band === 'low' ? 5 : 10)
        p.push()
        p.translate(shape.x, y)
        p.rotate(shape.rot)
        p.noStroke()
        p.fill(colors[shape.colorIndex % colors.length])
        p.drawingContext.globalAlpha = shape.band === 'low' ? 0.92 : 0.78
        if (kind === 'circle') p.circle(0, 0, size)
        else if (kind === 'arc') p.arc(0, 0, size, size, 0, p.PI)
        else if (kind === 'wedge') p.arc(0, 0, size, size, -0.5, 0.85, p.PIE)
        else p.triangle(-size / 2, size / 2.5, size / 2, size / 2.5, 0, -size / 2.1)
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
