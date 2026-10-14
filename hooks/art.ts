// The Ooze-o-Meter as one SVG string: a lab bench laid out as a bento grid of screwed-on
// panels over graph paper, the props drawn in the same comic-ink style as the mascot's
// painted portrait (thick black outlines, flat cel shading, hard highlights).
//
//   header ··························· big %
//   [ SPECIMEN: mascot ]─electrode─[ CONTAINMENT: canister ]
//                                      ║ pipe
//   [ LAB LOG: CRT typing the experiment log            ]
//   [ FLOW RATE ]  [ PAYLOAD ]  [ TIME ]
//
// SMIL does all the motion. Loops start at a negative offset taken from the clock, so a
// redraw on a new percent picks them up mid-stride. One-shot effects (a log line typing
// in, its static burst, the drips) are drawn at their finished look, and the animation is
// only added while it is still playing: Chromium never applies the frozen end of a
// one-shot that finished before the drawing loaded, so a finished look must not need it.

import type { Log, LogLine, Xfer } from '../types'
import { clockText, elapsedSeconds, size } from './format'
import { visibleLines } from './log'

export type FaceName = 'base' | 'blink' | 'excited' | 'done' | 'warm'
/** Face frames as data: URIs (painted portraits, ~9KB each); a missing one falls back to a ring. */
export type Faces = Partial<Record<FaceName, string>>

/** The words a mascot pack brings: its name, the lab line, its moods and its standby log. */
export type MascotText = {
  name: string
  lab: string
  moods: Record<'standby' | 'observing' | 'nearly' | 'done' | 'error', string>
  standby: string[]
}

export const DEFAULT_TEXT: MascotText = {
  name: 'SPECIMEN',
  lab: 'OOZE LAB · EXPERIMENT 001',
  moods: { standby: 'ON STANDBY', observing: 'OBSERVING', nearly: 'NEARLY THERE!', done: 'VICTORIOUS', error: 'SHELL-SHOCKED' },
  standby: ['OOZE-O-METER READY', 'PIPE TRANSFERS THROUGH OOZE-XFER'],
}

const W = 420
const H = 562
const INK = '#111'
const OOZE = '#39ff14'
const PHOSPHOR = '#7dff5a'
const RED = '#ff5a4f'
const AMBER = '#ffc24a'
const MONO = "Menlo, 'Courier New', monospace"
const SANS = "'Helvetica Neue', Arial, sans-serif"
const IMPACT = "Impact, 'Arial Black', sans-serif"

const SPECIMEN = { x: 10, y: 74, w: 196, h: 226 }
const CONTAIN = { x: 214, y: 74, w: 196, h: 226 }
const LOG = { x: 10, y: 312, w: 400, h: 150 }
const TILES_Y = 470
const TILE_H = 82
const FACE = { cx: 108, cy: 186, r: 76 }
const TUBE = { x: 262, y: 128, w: 96, h: 136 }
const SCREEN = { x: 22, y: 338, w: 376, h: 112 }
const LOG_LINES = 6
const LOG_CHARS = 47

// Deterministic scatter so redraws keep the same bubbles.
function rand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** A loop's `begin`: the negative offset that keeps it in phase across redraws. */
function phase(now: number, dur: number, shift = 0): string {
  return `-${(((now / 1000 + shift) % dur) + dur) % dur}s`
}

/**
 * A one-shot animation that started `delay`s after `at` and runs `dur`s: `make(begin)`
 * while it is still playing (begin negative when it is mid-run), '' once it has played.
 * The element it animates is drawn at its finished look, which is all that remains after.
 */
