import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import type { Sentence } from '../data/types'
import { Vis } from '../logic/explore'
import { useStore } from '../store'
import { speak } from '../tts'
import { levelLabel, tokenPinyin } from './text'
import { useSwipeDismiss } from './useSwipeDismiss'

export function LevelBadge({ level }: { level: number }) {
  return <span className={`badge level level-${level}`}>{levelLabel(level)}</span>
}

export function RegionTag({ region }: { region: number }) {
  const r = useStore((s) => s.pack!.world.regions[region])
  const flyToCell = useStore((s) => s.flyToCell)
  if (!r) return null
  return (
    <button
      type="button"
      className="badge region"
      style={{ ['--region' as string]: r.color }}
      title={`${r.en} (${r.kind === 'wild' ? 'wilderness' : 'town'}) — travel to its hall`}
      onClick={() => flyToCell(r.x, r.y, true)}
    >
      <span lang="zh-Hans">{r.zh}</span> · {r.en}
    </button>
  )
}

export function SpeakButton({ text, label, slow, className }: { text: string; label?: string; slow?: boolean; className?: string }) {
  const lang = useStore((s) => s.pack!.manifest.target.tts)
  const rate = useStore((s) => s.save.settings.ttsRate)
  return (
    <button
      type="button"
      className={`speak ${className ?? ''}`}
      title={slow ? 'Play slowly' : 'Play audio'}
      onClick={(e) => {
        e.stopPropagation()
        speak(text, lang, slow ? rate * 0.65 : rate)
      }}
    >
      {slow ? '🐢' : '🔊'}
      {label ? <span>{label}</span> : null}
    </button>
  )
}

/** A clickable word "character": shows hanzi + pinyin once discovered, otherwise a "?" with its level. */
export function WordChip({ i, showGloss }: { i: number; showGloss?: boolean }) {
  const w = useStore((s) => s.pack!.words[i])
  const vis = useStore((s) => s.view!.vis[i])
  const fog = useStore((s) => s.save.settings.fogMode)
  const color = useStore((s) => s.pack!.world.regions[w.region]?.color ?? s.pack!.world.themes[w.theme].color)
  const select = useStore((s) => s.select)
  const known = vis >= Vis.Revealed || fog !== 'hidden'
  const cls = vis === Vis.Learned ? 'learned' : vis === Vis.Active ? 'active' : vis >= Vis.Revealed ? 'revealed' : 'hidden'
  return (
    <button
      type="button"
      className={`chip ${cls}`}
      style={{ ['--region' as string]: color }}
      onClick={() => select(i, 'link', true)}
      title={known && (vis >= Vis.Revealed || fog === 'off') ? w.glosses[0] : `Undiscovered ${levelLabel(w.level)} word`}
    >
      {known ? (
        <>
          <span className="zh">{w.hanzi}</span>
          <span className="py">{w.pinyin}</span>
          {showGloss && vis >= Vis.Revealed ? <span className="gl">{w.glosses[0]}</span> : null}
        </>
      ) : (
        <>
          <span className="zh">?</span>
          <span className="py">{levelLabel(w.level)}</span>
        </>
      )}
    </button>
  )
}

export function Dots({
  have,
  need,
  marked,
  done,
}: {
  have: number
  need: number
  marked?: boolean
  done?: boolean
}) {
  if (marked) return <span className="dots marked">✓ marked</span>
  if (done) have = Math.max(have, need)
  const n = Math.min(have, need)
  if (need > 5)
    return (
      <span className="dots meter" aria-label={`${n} of ${need}`}>
        <span className="mini-bar">
          <span style={{ width: `${(100 * n) / need}%` }} />
        </span>
        <span className="num">
          {n}/{need}
        </span>
      </span>
    )
  return (
    <span className="dots" aria-label={`${n} of ${need}`}>
      {Array.from({ length: need }, (_, k) => (
        <span key={k} className={k < have ? 'dot on' : 'dot'} />
      ))}
    </span>
  )
}

export function SentenceView({
  sentence,
  target,
  pinyin,
  highlight = true,
  onWord,
}: {
  sentence: Sentence
  target: number
  pinyin?: boolean
  highlight?: boolean
  onWord?: (i: number) => void
}) {
  return (
    <span className={`sentence ${pinyin ? 'with-pinyin' : ''}`}>
      {sentence.seg.map((tok, k) => {
        const idx = tok.length >= 2 ? (tok[1] as number) : -1
        const py = pinyin ? tokenPinyin(tok) : ''
        const isTarget = highlight && idx === target
        const body = py ? (
          <ruby>
            {tok[0]}
            <rt>{py}</rt>
          </ruby>
        ) : (
          tok[0]
        )
        const cls = `tok${isTarget ? ' target' : ''}${onWord && idx >= 0 ? ' link' : ''}`
        return onWord && idx >= 0 ? (
          <span key={k} className={cls} onClick={() => onWord(idx)} role="button" tabIndex={0}>
            {body}
          </span>
        ) : (
          <span key={k} className={cls}>
            {body}
          </span>
        )
      })}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  className,
  wide,
}: {
  title?: ReactNode
  onClose?: () => void
  children: ReactNode
  className?: string
  wide?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const downOnBackdrop = useRef(false)
  const swipe = useSwipeDismiss(onClose)
  useEffect(() => {
    // Move focus into the dialog so keys don't hit buttons behind it; restore on close.
    const prev = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => prev?.focus?.()
  }, [])
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div
      className="modal-backdrop"
      // Close on a full tap/click on the backdrop (not a drag that started inside the dialog).
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose?.()
        downOnBackdrop.current = false
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''} ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        data-sheet
      >
        {title || onClose ? (
          <div className={onClose ? 'modal-head grip' : 'modal-head'} {...swipe}>
            {title ? <h2>{title}</h2> : <span />}
            {onClose ? (
              <button type="button" className="icon close" onClick={onClose} aria-label="Close">
                ×
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
