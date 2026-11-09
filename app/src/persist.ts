import { createStore, get, set } from 'idb-keyval'

const store = typeof indexedDB !== 'undefined' ? createStore('language-map', 'saves') : null
const key = (pack: string) => `save:${pack}`
const lsKey = (pack: string) => `language-map:${key(pack)}`

/** `missing`: nothing saved yet. `error`: storage could not be read, so existing progress may be hidden. */
export type ReadResult = { status: 'ok'; data: unknown } | { status: 'missing' } | { status: 'error' }

function stamp(v: unknown): string {
  const u = v && typeof v === 'object' ? (v as { updatedAt?: unknown }).updatedAt : undefined
  return typeof u === 'string' ? u : ''
}

/** Read the save, preferring the newer of the IndexedDB and localStorage copies. */
export async function readSave(pack: string): Promise<ReadResult> {
  let idb: unknown
  let idbFailed = false
  if (store) {
    try {
      idb = await get(key(pack), store)
    } catch {
      idbFailed = true
    }
  }
  let ls: unknown
  try {
    const raw = localStorage.getItem(lsKey(pack))
    ls = raw ? JSON.parse(raw) : undefined
  } catch {
    // localStorage unavailable or corrupt; IndexedDB is the primary store anyway
  }
  const found = [idb, ls].filter((v) => v !== undefined)
  if (found.length) {
    const newest = found.reduce((a, b) => (stamp(b) > stamp(a) ? b : a))
    return { status: 'ok', data: newest }
  }
  // An IndexedDB failure with an empty localStorage may hide real progress; don't call it "missing".
  if (idbFailed) return { status: 'error' }
  return { status: 'missing' }
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('language-map') : null
/** Newest save stamp written by any tab, per pack; older writes are dropped so a stale tab can't clobber newer progress. */
const newestSeen = new Map<string, string>()
function see(pack: string, updatedAt: string) {
  if (updatedAt > (newestSeen.get(pack) ?? '')) newestSeen.set(pack, updatedAt)
}
channel?.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as { type?: string; pack?: string; updatedAt?: string }
  if (m?.type === 'saved' && typeof m.pack === 'string') see(m.pack, m.updatedAt ?? '')
})

async function writeSave(pack: string, data: unknown): Promise<void> {
  let ok = false
  if (store) {
    try {
      await set(key(pack), data, store)
      ok = true
    } catch {
      // fall through to localStorage
    }
  }
  if (!ok) {
    try {
      localStorage.setItem(lsKey(pack), JSON.stringify(data))
      ok = true
    } catch {
      // storage unavailable (private mode); progress lives in memory only
    }
  }
  if (ok) {
    see(pack, stamp(data))
    channel?.postMessage({ type: 'saved', pack, updatedAt: stamp(data) })
  }
}

/** Called when another tab saved newer progress for `pack`. */
export function onExternalSave(fn: (pack: string, updatedAt: string) => void): () => void {
  if (!channel) return () => {}
  const handler = (e: MessageEvent) => {
    const m = e.data as { type?: string; pack?: string; updatedAt?: string }
    if (m?.type === 'saved' && typeof m.pack === 'string') fn(m.pack, m.updatedAt ?? '')
  }
  channel.addEventListener('message', handler)
  return () => channel.removeEventListener('message', handler)
}

let enabled = true
let timer: ReturnType<typeof setTimeout> | null = null
let pending: { pack: string; data: unknown } | null = null

/** Stop all writes (used when the existing save could not be read, so we never overwrite it). */
export function disableWrites(): void {
  enabled = false
  cancelPendingWrite()
}

export function enableWrites(): void {
  enabled = true
}

export function cancelPendingWrite(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
}

export function scheduleWrite(pack: string, data: unknown, delay = 400): void {
  if (!enabled) return
  pending = { pack, data }
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushWrites, delay)
}

export function flushWrites(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (pending && enabled) {
    const { pack, data } = pending
    pending = null
    if (stamp(data) >= (newestSeen.get(pack) ?? '')) void writeSave(pack, data)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWrites)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWrites()
  })
}
