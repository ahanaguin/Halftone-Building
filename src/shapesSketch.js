import p5 from 'p5'
import { paintFrame } from './drawFrame.js'

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
      p.background('#111111')
    }

    p.draw = () => {
      if (!p.canvas?.isConnected) {
        p._loop = false
        return
      }
      const { w, h } = sizeRef.current
      if (w > 10 && h > 10 && (p.width !== w || p.height !== h)) p.resizeCanvas(w, h)

      const live = liveRef.current
      paintFrame(p.drawingContext, {
        width: p.width,
        height: p.height,
        time: live.time || 0,
        seed: live.seed || 1,
        loud: live.loud ?? 0.35,
        bass: live.bass ?? 0.4,
        high: live.high ?? 0.25,
        tempo: live.tempo || 100,
        roundness: live.roundness ?? 0.7,
        colors: live.colors,
        palette: live.palette,
        sections: live.sections,
        seeds: live.seeds,
        edits: live.edits,
        profile: live.profile,
        sectionLabel: live.sectionLabel,
        tune: live.tune,
        background: live.background,
        shine: live.shine,
        speed: live.speed,
        print: live.print,
        style: live.style,
        images: live.images,
        imageIds: live.imageIds,
        imageSwitch: live.imageSwitch,
        focus: live.focus,
        playing: live.playing === true,
      })
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
