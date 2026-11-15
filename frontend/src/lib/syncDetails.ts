/**
 * Open and close every <details> in a row together.
 *
 * Used as a callback ref on Act four's detail row, so expanding either
 * "Evidence behind the options" or "Data sources" expands both. `toggle`
 * does not bubble, hence the capture listener.
 */
export function syncDetails(row: HTMLElement | null): void {
  if (!row) return
  row.addEventListener(
    'toggle',
    (e) => {
      const source = e.target as HTMLDetailsElement
      row.querySelectorAll('details').forEach((d) => {
        if (d !== source && d.open !== source.open) d.open = source.open
      })
    },
    true,
  )
}
