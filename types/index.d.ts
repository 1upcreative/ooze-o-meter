export type XferState = 'counting' | 'running' | 'done' | 'error' | 'raw'

/** How loud a lab-log line is: plain progress, a heads-up, or a buggum. */
export type NoteLevel = 'info' | 'warn' | 'error'

/** Something the wrapper wants said: pre-flight checks, rsync's own complaints. */
export type Note = { level: NoteLevel; text: string }

export type Xfer = {
  id: string
  label: string
  direction: 'up' | 'down' | 'local'
  state: XferState
  pct: number
  done: number
  total: number
  rate: number
  eta: number
  file: string
  code: number
  updatedAt: number
  startedAt?: number
  notes?: Note[]
}

/** One line of the lab log: what happened, when it was seen (ms), and the elapsed stamp. */
export type LogLine = { text: string; at: number; t: string; level?: NoteLevel }

/** The lab log of one transfer, newest last. */
export type Log = { id: string; lines: LogLine[] }

declare module 'claude-code' {
  interface PluginState {
    'ooze-o-meter': { xfer: Xfer | null; dinged: string | null; log: Log | null }
  }
}
