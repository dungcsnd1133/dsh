window.__ModuleLoader__.load({
  id: '@local/dsh-mobile-ux',
  factory(require) {
    'use strict'

    /**
     * The shipped shell is a bundle we must not edit: `dsh` upgrades overwrite
     * it. Everything here is an overlay instead — one stylesheet plus a small
     * view-memory script — so a new DSH version keeps the work.
     *
     * What it fixes, all measured on a 390x844 viewport:
     *
     * 1. The Settings dialog's close button is 28x28 CSS px (`_close_o6lrb_87`)
     *    and the other one 36x36 (`_close_19zw2_37`). Both are under the 44px
     *    touch minimum, which is why the panel felt impossible to dismiss on a
     *    phone. Only their box grows — the icon stays where it was.
     * 2. Tab rows inside Settings overflow the viewport (a 320px screen cut the
     *    third tab in half), so they get to scroll instead of overflowing.
     * 3. Several controls sit at 20-36px tall on touch screens; every button in
     *    the shell gets a 44px minimum there, without changing desktop.
     * 4. Reloading dropped you back to the home view because the shell has no
     *    router: it never writes the URL (0 `pushState`, 0 `location.hash`).
     *    The script below remembers which panel was open and reopens it after
     *    a reload, so F5 no longer throws you out of Settings.
     */

    // Touch sizing. `pointer: coarse` targets phones and tablets; the width
    // guard catches narrow desktop windows, where the same crowding appears.
    const TOUCH_CSS = `
@media (pointer: coarse), (max-width: 640px) {
  /* 1. Close buttons: 44x44 hit area, icon unchanged.
     The class carries a per-build hash (VOzbGW_close today, though the shipped
     CSS says _close_o6lrb_87), so match on the aria-label -- the one thing the
     shell keeps stable -- and on any class that ends in _close. */
  button[aria-label="Close"],
  button[aria-label="Đóng"],
  [class$="_close"],
  [class*="_close_"] {
    min-width: 44px;
    min-height: 44px;
    width: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation;
  }

  /* 2. Tab rows scroll instead of clipping. */
  ._tabs_1p79o_1 { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  ._tabs_1p79o_1::-webkit-scrollbar { display: none; }
  ._tab_1p79o_1 { height: 40px; flex: 0 0 auto; white-space: nowrap; }

  /* 3. Every shell button is at least 44px tall on touch. */
  button, [role="button"], [role="tab"], select {
    min-height: 44px;
    touch-action: manipulation;
  }
  /* ...but not the tiny inline ones inside dense rows, which would break layout. */
  ._row_k7ery_26 button, ._row_1alm6_55 button { min-height: 36px; }

  /* 4. Settings dialog keeps its content reachable on short screens. */
  ._dialog_o6lrb_33 { max-height: calc(100dvh - 24px); overflow-y: auto; }

  /* 5. Inputs at >=16px stop iOS zooming the page on focus. */
  input, textarea, select { font-size: max(16px, 1em); }
}
`

    const VIEW_KEY = 'dsh.mobile.lastView'

    /**
     * Remember which Settings section was open and reopen it after a reload.
     *
     * The shell has no router: it never writes the URL (0 pushState, 0
     * location.hash, 0 popstate), so a reload always lands on the home view and
     * drops the panel you were reading. We cannot add routing, but we can note
     * the section the user picked and click it again on the next load.
     *
     * The shipped tabs are plain buttons with no aria-selected and a per-build
     * class hash, so the section is identified by its visible label -- the only
     * stable handle -- and recorded when the user clicks it.
     */
    function installViewMemory() {
      if (window.__dshMobileUxViewMemory) return
      window.__dshMobileUxViewMemory = true

      const VIEW_KEY = 'dsh.mobile.lastView'
      const remember = (label) => {
        try {
          window.localStorage.setItem(VIEW_KEY, JSON.stringify({ section: label, at: Date.now() }))
        } catch {
          // private mode or storage full: remembering is a nicety, not a duty
        }
      }

      // Record a click on a button that lives inside a dialog -- those are the
      // Settings sections. Clicks elsewhere are unrelated and ignored.
      document.addEventListener(
        'click',
        (event) => {
          const button = event.target instanceof Element ? event.target.closest('button, [role="button"]') : null
          if (!button || !button.closest('[role="dialog"]')) return
          const label = (button.getAttribute('aria-label') || button.textContent || '').trim()
          // Skip the dialog's own controls; only section names are worth saving.
          if (!label || /^(close|đóng|open configuration|✕|×)$/i.test(label)) return
          remember(label)
        },
        true,
      )

      /**
       * Reopen the saved section once, right after a reload.
       * @returns {boolean} whether a restore was started.
       */
      const restore = () => {
        let saved = null
        try {
          saved = JSON.parse(window.localStorage.getItem(VIEW_KEY) || 'null')
        } catch {
          return false
        }
        // Stale memory is worse than none: only a recent view is restored.
        if (!saved || !saved.section || Date.now() - Number(saved.at || 0) > 30 * 60 * 1000) return false
        if (document.querySelector('[role="dialog"]')) return false

        const byLabel = (text) =>
          [...document.querySelectorAll('button, [role="button"], a')].find((el) => {
            const label = (el.getAttribute('aria-label') || el.textContent || '').trim()
            return label.toLowerCase() === String(text).trim().toLowerCase()
          })

        const openMenu = () => {
          const menu = document.querySelector('button[aria-label="Account menu"]')
          if (menu) menu.click()
          return Boolean(menu)
        }

        // The restore is one shot: clear it now so a later refresh starts clean
        // and a failed attempt does not loop.
        try {
          window.localStorage.removeItem(VIEW_KEY)
        } catch {
          // ignore
        }

        window.setTimeout(() => {
          if (!openMenu()) return
          window.setTimeout(() => {
            const settings = byLabel('settings')
            if (!settings) return
            settings.click()
            window.setTimeout(() => {
              const section = byLabel(saved.section)
              if (section && section.closest('[role="dialog"]')) section.click()
            }, 800)
          }, 700)
        }, 1200)
        return true
      }

      const kick = () => {
        window.setTimeout(() => restore(), 500)
      }
      if (document.readyState === 'complete') kick()
      else window.addEventListener('load', kick, { once: true })
    }

    function apply() {
      if (document.getElementById('dsh-mobile-ux-style')) return
      const style = document.createElement('style')
      style.id = 'dsh-mobile-ux-style'
      style.textContent = TOUCH_CSS
      document.head.appendChild(style)
      installViewMemory()
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true })
    } else {
      apply()
    }

    return {
      inject: [],
      apply() {
        // The overlay is DOM-level: it runs once the bundle loads, independent
        // of any slot or route.
      },
    }
  },
})