function oneShot(now: number, at: number, delay: number, dur: number, make: (begin: string) => string): string {
  const start = (at - now) / 1000 + delay
  return start + dur <= 0 ? '' : make(`${start.toFixed(2)}s`)
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fit(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`
}

const isLive = (x: Xfer | null) => x !== null && (x.state === 'running' || x.state === 'counting' || x.state === 'raw')

// ── Panels ─────────────────────────────────────────────────────────────────────

function screw(cx: number, cy: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="3" fill="#3b4a3b" stroke="#0a0d0a" stroke-width="1"/><path d="M${cx - 2} ${cy + 2} l4 -4" stroke="#0a0d0a" stroke-width="1.2"/>`
}

/** A screwed-on lab panel with a small caps title (and an optional right-hand tag). */
function panel(p: { x: number; y: number; w: number; h: number }, title: string, tag = ''): string {
  const { x, y, w, h } = p
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#10161280" stroke="#2a3b2a" stroke-width="1.5"/>
  <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="26" rx="13" fill="#ffffff" opacity="0.025"/>
  ${screw(x + 9, y + 9)}${screw(x + w - 9, y + 9)}${screw(x + 9, y + h - 9)}${screw(x + w - 9, y + h - 9)}
  <text x="${x + 20}" y="${y + 20}" font-family="${MONO}" font-size="9.5" font-weight="bold" letter-spacing="1.6" fill="${PHOSPHOR}" opacity="0.9">${esc(title)}</text>
  ${tag}`
}

// ── Header ─────────────────────────────────────────────────────────────────────

function header(x: Xfer | null, who: MascotText): string {
  const hero = x === null ? '—'
    : x.state === 'done' ? '100%'
    : x.state === 'error' ? 'ERR'
    : x.state === 'raw' ? '≈'
    : x.state === 'counting' ? '··'
    : `${Math.floor(x.pct)}%`
  const verb = x === null ? 'IDLE · STANDING BY'
    : x.state === 'done' ? "✓ JOB'S DONE"
    : x.state === 'error' ? '✕ SPILT'
    : x.direction === 'up' ? '▲ UPLOADING' : x.direction === 'down' ? '▼ DOWNLOADING' : '◆ MOVING'
  const status = x === null ? verb : `${verb} · ${x.label.toUpperCase()}`
  const color = x?.state === 'error' ? RED : x?.state === 'done' ? OOZE : '#f2fff0'
  return `
  <text x="14" y="38" font-family="${IMPACT}" font-size="28" fill="#eaffe2" letter-spacing="0.5">OOZE-O-METER</text>
  <text x="14" y="56" font-family="${MONO}" font-size="8.5" fill="#8fb88a" letter-spacing="1">${esc(who.lab)}</text>
  <text x="406" y="44" text-anchor="end" font-family="${SANS}" font-weight="200" font-size="40" fill="${color}">${hero}</text>
  <text x="406" y="60" text-anchor="end" font-family="${MONO}" font-size="8.5" fill="${x?.state === 'error' ? RED : PHOSPHOR}" letter-spacing="0.8">${esc(fit(status, 34))}</text>`
}

// ── Specimen: the mascot ───────────────────────────────────────────────────────

function frame(href: string | undefined, extra = '', attrs = ''): string {
  if (href === undefined) return ''
  const { cx, cy, r } = FACE
  return `<image ${attrs} href="${href}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#face)" preserveAspectRatio="xMidYMid slice">${extra}</image>`
}

// Watches while it fills, blinks now and then, perks up past 90%, thumbs-up at the
// finish, winces on a spill, warm resting face on standby. The whole head bobs.
function specimen(x: Xfer | null, now: number, faces: Faces, who: MascotText): string {
  const { cx, cy, r } = FACE
  const failed = x?.state === 'error'
  const done = x?.state === 'done'
  const nearly = x?.state === 'running' && x.pct >= 90
  const main = x === null ? faces.warm : done ? faces.done : failed ? faces.blink : nearly ? faces.excited : faces.base
  const blink = `<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.93;0.97" calcMode="discrete" dur="4.3s" begin="${phase(now, 4.3)}" repeatCount="indefinite"/>`
  const blinker = x === null || done || failed ? '' : frame(faces.blink, blink, 'opacity="0"')
  const bob = done
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="0.55s" repeatCount="5"/>`
    : `<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="3.2s" begin="${phase(now, 3.2)}" repeatCount="indefinite"/>`
  const ring = failed ? RED : OOZE
  const fallback = main === undefined
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1d2a1a"/><text x="${cx}" y="${cy + 10}" text-anchor="middle" font-family="${IMPACT}" font-size="30" fill="${OOZE}">?</text>`
    : ''
  const m = who.moods
  const mood = x === null ? m.standby : done ? m.done : failed ? m.error : nearly ? m.nearly : m.observing
  return `
  ${panel(SPECIMEN, 'SPECIMEN')}
  <g>${bob}
    <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="${ring}" opacity="0.3" filter="url(#glow)"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="${INK}"/>
    ${fallback}${frame(main)}${blinker}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ring}" stroke-width="3">
      <animate attributeName="stroke-opacity" values="0.55;1;0.55" dur="1.8s" begin="${phase(now, 1.8)}" repeatCount="indefinite"/>
    </circle>
  </g>
  <text x="${cx}" y="${SPECIMEN.y + SPECIMEN.h - 12}" text-anchor="middle" font-family="${MONO}" font-size="8.5" letter-spacing="1.2" fill="${failed ? RED : '#b9d8b4'}">${esc(fit(`${who.name} · ${mood}`, 30))}</text>`
}

// ── Containment: the canister ──────────────────────────────────────────────────

function rivets(x0: number, x1: number, y: number, n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / (n - 1)
    return `<circle cx="${x.toFixed(1)}" cy="${y}" r="2.4" fill="#d3dadf" stroke="${INK}" stroke-width="1.4"/>`
  }).join('')
}

