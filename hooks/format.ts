// Shared number formatting for the drawing, the log and the toasts.

export function size(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function clockText(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export function elapsedSeconds(startedAt: number | undefined, at: number): number {
  return startedAt === undefined ? 0 : Math.max(0, Math.round((at - startedAt) / 1000))
}
