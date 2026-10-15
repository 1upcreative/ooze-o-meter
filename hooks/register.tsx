import type { EngineInterface, Register } from 'claude-code'

import type { Deploy, Xfer } from '../types'
import { DEFAULT_TEXT, oozeSvg } from './art'
import type { FaceName, Faces, MascotText } from './art'
import { size } from './format'
import { advanceLog } from './log'

const PANE = 'ooze-o-meter'
const TITLE = 'Ooze-o-Meter'
const XFER = { plugin: 'ooze-o-meter', key: 'xfer' } as const
const DINGED = { plugin: 'ooze-o-meter', key: 'dinged' } as const
const LOG = { plugin: 'ooze-o-meter', key: 'log' } as const
const DEPLOY = { plugin: 'ooze-o-meter', key: 'deploy' } as const
const DEPLOY_DINGED = { plugin: 'ooze-o-meter', key: 'deployDinged' } as const

const FACE_NAMES: FaceName[] = ['base', 'blink', 'excited', 'done', 'warm']

/**
 * A raw rsync/scp to or from a host, typed straight into Bash: some segment of the command
 * line (split on && || ; | and newlines) must START with rsync or scp and name a host:path.
 * The word "rsync" inside a commit message or a description is not a transfer.
 */
function isRawTransfer(command: string): boolean {
  return command.split(/&&|\|\||[;|\n]/).some(segment =>
    /^\s*(?:sudo\s+|time\s+|[A-Z_]+=\S+\s+)*(rsync|scp)\s/.test(segment) && /\s[\w.@-]+:\S*/.test(segment),
  )
}

/** A loaded mascot pack: its words, its face frames as data: URIs, its finish sound. */
type Mascot = { text: MascotText; faces: Faces; sound?: { base64: string; mime: string } }

/** What a pack's mascot.json may say; anything left out falls back to the defaults. */
type MascotFile = Partial<Omit<MascotText, 'moods'>> & {
  moods?: Partial<MascotText['moods']>
  faces?: Partial<Record<FaceName, string>>
  sound?: string
}

/**
 * The mascot pack, first found of: $OOZE_MASCOT, ~/.claude/ooze/mascot, the one bundled
 * here. A pack is a folder with mascot.json plus the faces and sound it names, so anyone
 * can bring their own specimen without touching the code.
 */
async function loadMascot($: EngineInterface): Promise<Mascot> {
  const home = (await $.env.get('HOME')) ?? ''
  const chosen = await $.env.get('OOZE_MASCOT')
  const dirs = [chosen, `${home}/.claude/ooze/mascot`, `${$.plugin.root}/mascot`].filter((d): d is string => !!d)
  for (const dir of dirs) {
    let file: MascotFile
    try {
      file = JSON.parse(await $.fs.read(`${dir}/mascot.json`)) as MascotFile
    } catch {
      continue
    }
    const faces: Faces = {}
    for (const name of FACE_NAMES) {
      const rel = file.faces?.[name]
      if (rel === undefined) continue
      try {
        const { base64 } = await $.fs.read(`${dir}/${rel}`, { as: 'bytes' })
        faces[name] = `data:image/${rel.endsWith('.png') ? 'png' : 'jpeg'};base64,${base64}`
      } catch {
        // a missing frame falls back to the ring
      }
    }
    let sound: Mascot['sound']
    if (file.sound !== undefined) {
      try {
        const { base64 } = await $.fs.read(`${dir}/${file.sound}`, { as: 'bytes' })
        sound = { base64, mime: file.sound.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }
      } catch {
        // no sound, no ding
      }
    }
    const text: MascotText = {
      name: file.name ?? DEFAULT_TEXT.name,
      lab: file.lab ?? DEFAULT_TEXT.lab,
      moods: { ...DEFAULT_TEXT.moods, ...file.moods },
      standby: file.standby ?? DEFAULT_TEXT.standby,
    }
    return { text, faces, sound }
  }
  return { text: DEFAULT_TEXT, faces: {} }
}

export { isRawTransfer }

