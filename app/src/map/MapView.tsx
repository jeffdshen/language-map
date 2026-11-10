import { useEffect, useRef } from 'react'
import { cellIndex } from '../data/pack'
import { walkGrid } from '../logic/walk'
import { useStore } from '../store'
import { emitCamera, loadCamera, saveCamera } from './camera'
import { Minimap } from './Minimap'
import { loadPlayer, nearTarget, nextUnexplored, Player, savePlayer } from './player'
import { MapRenderer, type PanelMode } from './renderer'

const MOVE_KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  arrowup: [0, -1],
  arrowleft: [-1, 0],
  arrowdown: [0, 1],
  arrowright: [1, 0],
}

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
}

function panelMode(s: { selected: number | null; details: boolean }): PanelMode {
  return s.selected === null ? 'none' : s.details ? 'details' : 'popover'
}

/** Imperative handle on the map, for the HUD buttons. */
interface MapHandle {
  zoom(factor: number): void
  center(): void
}

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handle = useRef<MapHandle | null>(null)
  const details = useStore((s) => s.selected !== null && s.details)

  useEffect(() => {
    const canvas = canvasRef.current!
    const renderer = new MapRenderer(canvas)
    const init = useStore.getState()
    const pack = init.pack!
    const { world } = pack
    const packName = pack.manifest.pack
    const layout = pack.manifest.layoutVersion
    const grid = walkGrid(pack)
    const start = loadPlayer(packName, layout) ?? { x: world.spawn[0], y: world.spawn[1] + 2 }
    const player = new Player(grid, start.x, start.y)
    let keyHints = false

    const sync = () => {
      const s = useStore.getState()
      if (!s.pack || !s.view) return
      renderer.setState({
        pack: s.pack,
        view: s.view,
        settings: s.save.settings,
        selected: s.selected,
        hovered: s.hovered,
        hall: s.hall,
      })
      renderer.setPanel(panelMode(s))
    }

    const updateNear = () => {
      const s = useStore.getState()
      if (!s.view) return
      renderer.setNear(nearTarget(pack, s.view, s.save.settings.fogMode === 'hidden', player.x, player.y), keyHints)
    }

    let saveTimer = 0
    const scheduleSave = () => {
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => savePlayer(packName, layout, player.x, player.y), 500)
    }

    let lastCell = ''
    /** After the player moves: update the region, what's in reach, and close a dialog left behind. */
    const onMoved = (manual: boolean) => {
      const s = useStore.getState()
      const cell = `${Math.round(player.x)},${Math.round(player.y)}`
      if (cell !== lastCell) {
        lastCell = cell
        s.setFocus(player.x, player.y)
      }
      updateNear()
      scheduleSave()
      if (manual && s.selected !== null && s.selectedFrom === 'map' && !s.details) {
        const w = pack.words[s.selected]
        if (Math.hypot(w.x - player.x, w.y - player.y) > 4) s.select(null)
      }
    }

    // ---- the game loop: runs while a key is held or the player is walking somewhere
    const held = new Set<string>()
    let run = false
    let loopRaf = 0
    let last = 0
    const loop = (now: number) => {
      loopRaf = 0
      const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 1 / 60
      last = now
      let dx = 0
      let dy = 0
      for (const key of held) {
        dx += MOVE_KEYS[key][0]
        dy += MOVE_KEYS[key][1]
      }
      const manual = dx !== 0 || dy !== 0
      const moved = player.update(dt, { dx, dy, run })
      if (moved) {
        renderer.follow()
        onMoved(manual)
      }
      renderer.setPlayer(player)
      if (held.size || player.busy) loopRaf = requestAnimationFrame(loop)
      else {
        last = 0
        if (player.moving) {
          player.moving = false
          renderer.setPlayer(player)
        }
      }
    }
    const kick = () => {
      if (!loopRaf) loopRaf = requestAnimationFrame(loop)
    }

    /** Walk to a cell (next to it, for a landmark). Returns false if there's no way there. */
    const goTo = (x: number, y: number, arrive?: () => void): boolean => {
      const ok = player.walkTo(x, y, arrive)
      if (ok) {
        renderer.follow()
        kick()
      }
      return ok
    }

    /** Fast travel: put the player next to (x, y). */
    const travel = (x: number, y: number) => {
      const k = cellIndex(world, x, y)
      // Stand in front of what's there: below its label for halls and the fountain, next to it for a word.
      const big = k >= 0 && (pack.hallAt[k] >= 0 || (x === world.spawn[0] && y === world.spawn[1]))
      const word = k >= 0 && pack.wordAt[k] >= 0
      player.teleport(x, big ? y + 2 : word ? y + 1 : y)
      renderer.setPlayer(player)
      renderer.flyToPlayer()
      onMoved(false)
      scheduleSave()
    }

    const onCameraRequest = () => {
      const s = useStore.getState()
      const c = s.camera
      if (!c) return
      if (c.travel) travel(c.x, c.y)
      else renderer.flyTo(c.x, c.y, { resetZoom: c.resetZoom })
    }

    renderer.onCamera = (cam) => emitCamera(cam)
    let zoomTimer = 0
    const rememberZoom = () => {
      window.clearTimeout(zoomTimer)
      zoomTimer = window.setTimeout(() => {
        const cam = renderer.info()
        saveCamera(packName, { x: cam.x, y: cam.y, zoom: cam.scale / cam.base })
      }, 400)
    }

    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.pack !== prev.pack ||
        s.view !== prev.view ||
        s.save.settings !== prev.save.settings ||
        s.selected !== prev.selected ||
        s.details !== prev.details ||
        s.hovered !== prev.hovered ||
        s.hall !== prev.hall
      ) {
        sync()
      }
      if (s.view !== prev.view || s.save.settings !== prev.save.settings) updateNear()
      if (s.camera && s.camera !== prev.camera) onCameraRequest()
      if (s.nextSeq !== prev.nextSeq) next()
    })

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1)
    }
    sync()
    renderer.setPlayer(player)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    renderer.setZoom(loadCamera(packName)?.zoom ?? 1)
    renderer.follow(true)
    onMoved(false)
    onCameraRequest()

    const interact = () => {
      const s = useStore.getState()
      if (!s.view) return
      const t = nearTarget(pack, s.view, s.save.settings.fogMode === 'hidden', player.x, player.y)
      if (!t) return
      if ('word' in t) {
        if (s.selected !== t.word) s.select(t.word, 'map')
      } else s.openHall(t.hall)
    }

    const next = () => {
      const s = useStore.getState()
      if (!s.view) return
      const j = s.here >= 0 ? nextUnexplored(pack, s.view, s.here, player.x, player.y) : null
      if (j === null) {
        s.toast('Every word in this region is explored. Try the challenge at its hall, or head on to the next region.')
        return
      }
      s.select(j, 'map')
      const w = pack.words[j]
      if (!goTo(w.x, w.y)) renderer.flyTo(w.x, w.y)
    }

    handle.current = {
      zoom: (f) => {
        renderer.zoomBy(f)
        rememberZoom()
      },
      center: () => renderer.follow(),
    }

    // ---- pointer: tap to walk / talk, drag to look around, pinch or wheel to zoom
    const pointers = new Map<number, { x: number; y: number }>()
    let dragged = false
    let downAt = { x: 0, y: 0 }
    let pinchDist = 0

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const click = (sx: number, sy: number) => {
      const s = useStore.getState()
      const hit = renderer.hitTest(sx, sy)
      if (hit && 'word' in hit) {
        const w = pack.words[hit.word]
        s.select(hit.word, 'map')
        goTo(w.x, w.y)
      } else if (hit && 'hall' in hit) {
        const r = world.regions[hit.hall]
        const open = () => useStore.getState().openHall(hit.hall)
        if (!goTo(r.x, r.y, open)) open()
      } else {
        if (s.selected !== null) s.select(null)
        const [wx, wy] = renderer.screenToWorld(sx, sy)
        goTo(Math.round(wx), Math.round(wy))
      }
    }

    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic or already-released pointers can't be captured; dragging still works without it.
      }
      if (e.pointerType === 'touch' && keyHints) {
        keyHints = false
        updateNear()
      }
      const p = local(e)
      pointers.set(e.pointerId, p)
      if (pointers.size === 1) {
        dragged = false
        downAt = p
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        dragged = true
      }
    }

    const onMove = (e: PointerEvent) => {
      const p = local(e)
      const prev = pointers.get(e.pointerId)
      if (!prev) {
        const hit = renderer.hitTest(p.x, p.y)
        useStore.getState().hover(hit && 'word' in hit ? hit.word : null)
        renderer.setHallHover(hit && 'hall' in hit ? hit.hall : null)
        canvas.style.cursor = hit ? 'pointer' : 'default'
        return
      }
      if (pointers.size === 1) {
        if (!dragged && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 6) dragged = true
        if (dragged) {
          renderer.panBy(p.x - prev.x, p.y - prev.y)
          canvas.style.cursor = 'grabbing'
        }
      } else if (pointers.size === 2) {
        const others = [...pointers.entries()].filter(([id]) => id !== e.pointerId)
        const o = others[0][1]
        const d = Math.hypot(p.x - o.x, p.y - o.y)
        if (pinchDist > 0) renderer.zoomAt((p.x + o.x) / 2, (p.y + o.y) / 2, d / pinchDist)
        pinchDist = d
        rememberZoom()
      }
      pointers.set(e.pointerId, p)
    }

    const onUp = (e: PointerEvent) => {
      const p = local(e)
      const had = pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (had && pointers.size === 0 && !dragged && e.type === 'pointerup') click(p.x, p.y)
      canvas.style.cursor = 'default'
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      renderer.zoomAt(p.x, p.y, Math.exp(-delta * 0.0015))
      rememberZoom()
    }

    const onLeave = () => {
      useStore.getState().hover(null)
      renderer.setHallHover(null)
    }

    // ---- keyboard: WASD / arrows to walk (Shift runs), E or Space to talk, N for the next new word
    const blocked = () => {
      const s = useStore.getState()
      return s.quest !== null || s.modal !== null || s.hall !== null
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') run = true
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || blocked()) return
      const key = e.key.toLowerCase()
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON'
      if (key in MOVE_KEYS) {
        e.preventDefault()
        held.add(key)
        if (!keyHints) {
          keyHints = true
          updateNear()
        }
        kick()
      } else if (key === 'e' || (key === ' ' && !onButton)) {
        e.preventDefault()
        interact()
      } else if (key === 'n') useStore.getState().nextWord()
      else if (key === 'c') renderer.follow()
      else if (key === '+' || key === '=') handle.current?.zoom(1.25)
      else if (key === '-' || key === '_') handle.current?.zoom(1 / 1.25)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') run = false
      held.delete(e.key.toLowerCase())
    }
    const onBlur = () => {
      held.clear()
      run = false
    }
    const onHide = () => savePlayer(packName, layout, player.x, player.y)

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onHide)

    return () => {
      unsub()
      ro.disconnect()
      renderer.destroy()
      onHide()
      handle.current = null
      window.clearTimeout(saveTimer)
      window.clearTimeout(zoomTimer)
      if (loopRaf) cancelAnimationFrame(loopRaf)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="map-canvas" aria-label="Vocabulary map. Click to walk; WASD or arrow keys to move." />
      <div className={`map-hud ${details ? 'panel-open' : ''}`}>
        <div className="zoom-controls">
          <button type="button" title="Zoom in (+)" aria-label="Zoom in" onClick={() => handle.current?.zoom(1.25)}>
            +
          </button>
          <button type="button" title="Zoom out (−)" aria-label="Zoom out" onClick={() => handle.current?.zoom(1 / 1.25)}>
            −
          </button>
          <button type="button" title="Center on you (C)" aria-label="Center on you" onClick={() => handle.current?.center()}>
            ◎
          </button>
          <button type="button" title="Back to the start (H)" aria-label="Back to the start" onClick={() => useStore.getState().flyHome()}>
            ⌂
          </button>
        </div>
        <Minimap />
      </div>
    </>
  )
}