// A steel band: flat base, cel shadow on the lower half, a hard highlight on top.
function cap(x: number, y: number, w: number, h: number, extra = ''): string {
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#8d98a0"/>
  <rect x="${x}" y="${y + h * 0.55}" width="${w}" height="${h * 0.45}" rx="4" fill="#626d75"/>
  ${extra}
  <rect x="${x + 6}" y="${y + 3}" width="${w - 12}" height="3" rx="1.5" fill="#e3e9ec"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="${INK}" stroke-width="4"/>`
}

function containment(x: Xfer | null, now: number, doneAt: number): string {
  const { x: tx, y: ty, w, h } = TUBE
  const inner = { x: tx + 6, y: ty + 4, w: w - 12, h: h - 8 }
  const state = x?.state
  const raw = state === 'raw'
  const done = state === 'done'
  const level = x === null ? 0.08 : done ? 1 : raw ? 0.5 : Math.max(0.04, Math.min(1, x.pct / 100))
  const top = inner.y + inner.h * (1 - level)
  const r = rand(42)
  const bubbles = Array.from({ length: x === null ? 4 : 12 }, (_, i) => {
    const cx = inner.x + 10 + r() * (inner.w - 20)
    const rad = 2 + r() * 4
    const dur = 1.6 + r() * 2.4
    const from = inner.y + inner.h + rad
    return `<circle cx="${cx.toFixed(1)}" r="${rad.toFixed(1)}" fill="#e2ffd0" stroke="#0b4a00" stroke-width="1" opacity="0">
      <animate attributeName="cy" values="${from.toFixed(1)};${(top + 6).toFixed(1)}" dur="${dur.toFixed(2)}s" begin="${phase(now, dur, i * 0.37)}" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.15;0.85;1" dur="${dur.toFixed(2)}s" begin="${phase(now, dur, i * 0.37)}" repeatCount="indefinite"/>
    </circle>`
  }).join('')
  const wave = (amp: number, len: number) => {
    let d = `M${inner.x - len * 2} ${top}`
    for (let k = 0; k < 8; k++) d += ` q${len / 4} ${-amp} ${len / 2} 0 t${len / 2} 0`
    return `${d} V${inner.y + inner.h + 20} H${inner.x - len * 2} Z`
  }
  const slosh = raw
    ? `<animateTransform attributeName="transform" type="translate" values="0 ${inner.h * 0.35};0 ${inner.h * 0.1};0 ${inner.h * 0.35}" dur="3s" begin="${phase(now, 3)}" repeatCount="indefinite"/>`
    : ''
  // Beaker graduations inside the glass, the scale printed beside it.
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const y = inner.y + (inner.h * (i + 1)) / 10
    return `<path d="M${inner.x + 4} ${y.toFixed(1)} h${i === 4 ? 14 : 8}" stroke="#e2ffd0" stroke-width="2" opacity="0.55"/>`
  }).join('')
  const scale = [[100, inner.y], [50, inner.y + inner.h / 2], [0, inner.y + inner.h]]
    .map(([n, y]) => `<text x="${tx + w + 12}" y="${(y as number) + 3}" font-family="${MONO}" font-size="8" fill="#8fb88a">${n}</text><path d="M${tx + w + 3} ${y} h6" stroke="#8fb88a" stroke-width="1.5"/>`)
    .join('')
  // The red valve wheel up top spins while ooze is being pumped.
  const wheel = { cx: tx + w - 20, cy: ty - 26 }
  const spin = isLive(x)
    ? `<animateTransform attributeName="transform" type="rotate" values="0 ${wheel.cx} ${wheel.cy};360 ${wheel.cx} ${wheel.cy}" dur="1.8s" begin="${phase(now, 1.8)}" repeatCount="indefinite"/>`
    : ''
  // On "job's done" the ooze brims over the top cap and drips down the glass.
  const drips = done
    ? [tx - 1, tx + w + 1].map((dx, i) => {
        const fall = 60 + i * 30
        const dur = 1.6 + i * 0.5
        return `
      <path d="M${dx} ${ty - 2} q5 0 5 8 v6 q0 7 -5 7 q-5 0 -5 -7 v-6 q0 -8 5 -8Z" fill="${OOZE}" stroke="${INK}" stroke-width="2.5" transform="translate(0 ${fall})">
        ${oneShot(now, doneAt, 0.3 + i * 0.4, dur, begin => `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${fall}" dur="${dur}s" begin="${begin}"/>`)}
      </path>`
      }).join('')
      + `<path d="M${tx + 4} ${ty - 6} q12 -12 24 -2 q14 -14 26 0 q12 -12 24 -1 q8 -6 14 3 v6 h-88Z" fill="${OOZE}" stroke="${INK}" stroke-width="3"/>`
    : ''
  return `
  ${panel(CONTAIN, 'CONTAINMENT')}
  <rect x="${wheel.cx - 5}" y="${wheel.cy}" width="10" height="16" fill="#8d98a0" stroke="${INK}" stroke-width="3"/>
  <g>${spin}
    <circle cx="${wheel.cx}" cy="${wheel.cy}" r="10" fill="none" stroke="${INK}" stroke-width="7"/>
    <circle cx="${wheel.cx}" cy="${wheel.cy}" r="10" fill="none" stroke="#e0352b" stroke-width="4"/>
    <path d="M${wheel.cx - 10} ${wheel.cy} h20 M${wheel.cx} ${wheel.cy - 10} v20" stroke="${INK}" stroke-width="5"/>
    <path d="M${wheel.cx - 9} ${wheel.cy} h18 M${wheel.cx} ${wheel.cy - 9} v18" stroke="#e0352b" stroke-width="2.5"/>
    <circle cx="${wheel.cx}" cy="${wheel.cy}" r="3.5" fill="#e0352b" stroke="${INK}" stroke-width="2"/>
  </g>
  <rect x="${tx}" y="${ty}" width="${w}" height="${h}" fill="#0a1a0c"/>
  <g clip-path="url(#tube)" filter="url(#glow)">
    <g>${slosh}
      <path d="${wave(5, 52)}" fill="url(#ooze)">
        <animateTransform attributeName="transform" type="translate" values="0 0;52 0" dur="1.4s" begin="${phase(now, 1.4)}" repeatCount="indefinite"/>
      </path>
      <path d="${wave(4, 70)}" fill="#a8ff7a" opacity="0.35">
        <animateTransform attributeName="transform" type="translate" values="70 0;0 0" dur="2.1s" begin="${phase(now, 2.1)}" repeatCount="indefinite"/>
      </path>
      ${bubbles}
    </g>
  </g>
  <g clip-path="url(#tube)">
    <rect x="${tx + w * 0.62}" y="${ty}" width="${w * 0.38}" height="${h}" fill="#000" opacity="0.22"/>
    ${ticks}
    <path d="M${tx + 14} ${ty + 10} l10 0 l-8 ${h - 26} l-10 0Z" fill="#fff" opacity="0.28"/>
    <path d="M${tx + 30} ${ty + 10} l4 0 l-8 ${h - 26} l-4 0Z" fill="#fff" opacity="0.18"/>
  </g>
  <rect x="${tx}" y="${ty}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="4"/>
  ${scale}
  ${cap(tx - 8, ty - 14, w + 16, 18, rivets(tx - 1, tx + w + 1, ty - 7, 6))}
  ${cap(tx - 8, ty + h - 4, w + 16, 22, `<rect x="${tx - 4}" y="${ty + h + 3}" width="${w + 8}" height="8" fill="url(#hazard)" stroke="${INK}" stroke-width="1.5"/>`)}
  ${drips}`
}

// ── Plumbing: the electrode on the specimen, the pipe into the log ─────────────

function plumbing(x: Xfer | null, now: number): string {
  const live = isLive(x)
  const electrode = `M${FACE.cx + 62} ${FACE.cy - 44} C ${FACE.cx + 108} ${FACE.cy - 70}, ${TUBE.x - 40} ${TUBE.y + 70}, ${TUBE.x - 4} ${TUBE.y + 64}`
  const pulse = (d: string) => live
    ? `<path d="${d}" fill="none" stroke="#d7ffc8" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 14">
        <animate attributeName="stroke-dashoffset" values="0;-34" dur="0.7s" begin="${phase(now, 0.7)}" repeatCount="indefinite"/>
      </path>`
    : ''
  const pipe = { x: TUBE.x + TUBE.w / 2 - 9, y: TUBE.y + TUBE.h + 18, w: 18, h: LOG.y - (TUBE.y + TUBE.h + 18) + 14 }
  const flow = live
    ? `<rect x="${pipe.x + 6}" y="${pipe.y}" width="6" height="${pipe.h}" fill="url(#flow)">
        <animate attributeName="y" values="${pipe.y - 12};${pipe.y}" dur="0.5s" begin="${phase(now, 0.5)}" repeatCount="indefinite"/>
      </rect>`
    : ''
  return `
  <rect x="${pipe.x}" y="${pipe.y}" width="${pipe.w}" height="${pipe.h}" fill="#626d75" stroke="${INK}" stroke-width="3"/>
  <rect x="${pipe.x + 3}" y="${pipe.y}" width="3" height="${pipe.h}" fill="#c9d1d6"/>
  <g clip-path="url(#pipe)">${flow}</g>
  <rect x="${pipe.x - 4}" y="${LOG.y - 4}" width="${pipe.w + 8}" height="8" rx="2" fill="#8d98a0" stroke="${INK}" stroke-width="2.5"/>
  <path d="${electrode}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
  <path d="${electrode}" fill="none" stroke="#2fbf1a" stroke-width="5" stroke-linecap="round"/>
  ${pulse(electrode)}
  <circle cx="${FACE.cx + 62}" cy="${FACE.cy - 44}" r="6" fill="#c9d1d6" stroke="${INK}" stroke-width="2.5"/>
  <circle cx="${TUBE.x - 4}" cy="${TUBE.y + 64}" r="5" fill="#c9d1d6" stroke="${INK}" stroke-width="2.5"/>`
}

// ── Lab log: the CRT ───────────────────────────────────────────────────────────

function labLog(x: Xfer | null, log: Log | null, now: number, who: MascotText): string {
  const { x: sx, y: sy, w: sw, h: sh } = SCREEN
  const standby: LogLine[] = who.standby.map(text => ({ text, at: 0, t: '0:00' }))
  const lines = x === null ? standby : log?.id === x.id ? visibleLines(log.lines, LOG_LINES) : []
  const latest = lines.length > 0 ? Math.max(...lines.map(l => l.at)) : 0
  const failed = x?.state === 'error'
  const typed = lines.map((ln, i) => {
    const y = sy + 18 + i * 17
    const isDone = ln.text.startsWith("JOB'S DONE")
    const color = ln.level === 'error' ? RED : ln.level === 'warn' ? AMBER : isDone ? '#c8ffb0' : PHOSPHOR
    const mark = ln.level === 'error' ? '✕ ' : ln.level === 'warn' ? '⚠ ' : ''
    const flash = isDone
      ? oneShot(now, ln.at, 0.8, 0.9, begin => `<animate attributeName="opacity" values="1;0.2;1;0.2;1" dur="0.9s" begin="${begin}"/>`)
      : ''
    // The print head: a strip of screen that slides off to the right, uncovering the line.
    const head = oneShot(now, ln.at, 0.3, 0.55, begin => `
    <rect x="${sx + sw}" y="${y - 13}" width="${sw}" height="18" fill="#061306">
      <animate attributeName="x" values="${sx};${sx + sw}" dur="0.55s" begin="${begin}"/>
    </rect>`)
    return `
    <text x="${sx + 10}" y="${y}" font-family="${MONO}" font-size="11" font-weight="bold" fill="${color}" filter="url(#phosphor)"><tspan fill="#4f9a45">[${ln.t}]</tspan> ${esc(fit(mark + ln.text, LOG_CHARS))}${flash}</text>${head}`
  }).join('')
  const last = lines[lines.length - 1]
  const cursor = last !== undefined
    ? `<rect x="${sx + 10 + Math.min(`[${last.t}] ${last.level === 'warn' || last.level === 'error' ? '! ' : ''}${last.text}`.length, LOG_CHARS + 8) * 6.62 + 3}" y="${sy + 18 + (lines.length - 1) * 17 - 10}" width="7" height="12" fill="${PHOSPHOR}" opacity="0">
        <animate attributeName="opacity" values="1;0" dur="1s" calcMode="discrete" begin="${phase(now, 1)}" repeatCount="indefinite"/>
      </rect>`
    : ''
  const rec = isLive(x)
    ? `<circle cx="${LOG.x + LOG.w - 52}" cy="${LOG.y + 17}" r="4" fill="${RED}"><animate attributeName="opacity" values="1;0.2;1" dur="1.1s" begin="${phase(now, 1.1)}" repeatCount="indefinite"/></circle>
       <text x="${LOG.x + LOG.w - 44}" y="${LOG.y + 20}" font-family="${MONO}" font-size="9" font-weight="bold" fill="${RED}">REC</text>`
    : `<rect x="${LOG.x + LOG.w - 56}" y="${LOG.y + 13}" width="8" height="8" fill="${failed ? RED : '#8fb88a'}"/>
       <text x="${LOG.x + LOG.w - 44}" y="${LOG.y + 20}" font-family="${MONO}" font-size="9" font-weight="bold" fill="#8fb88a">${x === null ? 'IDLE' : 'STOP'}</text>`
  return `
  ${panel(LOG, 'LAB LOG', rec)}
  <rect x="${sx - 4}" y="${sy - 4}" width="${sw + 8}" height="${sh + 8}" rx="14" fill="#1d211d" stroke="${INK}" stroke-width="3"/>
  <g clip-path="url(#screen)">
    <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="#061306"/>
    <g>
      <animate attributeName="opacity" values="1;0.9;1;0.96;1;0.93;1" dur="2.6s" begin="${phase(now, 2.6)}" repeatCount="indefinite"/>
      ${typed}
      ${cursor}
    </g>
    <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#scan)"/>
    <rect x="${sx}" y="${sy - 20}" width="${sw}" height="20" fill="${PHOSPHOR}" opacity="0.06">
      <animate attributeName="y" values="${sy - 20};${sy + sh}" dur="3.6s" begin="${phase(now, 3.6)}" repeatCount="indefinite"/>
    </rect>
    <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" filter="url(#static)" opacity="0.06">
      ${latest > 0 ? oneShot(now, latest, 0, 0.6, begin => `<animate attributeName="opacity" values="0.8;0.4;0.06" keyTimes="0;0.4;1" dur="0.6s" begin="${begin}"/>`) : ''}
    </rect>
    <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#vignette)"/>
    <path d="M${sx + 8} ${sy + 8} q${sw * 0.35} -6 ${sw * 0.6} 3 l-4 7 q-${sw * 0.25} -8 -${sw * 0.56} -3Z" fill="#fff" opacity="0.06"/>
  </g>`
}

// ── Readout tiles ──────────────────────────────────────────────────────────────

function tile(i: number, title: string, value: string, unit: string, note: string): string {
  const w = (400 - 16) / 3
  const p = { x: 10 + i * (w + 8), y: TILES_Y, w, h: TILE_H }
  return `
  ${panel(p, title)}
  <text x="${p.x + 18}" y="${p.y + 56}" font-family="${SANS}" font-weight="300" font-size="25" fill="#f2fff0">${esc(value)}<tspan font-size="11" font-weight="500" fill="#8fb88a" dx="4">${esc(unit)}</tspan></text>
  <text x="${p.x + 18}" y="${p.y + 72}" font-family="${MONO}" font-size="8" fill="#8fb88a" letter-spacing="0.8">${esc(note)}</text>`
}

function split(n: number): [string, string] {
  const [v = '0', u = 'B'] = size(n).split(' ')
  return [v, u]
}

function tiles(x: Xfer | null): string {
  if (x === null) return tile(0, 'FLOW RATE', '—', '', 'NO FLOW') + tile(1, 'PAYLOAD', '—', '', 'EMPTY') + tile(2, 'TIME', '—', '', 'IDLE')
  const elapsed = elapsedSeconds(x.startedAt, x.updatedAt)
  const avg = elapsed > 0 ? x.total / elapsed : 0
  const [rate, rateUnit] = split(x.state === 'done' ? avg : x.rate)
  const [moved, movedUnit] = split(x.state === 'done' ? x.total : x.done)
  const flowNote = x.state === 'done' ? 'AVERAGE' : x.state === 'error' ? 'LAST SEEN' : x.state === 'raw' ? 'UNMETERED' : 'LIVE'
  return tile(0, 'FLOW RATE', x.state === 'raw' || x.state === 'counting' ? '—' : rate, x.state === 'raw' || x.state === 'counting' ? '' : `${rateUnit}/s`, flowNote)
    + tile(1, 'PAYLOAD', x.state === 'raw' ? '—' : moved, x.state === 'raw' ? '' : movedUnit, x.total > 0 ? `OF ${size(x.total)}` : 'COUNTING')
    + tile(2, 'TIME', clockText(elapsed), '', x.state === 'running' && x.eta > 0 ? `ETA ${clockText(x.eta)}` : x.state === 'done' ? 'TOTAL' : 'ELAPSED')
}

// ── Assembly ───────────────────────────────────────────────────────────────────

/**
 * The full bench. `x` null is standby (warm face, idle ooze, log standing by).
 * `log` is the transfer's lab log; its lines' times anchor their typing and static.
 * `who` is the mascot pack's words; the faces are its pictures.
 */
export function oozeSvg(x: Xfer | null, now: number, faces: Faces = {}, log: Log | null = null, who: MascotText = DEFAULT_TEXT): string {
  const doneAt = log?.lines.find(l => l.text.startsWith("JOB'S DONE"))?.at ?? now
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="${OOZE}" stroke-width="0.4" opacity="0.07"/></pattern>
    <pattern id="grid5" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="${OOZE}" stroke-width="0.7" opacity="0.1"/></pattern>
    <linearGradient id="ooze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b6ff3b"/><stop offset="0.25" stop-color="${OOZE}"/><stop offset="1" stop-color="#0f9d00"/>
    </linearGradient>
    <linearGradient id="flow" x1="0" y1="0" x2="0" spreadMethod="repeat" gradientUnits="userSpaceOnUse" y2="12">
      <stop offset="0" stop-color="${OOZE}"/><stop offset="0.5" stop-color="#0f9d00"/><stop offset="1" stop-color="${OOZE}"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/>
    </radialGradient>
    <pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.22"/></pattern>
    <pattern id="hazard" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="12" height="12" fill="#ffcc00"/><rect width="6" height="12" fill="${INK}"/>
    </pattern>
    <clipPath id="tube"><rect x="${TUBE.x}" y="${TUBE.y}" width="${TUBE.w}" height="${TUBE.h}"/></clipPath>
    <clipPath id="pipe"><rect x="${TUBE.x + TUBE.w / 2 - 6}" y="${TUBE.y + TUBE.h + 18}" width="12" height="${LOG.y - TUBE.y - TUBE.h}"/></clipPath>
    <clipPath id="face"><circle cx="${FACE.cx}" cy="${FACE.cy}" r="${FACE.r}"/></clipPath>
    <clipPath id="screen"><rect x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" rx="12"/></clipPath>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="phosphor" x="-5%" y="-40%" width="110%" height="180%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="static" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="1">
        <animate attributeName="seed" values="1;7;3;9;5;2" dur="0.3s" calcMode="discrete" repeatCount="indefinite"/>
      </feTurbulence>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="#0a0f0b"/>
  <rect width="${W}" height="${H}" rx="16" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" rx="16" fill="url(#grid5)"/>
  ${header(x, who)}
  ${specimen(x, now, faces, who)}
  ${containment(x, now, doneAt)}
  ${labLog(x, log, now, who)}
  ${plumbing(x, now)}
  ${tiles(x)}
</svg>`
}
