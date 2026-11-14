/**
 * The farmer's field diary.
 *
 * Logs what the user actually did and what the model says it bought. Every
 * entry is composed from bundle figures by the caller — the diary never
 * writes a number of its own, so it cannot drift from the panels beside it.
 *
 * The ink reveal is a clip-path sweep rather than per-character state: one
 * animated property, no timers, and it stops dead under reduced motion with
 * the full text still readable.
 */

import { useEffect, useRef, useState } from 'react'
import { playPageFlip, playPenScratch } from '../lib/sound'

export interface DiaryEntry {
  id: string
  /** Short date-ish stamp, e.g. "Day 272". */
  stamp: string
  text: string
}

export default function FarmerDiary({
  entries,
  reducedMotion = false,
  inline = false,
  onOpenFull,
}: {
  entries: DiaryEntry[]
  reducedMotion?: boolean
  /** Sit in the page flow (Act 2) rather than floating over every slide. */
  inline?: boolean
  /** Open the full diary modal rather than the inline strip. */
  onOpenFull?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(Infinity)
  const lastCount = useRef(entries.length)
  const lastId = useRef<string | null>(entries[0]?.id ?? null)

  // A new entry opens the diary and scratches it in.
  useEffect(() => {
    if (entries.length === lastCount.current) return
    const grew = entries.length > lastCount.current
    lastCount.current = entries.length
    if (!grew) return
    lastId.current = entries[0]?.id ?? null
    setOpen(true)
    if (reducedMotion) {
      setTyped(Infinity)
      return
    }
    // Write the newest entry out a character at a time, scratching the nib
    // every few letters. Firing one scratch and letting the text appear on
    // its own is the thing that reads as fake: the sound has to track the
    // writing, because that is what the farmer is doing on screen.
    const text = entries[0]?.text ?? ''
    setTyped(0)
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setTyped(i)
      if (i % 4 === 0) playPenScratch(2)
      if (i >= text.length) window.clearInterval(id)
    }, 22)
    return () => window.clearInterval(id)
  }, [entries, reducedMotion])

  if (!entries.length && !inline) return null

  return (
    <div className={`farmer-diary ${open ? 'is-open' : ''} ${inline ? 'is-inline' : ''}`}>
      <button
        type="button"
        className="diary-tab"
        onClick={() => {
          playPageFlip()
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-controls="diary-pages"
      >
        <span aria-hidden="true">✎</span> Field diary <span className="diary-count">{entries.length}</span>
      </button>

      {open && (
        <div className="diary-pages" id="diary-pages" role="log" aria-label="Field diary">
          <ul>
            {entries.map((e) => (
              <li key={e.id}>
                <span className="diary-stamp">{e.stamp}</span>
                <span className="diary-text">
                  {e.id === lastId.current ? e.text.slice(0, typed) : e.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inline && onOpenFull && (
        <button type="button" className="diary-open-full" onClick={onOpenFull}>
          Open the field diary &rarr;
        </button>
      )}
    </div>
  )
}
