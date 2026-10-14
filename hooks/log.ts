// The lab log: each milestone a transfer reaches becomes one stamped line, written once,
// and so does anything worth knowing: pre-flight warnings, stalls, a crawling link,
// rsync's own complaints and what its exit code means.

import type { Log, LogLine, NoteLevel, Xfer } from '../types'
import { clockText, elapsedSeconds, size } from './format'

const KEEP = 40
const STALL_MS = 30000
const SLOW_RATE = 100 * 1024
const SLOW_AFTER_S = 10
const MILESTONES: [number, string][] = [
  [25, 'QUARTER FULL'],
  [50, 'HALFWAY — STEADY AS SHE GOES'],
  [75, 'THREE-QUARTERS, OOZE RISING'],
  [90, 'NEARLY THERE!'],
]

// rsync's exit codes in plain words (the ones a site transfer actually hits).
const EXIT_MEANING: Record<number, string> = {
  1: 'BAD ARGUMENTS',
  10: 'COULD NOT REACH THE OTHER END',
  11: 'FILE I/O ERROR',
  12: 'THE LINK DROPPED MID-STREAM',
  20: 'STOPPED (INTERRUPTED)',
  23: 'SOME FILES DID NOT MAKE IT',
  24: 'SOME FILES VANISHED MID-COPY',
  30: 'TIMED OUT',
  35: 'TIMED OUT CONNECTING',
  255: 'SSH FAILED (KEY, HOST OR NETWORK)',
}

/** The log after seeing `x` at `now`; the same object back when nothing new happened. */
export function advanceLog(prev: Log | null, x: Xfer, now: number): Log {
  const isSame = prev !== null && prev.id === x.id
  const lines = isSame ? [...prev.lines] : []
  const elapsed = elapsedSeconds(x.startedAt, now)
  const t = clockText(elapsed)
  const add = (text: string, level: NoteLevel = 'info') => {
    if (!lines.some(line => line.text === text)) lines.push({ text, at: now, t, level })
  }
  const arrow = x.direction === 'up' ? '▲ UP' : x.direction === 'down' ? '▼ DOWN' : '◆'

  for (const note of x.notes ?? []) add(note.text, note.level)
  if (x.state === 'counting') add('COUNTING THE GOODS...')
  if (x.state === 'raw') add('RAW RSYNC/SCP — NO BYTE COUNT, SLOSHING')
  if (x.total > 0 && (x.state === 'running' || x.state === 'done')) add(`PUMPING ${size(x.total)} ${arrow}`)
  if (x.state === 'running') {
    for (const [pct, text] of MILESTONES) if (x.pct >= pct) add(text)
    if (now - x.updatedAt > STALL_MS) add(`STALLED? NO DATA FOR ${Math.round((now - x.updatedAt) / 1000)}S`, 'warn')
    if (elapsed > SLOW_AFTER_S && x.rate > 0 && x.rate < SLOW_RATE) add(`SLOW LINK: ${size(x.rate)}/S`, 'warn')
  }
  if (x.state === 'done') {
    const heads = lines.filter(line => line.level === 'warn' || line.level === 'error').length
    const tail = heads > 0 ? ` · ${heads} HEADS-UP${heads === 1 ? '' : 'S'} ABOVE` : ''
    add(`JOB'S DONE! ${x.total > 0 ? size(x.total) : ''}${tail}`.replace('  ', ' ').trim())
  }
  if (x.state === 'error') {
    const meaning = EXIT_MEANING[x.code]
    add(`SPILT — EXIT ${x.code}${meaning ? `: ${meaning}` : ''}`, 'error')
  }

  if (isSame && lines.length === prev.lines.length) return prev
  return { id: x.id, lines: lines.slice(-KEEP) }
}

/** The `n` lines a screen shows, in order: routine progress scrolls off first, heads-ups stay put. */
export function visibleLines(lines: LogLine[], n: number): LogLine[] {
  const shown = [...lines]
  while (shown.length > n) {
    const routine = shown.findIndex(line => line.level !== 'warn' && line.level !== 'error')
    shown.splice(routine === -1 ? 0 : routine, 1)
  }
  return shown
}