export const register: Register = on => {
  // Module-level poll bookkeeping only; anything a drawing reads lives in $.state.
  let lastSeen = 0
  let lastPushed = 0
  let openedFor = ''
  let deploySeen = 0
  let deployOpenedFor = ''
  // The mascot pack, read once per load (a reload just reads it again).
  let mascot: Mascot | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ooze', description: 'Open the Ooze-o-Meter transfer pane' })
    await $.command.register({ name: 'ooze-demo', description: 'Fill the Ooze-o-Meter with a fake 8-second transfer' })

    const home = (await $.env.get('HOME')) ?? ''
    const feed = `${home}/.claude/ooze/transfer.json`
    const deployFeed = `${home}/.claude/ooze/deploy.json`

    // The deploy light: amber while ooze-deploy runs, then green or red, with one toast at the end.
    $.clock.every(1000, async () => {
      let d: Deploy
      try {
        d = JSON.parse(await $.fs.read(deployFeed)) as Deploy
      } catch {
        return
      }
      if (d.updatedAt === deploySeen) return
      deploySeen = d.updatedAt
      await $.state.set(DEPLOY, d)
      const now = await $.clock.now()
      const isFresh = now - d.updatedAt < 20000
      if (d.state === 'running' && isFresh && deployOpenedFor !== d.id) {
        deployOpenedFor = d.id
        await $.ui.open({ id: PANE, title: TITLE })
      }
      if (d.state !== 'running' && isFresh) {
        const { value: dinged } = await $.state.get(DEPLOY_DINGED)
        if (dinged === d.id) return
        await $.state.set(DEPLOY_DINGED, d.id)
        $.ui.toast(d.state === 'done' ? `Deployed! ${d.label}${d.note ? ` · ${d.note}` : ''}` : `Deploy failed: ${d.label}${d.note ? ` (${d.note})` : ''}`)
      }
    })

    $.clock.every(400, async () => {
      let x: Xfer
      try {
        x = JSON.parse(await $.fs.read(feed)) as Xfer
      } catch {
        return
      }
      const now = await $.clock.now()
      if (x.updatedAt === lastSeen) {
        // A running feed that stopped moving: let the log say it looks stalled (within 10 minutes).
        const quiet = now - x.updatedAt
        if (x.state === 'running' && quiet > 30000 && quiet < 600000) {
          const { value: log = null } = await $.state.get(LOG)
          const updated = advanceLog(log, x, now)
          if (updated !== log) await $.state.set(LOG, updated)
        }
        return
      }
      lastSeen = x.updatedAt
      const isLive = x.state === 'counting' || x.state === 'running'
      const isFresh = now - x.updatedAt < 20000

      // Push to the drawing on a new whole percent, a state change, or once a second.
      const { value: current } = await $.state.get(XFER)
      const isNewStep =
        current?.id !== x.id || current.state !== x.state || Math.floor(current.pct) !== Math.floor(x.pct)
      if (isNewStep || now - lastPushed > 1000) {
        lastPushed = now
        await $.state.set(XFER, x)
      }
      if (isFresh) {
        const { value: log = null } = await $.state.get(LOG)
        const updated = advanceLog(log, x, now)
        if (updated !== log) await $.state.set(LOG, updated)
      }

      if (isLive && openedFor !== x.id && now - x.updatedAt < 15000) {
        openedFor = x.id
        await $.ui.open({ id: PANE, title: TITLE })
      }

      if ((x.state === 'done' || x.state === 'error') && isFresh) {
        const { value: dinged } = await $.state.get(DINGED)
        if (dinged === x.id) return
        await $.state.set(DINGED, x.id)
        if (x.state === 'done') {
          $.ui.toast(`Job's done! ${x.label} — ${size(x.total)}`)
          mascot ??= await loadMascot($)
          if (mascot.sound) await $.audio.play(mascot.sound).catch(() => undefined)
        } else {
          $.ui.toast(`Spilt the ooze: ${x.label} failed (rsync exit ${x.code})`)
        }
      }
    })

    return next(e)
  })

  on('command.run', { command: 'ooze' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Ooze-o-Meter open.' }
  })

  on('command.run', { command: 'ooze-demo' }, async $ => {
    const home = (await $.env.get('HOME')) ?? ''
    const feed = `${home}/.claude/ooze/transfer.json`
    const startedAt = await $.clock.now()
    const id = `demo-${startedAt}`
    const total = 734003200
    let step = 0
    const tick = $.clock.every(250, async () => {
      step++
      const pct = Math.min(100, step * 3.2)
      const isDone = pct >= 100
      const x: Xfer = {
        id,
        label: 'Demo haul',
        direction: 'down',
        state: isDone ? 'done' : 'running',
        pct,
        done: Math.round((total * pct) / 100),
        total,
        rate: 92000000,
        eta: Math.max(0, Math.round((100 - pct) / 12.8)),
        file: 'wp-content/uploads/2025/10/hero-ooze.jpg',
        code: 0,
        updatedAt: await $.clock.now(),
        startedAt,
      }
      await $.fs.write(feed, JSON.stringify(x))
      if (isDone) tick.cancel()
    })
    return { text: 'Demo ooze flowing.' }
  })

  // Raw rsync/scp straight to a host: no % to read, so the ooze sloshes until it ends.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const isRaw = isRawTransfer(e.command) && !/ooze-xfer/.test(e.command) && !e.run_in_background
    if (!isRaw) return next(e)

    const start = await $.clock.now()
    const base: Xfer = {
      id: `raw-${e.tool_use_id}`,
      label: (e.description ?? e.command).slice(0, 60),
      direction: 'local',
      state: 'raw',
      pct: 0,
      done: 0,
      total: 0,
      rate: 0,
      eta: 0,
      file: '',
      code: 0,
      updatedAt: start,
      startedAt: start,
    }
    await $.state.set(XFER, base)
    await $.state.set(LOG, advanceLog(null, base, start))
    await $.ui.open({ id: PANE, title: TITLE })

    const ran = await next(e)
    const isOk = ran.deny === undefined && ran.isError !== true
    const end = await $.clock.now()
    const finished: Xfer = { ...base, state: isOk ? 'done' : 'error', pct: isOk ? 100 : 0, code: isOk ? 0 : 1, updatedAt: end }
    await $.state.set(XFER, finished)
    const { value: log = null } = await $.state.get(LOG)
    await $.state.set(LOG, advanceLog(log, finished, end))
    if (isOk) {
      $.ui.toast(`Job's done! ${base.label}`)
      mascot ??= await loadMascot($)
      if (mascot.sound) void $.audio.play(mascot.sound).catch(() => undefined)
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { value: x = null } = await $.state.get(XFER)
    const { value: deploy = null } = await $.state.get(DEPLOY)
    const now = await $.clock.now()

    if (e.surface === 'desktop' || e.surface === 'vscode' || e.surface === 'mobile') {
      const { Svg } = $.ui.resolve(e)
      const { value: log = null } = await $.state.get(LOG)
      mascot ??= await loadMascot($)
      // The bench carries every readout; alt says it for screen readers.
      const alt = x === null
        ? `${mascot.text.name}, standing by`
        : x.state === 'done'
          ? `Job's done: ${x.label}, ${size(x.total)}`
          : x.state === 'error'
            ? `${x.label} failed, rsync exit ${x.code}`
            : `${x.label}: ${Math.floor(x.pct)} percent, ${size(x.done)} of ${size(x.total)}`
      // Drawn as an image, not an interactive frame: the frame blocks the painted face
      // frames, while an SVG image keeps its data: images and still runs SMIL.
      const deployAlt = deploy === null ? '' : deploy.state === 'running' ? `. Deploying ${deploy.label}` : deploy.state === 'done' ? `. Last deploy ${deploy.label} succeeded` : `. Last deploy ${deploy.label} failed`
      return <Svg source={oozeSvg(x, now, mascot.faces, log, mascot.text, deploy)} alt={alt + deployAlt} />
    }

    const { Box, Text } = $.ui.resolve(e)
    const lamp = deploy === null ? null : (
      <Text color={deploy.state === 'running' ? '#ffc24a' : deploy.state === 'done' ? '#39ff14' : '#ff5a4f'}>
        ● {deploy.state === 'running' ? `Deploying ${deploy.label}${deploy.step ? ` · ${deploy.step}` : ''}` : deploy.state === 'done' ? `Deployed ${deploy.label}${deploy.note ? ` · ${deploy.note}` : ''}` : `Deploy failed: ${deploy.label}`}
      </Text>
    )
    if (!x) return <Box flexDirection="column"><Text dimColor>Ooze-o-Meter standing by.</Text>{lamp}</Box>
    const cols = Math.max(10, Math.min(48, (e.props.bodyColumns ?? 40) - 8))
    const filled = x.state === 'done' ? cols : Math.round((cols * x.pct) / 100)
    return (
      <Box flexDirection="column">
        <Text color="#39ff14" bold>{x.state === 'done' ? "Job's done! " : ''}{x.label}</Text>
        <Text>
          <Text color="#39ff14">{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(cols - filled)}</Text> {Math.floor(x.pct)}%
        </Text>
        <Text dimColor>{size(x.done)} / {size(x.total)}</Text>
        {lamp}
      </Box>
    )
  })
}
