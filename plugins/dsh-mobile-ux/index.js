/**
 * Server half of the mobile UX overlay.
 *
 * The fixes themselves are client-side (a stylesheet and a view-memory script),
 * so this half only reports whether the overlay is loaded. Keeping it empty-but-
 * present means the profile can list the plugin like any other and `dsh` will
 * not complain about a package without a node half.
 */
export const name = 'dsh-mobile-ux'

export const inject = []

export function apply(ctx) {
  ctx.effect(
    () => () => {},
    'dsh-mobile-ux: client overlay only',
  )
}
