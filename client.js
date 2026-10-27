/**
 * Zen mode, browser half.
 *
 * One full-screen page replaces the whole DSH surface for a configurable
 * countdown (25 minutes by default): the remaining time on the left, the names
 * of sessions that finished during the round on the right, and an exit button.
 * Nothing else is visible or reachable, and the page is a pure overlay: no
 * session is paused, and no log, setting, or model-visible input is written.
 *
 * Exit is the one promise this plugin must never break. Four independent ways
 * out exist: the exit button, Escape, the countdown reaching zero, and a page
 * reload (the active flag lives only in page memory).
 */
window.__ModuleLoader__.load({
  id: 'dsh-zen-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace of this plugin's copy. */
    const NS = 'zen'
    /** Countdown length used when the user has not chosen one. */
    const DEFAULT_MINUTES = 25
    /** Lowest configurable countdown length, in minutes. */
    const MIN_MINUTES = 1
    /** Highest configurable countdown length, in minutes. */
    const MAX_MINUTES = 120
    /** Browser storage key holding the chosen countdown length. */
    const STORAGE_KEY = 'dsh-zen-mode:duration-minutes'
    /** Browser storage key holding the chosen timer direction. */
    const MODE_STORAGE_KEY = 'dsh-zen-mode:mode'
    /** Counts up from zero and never ends on its own. */
    const MODE_UP = 'up'
    /** Counts down from the configured length and exits at zero. */
    const MODE_DOWN = 'down'
    /** Timer direction used when the user has not chosen one. */
    const DEFAULT_MODE = MODE_UP
    /** Timer recompute cadence; the display is derived from a timestamp, never accumulated. */
    const TICK_MS = 250
    /** Mascot route served by the Host half; absent there, the image hides itself. */
    const MASCOT_SRC = '/zen-mode/mascot.webp'
    /** Rendered mascot edge in CSS pixels (the file is 160 px, so this stays sharp). */
    const MASCOT_PX = 140

    const zh = {
      entry: '禅模式',
      exit: '退出',
      timerAria: '禅模式计时',
      completedTitle: '已完成会话',
      completedAria: '禅模式期间完成的会话',
      modeLabel: '计时方式',
      modeUp: '正计时',
      modeDown: '倒计时',
      modeHintUp: '从 0 开始累计，不会自动退出。',
      modeHintDown: '从设定时长开始倒数，到 0 自动退出。',
      settingsTitle: '倒计时时长',
      settingsHint: '仅在倒计时方式下生效，每次进入都重新开始。',
      settingsInvalid: '请输入 1 到 120 之间的整数。',
      settingsUnit: '分钟',
    }
    const en = {
      entry: 'Zen mode',
      exit: 'Exit',
      timerAria: 'Zen mode timer',
      completedTitle: 'Completed sessions',
      completedAria: 'Sessions finished during zen mode',
      modeLabel: 'Timer direction',
      modeUp: 'Count up',
      modeDown: 'Count down',
      modeHintUp: 'Counts up from zero and never ends on its own.',
      modeHintDown: 'Counts down from the set length and exits at zero.',
      settingsTitle: 'Countdown length',
      settingsHint: 'Applies to count-down only; every entry restarts it.',
      settingsInvalid: 'Enter a whole number from 1 to 120.',
      settingsUnit: 'minutes',
    }

    /**
     * Read the configured countdown length.
     * @returns whole minutes within the accepted range, or the default.
     */
    function readDurationMinutes() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        const value = Number.parseInt(raw === null ? '' : raw, 10)
        if (Number.isInteger(value) && value >= MIN_MINUTES && value <= MAX_MINUTES) return value
      } catch (error) {
        // Private-mode or disabled storage: the default still works.
      }
      return DEFAULT_MINUTES
    }

    /**
     * Persist the countdown length; storage failures keep the in-memory value.
     * @param minutes - whole minutes already validated by the caller.
     */
    function writeDurationMinutes(minutes) {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(minutes))
      } catch (error) {
        // Private-mode or disabled storage: the choice lasts for this page only.
      }
    }

    /**
     * Read the configured timer direction.
     * @returns the stored direction, or the default when absent or unrecognized.
     */
    function readMode() {
      try {
        const raw = window.localStorage.getItem(MODE_STORAGE_KEY)
        if (raw === MODE_UP || raw === MODE_DOWN) return raw
      } catch (error) {
        // Private-mode or disabled storage: the default still works.
      }
      return DEFAULT_MODE
    }

    /**
     * Persist the timer direction; storage failures keep the in-memory choice.
     * @param mode - the validated direction.
     */
    function writeMode(mode) {
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, mode)
      } catch (error) {
        // Private-mode or disabled storage: the choice lasts for this page only.
      }
    }

    /**
     * Format whole seconds as mm:ss, widening to h:mm:ss past an hour so a
     * count-up round can run as long as the user leaves it.
     * @param totalSeconds - seconds to show, already rounded by the caller.
     * @returns the display text, never below 00:00.
     */
    function formatClock(totalSeconds) {
      const safe = Math.max(0, totalSeconds)
      const hours = Math.floor(safe / 3600)
      const minutes = Math.floor((safe % 3600) / 60)
      const seconds = safe % 60
      const pad = (value) => (value < 10 ? '0' + value : String(value))
      if (hours > 0) return hours + ':' + pad(minutes) + ':' + pad(seconds)
      return pad(minutes) + ':' + pad(seconds)
    }

    /**
     * The seconds the page shows for one snapshot. Count-down rounds ceil so a
     * fresh 25-minute round reads 25:00 rather than 24:59; count-up rounds floor
     * so a fresh round reads 00:00.
     * @param snapshot - the current round.
     * @returns whole seconds.
     */
    function displaySeconds(snapshot) {
      return snapshot.mode === MODE_UP
        ? Math.floor(snapshot.shownMs / 1000)
        : Math.ceil(snapshot.shownMs / 1000)
    }

    /**
     * The single zen-mode state: whether it is active, which direction the timer
     * runs, the timestamp that direction derives from, and which sessions
     * finished meanwhile. Every mutation publishes one new snapshot so React
     * subscribers never read a half-updated round.
     * @returns the controller shared by the entry, the page, and the ticker.
     */
    function createZenController() {
      /** `startedAt` drives a count-up round; `endsAt` drives a count-down one. */
      let snapshot = { active: false, mode: DEFAULT_MODE, startedAt: 0, endsAt: 0, shownMs: 0, completions: [] }
      const listeners = new Set()
      let ticker = null
      /** Monotonic round counter, so a pending exit fallback cannot act on a newer round. */
      let round = 0

      const publish = (next) => {
        snapshot = next
        for (const listener of Array.from(listeners)) listener()
      }
      const close = () => {
        if (!snapshot.active) return
        publish({ active: false, mode: snapshot.mode, startedAt: 0, endsAt: 0, shownMs: 0, completions: snapshot.completions })
      }
      const step = (shownMs) => {
        publish({ active: true, mode: snapshot.mode, startedAt: snapshot.startedAt, endsAt: snapshot.endsAt, shownMs, completions: snapshot.completions })
      }

      return {
        /** Subscribe to round changes. */
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /** Current round snapshot; the identity changes only when the round changes. */
        getSnapshot() {
          return snapshot
        },
        /** Start the timer ticker (idempotent). */
        start() {
          if (ticker !== null) return
          ticker = window.setInterval(() => {
            if (!snapshot.active) return
            // Both directions derive from a timestamp, never from an accumulator:
            // a sleeping or throttled tab lands on the right value on its next
            // tick instead of drifting by the time it lost.
            if (snapshot.mode === MODE_UP) {
              const elapsed = Date.now() - snapshot.startedAt
              if (Math.floor(elapsed / 1000) !== Math.floor(snapshot.shownMs / 1000)) step(elapsed)
              return
            }
            const remaining = snapshot.endsAt - Date.now()
            if (remaining <= 0) {
              close()
              return
            }
            if (Math.ceil(remaining / 1000) !== Math.ceil(snapshot.shownMs / 1000)) step(remaining)
          }, TICK_MS)
        },
        /** Stop the timer ticker. */
        stop() {
          if (ticker === null) return
          window.clearInterval(ticker)
          ticker = null
        },
        /** Begin a fresh round from the stored direction, with an empty completion list. */
        enter() {
          round += 1
          const mode = readMode()
          if (mode === MODE_UP) {
            publish({ active: true, mode, startedAt: Date.now(), endsAt: 0, shownMs: 0, completions: [] })
            return
          }
          const durationMs = readDurationMinutes() * 60 * 1000
          publish({ active: true, mode, startedAt: 0, endsAt: Date.now() + durationMs, shownMs: durationMs, completions: [] })
        },
        /** Leave zen mode. */
        exit() {
          const closedRound = round
          close()
          // Last-resort escape. The active flag lives only in page memory, so a
          // reload always restores DSH. Only a page that is still covered after
          // an explicit exit triggers it: that means the overlay failed to
          // unmount, which is exactly the state this must never leave behind.
          window.setTimeout(() => {
            if (round !== closedRound) return
            if (document.querySelector('[data-zen-mode-page]') === null) return
            window.location.reload()
          }, 600)
        },
        /**
         * Record one finished session for this round.
         * @param title - the session name to show.
         */
        addCompletion(title) {
          if (!snapshot.active) return
          if (typeof title !== 'string' || title.length === 0) return
          publish({ active: true, mode: snapshot.mode, startedAt: snapshot.startedAt, endsAt: snapshot.endsAt, shownMs: snapshot.shownMs, completions: snapshot.completions.concat([title]) })
        },
      }
    }

    /**
     * The icon rendered by the sidebar's global panel row.
     * @param props - the row's owner props (`size`, `active`).
     * @returns the row glyph.
     */
    function ZenIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('circle', { cx: 12, cy: 12, r: 8.6, strokeDasharray: '3 3.2', strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 12, r: 2.6, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /**
     * The center panel the sidebar row selects. Its only job is to start a round
     * and hand the center column straight back to the conversation, so leaving
     * zen mode always lands on a working surface.
     * @param props - the injected controller and the panel reset callback.
     * @returns null; the visible page comes from the frame overlay.
     */
    function ZenEntry(props) {
      const zen = props.zen
      const leavePanel = props.leavePanel
      React.useEffect(() => {
        zen.enter()
        try {
          leavePanel()
        } catch (error) {
          // The panel reset is best effort: zen mode is already active and the
          // exit button restores the conversation as well. Retry once so a
          // transient layout rejection cannot strand an empty center column.
          window.setTimeout(() => {
            try {
              leavePanel()
            } catch (retryError) {
              console.error('[zen-mode] could not restore the conversation panel', retryError)
            }
          }, 0)
        }
      }, [zen, leavePanel])
      return null
    }

    /**
     * The zen-mode page itself: countdown, finished-session names, exit button.
     * @param props - the injected controller plus the standard Session hooks.
     * @returns the full-screen page, or null while zen mode is inactive.
     */
    function ZenOverlay(props) {
      const zen = props.zen
      const leavePanel = props.leavePanel
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const snapshot = React.useSyncExternalStore(zen.subscribe, zen.getSnapshot)
      const useSessions = props.useSessions
      const byId = typeof useSessions === 'function' ? useSessions((state) => state.byId) : undefined
      const previousRunning = React.useRef(new Map())

      // Leaving always ends on the conversation: the exit button, Escape, and the
      // countdown's automatic exit all pass through here, so a center panel left
      // behind by a rejected reset is repaired on the way out. The ref keeps the
      // restore to real exits: this entry mounts while zen mode is still
      // inactive, and switching panels then would move the user off their page.
      const wasActive = React.useRef(false)
      React.useEffect(() => {
        if (snapshot.active) {
          wasActive.current = true
          return
        }
        if (!wasActive.current) return
        wasActive.current = false
        try {
          leavePanel()
        } catch (error) {
          console.error('[zen-mode] could not restore the conversation panel', error)
        }
      }, [snapshot.active, leavePanel])

      // Completion detection: the running -> idle edge of a non-subagent
      // session. The first observation of a session only records its bit, so a
      // session that was already idle when the round started is never listed.
      React.useEffect(() => {
        if (byId === undefined) return
        const previous = previousRunning.current
        const seen = new Set()
        for (const id of Object.keys(byId)) {
          const summary = byId[id]
          if (summary === undefined) continue
          seen.add(id)
          const wasRunning = previous.get(id) === true
          const running = summary.running === true
          previous.set(id, running)
          if (!wasRunning || running) continue
          if (summary.origin === 'subagent') continue
          const title = typeof summary.displayTitle === 'string' && summary.displayTitle.length > 0
            ? summary.displayTitle
            : String(id)
          zen.addCompletion(title)
        }
        for (const id of Array.from(previous.keys())) {
          if (!seen.has(id)) previous.delete(id)
        }
      }, [byId, zen])

      // Escape is a safety net beside the button: the page must never be a trap.
      React.useEffect(() => {
        if (!snapshot.active) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          zen.exit()
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => { window.removeEventListener('keydown', onKeyDown, true) }
      }, [snapshot.active, zen])

      if (!snapshot.active) return null

      const completions = snapshot.completions
      const exitLabel = t('exit')
      return h(
        'div',
        {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('entry'),
          'data-zen-mode-page': '',
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            fontFamily: 'inherit',
            pointerEvents: 'auto',
          },
        },
        h(
          'div',
          { style: { flex: '1 1 55%', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 } },
          h(
            'div',
            {
              role: 'timer',
              'aria-label': t('timerAria'),
              'data-zen-mode-direction': snapshot.mode,
              style: {
                fontSize: 'clamp(48px, 11vw, 150px)',
                fontWeight: 200,
                lineHeight: 1,
                letterSpacing: '0.02em',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
                color: 'var(--dsw-alias-label-primary)',
                userSelect: 'none',
              },
            },
            formatClock(displaySeconds(snapshot)),
          ),
        ),
        h(
          'div',
          {
            style: {
              flex: '0 0 38%',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '56px 32px',
              // Keep the last rows clear of the mascot that floats over this
              // column's bottom-right corner.
              paddingBottom: 56 + MASCOT_PX,
              overflowY: 'auto',
              borderLeft: '1px solid var(--dsw-alias-border-l1)',
            },
          },
          completions.length === 0
            ? null
            : h(
              React.Fragment,
              null,
              // The heading exists only with at least one row: an empty right
              // column stays completely empty, so it never reads as a list that
              // failed to load.
              h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: '0.08em',
                    color: 'var(--dsw-alias-label-secondary)',
                    opacity: 0.72,
                    userSelect: 'none',
                  },
                },
                t('completedTitle'),
              ),
              h(
                'ul',
                {
                  'aria-label': t('completedAria'),
                  style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
                },
                completions.map((title, index) => h(
                  'li',
                  {
                    key: index + ':' + title,
                    title,
                    style: {
                      fontSize: 15,
                      lineHeight: 1.5,
                      color: 'var(--dsw-alias-label-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  title,
                )),
              ),
            ),
        ),
        h(
          'div',
          {
            style: {
              position: 'absolute',
              // Bottom-right keeps both controls clear of the desktop window's
              // native caption buttons, which own the top-right corner. The row
              // bottom-aligns so the mascot never pushes the exit button around.
              bottom: 16,
              right: 16,
              display: 'flex',
              alignItems: 'flex-end',
              gap: 16,
            },
          },
          h(
            'button',
            {
              type: 'button',
              onClick: () => { zen.exit() },
              'aria-label': exitLabel,
              title: exitLabel,
              style: {
                padding: '10px 22px',
                fontSize: 15,
                fontFamily: 'inherit',
                color: 'var(--dsw-alias-label-secondary)',
                background: 'transparent',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 10,
                cursor: 'pointer',
              },
            },
            exitLabel,
          ),
          // Decoration only: the animation must never intercept a click, and a
          // deployment whose Host serves no mascot route simply hides it.
          h('img', {
            src: MASCOT_SRC,
            alt: '',
            'aria-hidden': 'true',
            'data-zen-mode-mascot': '',
            draggable: false,
            onError: (event) => { event.currentTarget.style.display = 'none' },
            style: {
              width: MASCOT_PX,
              height: MASCOT_PX,
              display: 'block',
              pointerEvents: 'none',
              userSelect: 'none',
            },
          }),
        ),
      )
    }

    /**
     * The Settings row that owns the timer direction and, for count-down, the
     * length. Both preferences are stored per page so the next round picks them
     * up without touching a Host setting.
     * @param props - the synthesized translate seat.
     * @returns the preference rows.
     */
    function ZenSettingsRow(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [mode, setMode] = React.useState(readMode)
      const [draft, setDraft] = React.useState(() => String(readDurationMinutes()))
      const [invalid, setInvalid] = React.useState(false)

      const chooseMode = (next) => {
        writeMode(next)
        setMode(next)
      }
      const onChange = (event) => {
        const raw = event.target.value
        setDraft(raw)
        const parsed = Number.parseInt(raw, 10)
        const valid = String(parsed) === raw.trim() && parsed >= MIN_MINUTES && parsed <= MAX_MINUTES
        setInvalid(!valid)
        if (valid) writeDurationMinutes(parsed)
      }
      const modeButton = (value, label) => h(
        'button',
        {
          type: 'button',
          onClick: () => { chooseMode(value) },
          'aria-pressed': mode === value,
          style: {
            padding: '6px 14px',
            fontSize: 13,
            fontFamily: 'inherit',
            color: mode === value ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            background: mode === value ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
            border: '1px solid ' + (mode === value ? 'var(--dsw-alias-border-l2)' : 'var(--dsw-alias-border-l1)'),
            borderRadius: 8,
            cursor: 'pointer',
          },
        },
        label,
      )

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 0' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 } },
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } },
            h('span', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary)' } }, t('modeLabel')),
            h(
              'span',
              { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              mode === MODE_UP ? t('modeHintUp') : t('modeHintDown'),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flex: 'none' } },
            modeButton(MODE_UP, t('modeUp')),
            modeButton(MODE_DOWN, t('modeDown')),
          ),
        ),
        // The length only has a meaning while counting down.
        mode === MODE_DOWN
          ? h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 } },
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } },
              h('span', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary)' } }, t('settingsTitle')),
              h(
                'span',
                { style: { fontSize: 12, color: invalid ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' } },
                invalid ? t('settingsInvalid') : t('settingsHint'),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 'none' } },
              h('input', {
                type: 'number',
                min: MIN_MINUTES,
                max: MAX_MINUTES,
                value: draft,
                'aria-label': t('settingsTitle'),
                onChange,
                style: {
                  width: 72,
                  padding: '6px 8px',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  color: 'var(--dsw-alias-label-primary)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  borderRadius: 8,
                },
              }),
              h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('settingsUnit')),
            ),
          )
          : null,
      )
    }

    /**
     * Client plugin body: dictionaries, the countdown ticker, and four slot
     * contributions. Each contribution is isolated so one rejected slot can
     * never take the exit path down with it.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      const controller = createZenController()

      ctx.effect(() => {
        controller.start()
        return () => { controller.stop() }
      }, 'zen-mode: countdown ticker')

      ctx.effect(() => {
        const offZh = ctx.locale.register(NS, 'zh', zh)
        const offEn = ctx.locale.register(NS, 'en', en)
        return () => { offZh(); offEn() }
      }, 'zen-mode: dictionaries')

      const translate = ctx.locale.bind(NS)
      const leavePanel = () => { ctx.layout.selectPanel(null) }
      const contribute = (slot, register) => {
        try {
          ctx.slots.inject(slot, register)
        } catch (error) {
          console.error('[zen-mode] could not contribute to ' + slot, error)
        }
      }

      // The page itself: the frame-wide floating layer sits above every column.
      contribute('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'zen-mode',
        order: 1000,
        registrant: 'dsh-zen-mode',
        locale: NS,
        inject: () => ({ zen: controller, leavePanel }),
      }, ZenOverlay))

      // The sidebar row's destination: start a round, then hand the center
      // column back to the conversation.
      contribute('main', () => ctx.slots.register({
        name: 'main',
        key: 'zen-mode',
        registrant: 'dsh-zen-mode',
        inject: () => ({ zen: controller, leavePanel }),
      }, ZenEntry))

      // The entry row beside "Plugins" and "Automated tasks".
      contribute('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'zen-mode',
        order: 20,
        registrant: 'dsh-zen-mode',
        label: () => translate('entry'),
      }, ZenIcon))

      // Countdown length preference.
      contribute('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'zen-mode-duration',
        order: 50,
        registrant: 'dsh-zen-mode',
        locale: NS,
      }, ZenSettingsRow))
    }

    return { inject: ['slots', 'locale', 'layout'], apply }
  },
})
