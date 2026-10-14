import type { RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Xfer } from '../types'
import { oozeSvg } from '../hooks/art'
import { advanceLog, visibleLines } from '../hooks/log'

const BASE: Xfer = {
  id: 't',
  label: 'Site uploads',
  direction: 'up',
  state: 'running',
  pct: 62.4,
  done: 0,
  total: 104857600,
  rate: 0,
  eta: 0,
  file: '',
  code: 0,
  updatedAt: 0,
  startedAt: 0,
}

test('the bench reads the percent, and the finish says job is done', async () => {
  const running = oozeSvg(BASE, 1000)
  expect(running).toContain('62%')
  expect(running).toContain('UPLOADING')

  const done = oozeSvg({ ...BASE, state: 'done', pct: 100 }, 1000)
  expect(done).toContain("JOB'S DONE")

  expect(oozeSvg({ ...BASE, state: 'error', code: 23 }, 1000)).toContain('SPILT')
  expect(oozeSvg(null, 1000)).toContain('STANDING BY')
})

test('the lab log writes each milestone once, in order', async () => {
  let log = advanceLog(null, { ...BASE, state: 'counting', pct: 0 }, 0)
  log = advanceLog(log, { ...BASE, pct: 30 }, 2000)
  const same = advanceLog(log, { ...BASE, pct: 40 }, 3000)
  expect(same).toBe(log)
  log = advanceLog(log, { ...BASE, pct: 92 }, 9000)
  log = advanceLog(log, { ...BASE, state: 'done', pct: 100 }, 11000)
  expect(log.lines.map(l => l.text)).toEqual([
    'COUNTING THE GOODS...',
    'PUMPING 100.0 MB ▲ UP',
    'QUARTER FULL',
    'HALFWAY — STEADY AS SHE GOES',
    'THREE-QUARTERS, OOZE RISING',
    'NEARLY THERE!',
    "JOB'S DONE! 100.0 MB",
  ])
  expect(log.lines[log.lines.length - 1]?.t).toBe('0:11')
  expect(visibleLines(log.lines, 6)[0]?.text).toBe('PUMPING 100.0 MB ▲ UP')
})

test('the lab log flags what you should know', async () => {
  const notes = [{ level: 'warn' as const, text: '--DELETE IN ARGS: FILES ON THE OTHER END CAN BE REMOVED' }]
  let log = advanceLog(null, { ...BASE, pct: 5, notes, updatedAt: 1000 }, 1000)
  log = advanceLog(log, { ...BASE, pct: 5, notes, updatedAt: 1000 }, 40000)
  log = advanceLog(log, { ...BASE, state: 'error', code: 23, notes }, 41000)
  const said = log.lines.map(l => `${l.level}:${l.text}`)
  expect(said).toContain('warn:--DELETE IN ARGS: FILES ON THE OTHER END CAN BE REMOVED')
  expect(said).toContain('warn:STALLED? NO DATA FOR 39S')
  expect(said).toContain('error:SPILT — EXIT 23: SOME FILES DID NOT MAKE IT')
  expect(visibleLines(log.lines, 2).map(l => l.level)).toEqual(['warn', 'error'])

  const done = advanceLog(log, { ...BASE, id: 'u', state: 'done', pct: 100, notes }, 50000)
  expect(done.lines.map(l => l.text)).toContain("JOB'S DONE! 100.0 MB · 1 HEADS-UP ABOVE")
})

test('the pane stands by before any transfer, on every surface', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/nowhere' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ooze-o-meter',
      surface,
      component: 'Pane',
      requestId: 'ooze-o-meter',
      props: { title: 'Ooze-o-Meter', isFocused: false, bodyColumns: 60, placement: 'dock' } as RenderPropsOf['Pane'],
    })
    const found = surface === 'desktop'
      ? await ui.find({ type: 'Svg' })
      : await ui.find({ type: 'Text', text: /standing by/ })
    expect(found).toBeDefined()
    await ui.unmount()
  }
})
