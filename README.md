# dsh-zen-mode

[![npm](https://img.shields.io/npm/v/dsh-zen-mode.svg)](https://www.npmjs.com/package/dsh-zen-mode)
[![license](https://img.shields.io/npm/l/dsh-zen-mode.svg)](./LICENSE)

禅模式 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a full-screen minimal page that hides the whole DSH Web GUI while your tasks keep running, so waiting on an agent stops costing you attention.

DSH 的任务在禅模式期间照常执行，不暂停、不打断。你只看到计时、期间完成的会话名，和一个退出按钮。

计时默认是**正计时**：从 00:00 开始累计，不会自动结束。想要番茄钟那种到点自动退出的，在设置里切成倒计时。

## Install

```sh
dsh plugin --profile <your-profile> add dsh-zen-mode
```

Restart the page (or the client) once so the browser loads the new UI module. The plugin is a bundle: it appends itself to `dsh.profile.bundles`, and no manual `cordis.patch.yml` edit is needed.

To remove it:

```sh
dsh plugin --profile <your-profile> remove dsh-zen-mode
```

## Use

Click **禅模式 / Zen mode** in the sidebar, under **插件** and **自动化任务**. The whole GUI is covered at once.

| Part | What it shows |
|---|---|
| Left | The timer. **Count-up is the default**: it starts at `00:00` and accumulates, widening to `h:mm:ss` past an hour. Switch to count-down in Settings and it starts at the configured length and exits at zero. |
| Right | **已完成会话 / Completed sessions**, then the names of sessions that finished during this round, in completion order. The heading and the whole column are absent while nothing has finished. |
| Bottom-right | The exit button, and beside it the mascot animation. |

Nothing else is visible or reachable: no session list, no composer, no settings, no toasts. You cannot open a session without leaving zen mode first.

### Mascot

The bottom-right corner shows a small looping animation. It is decoration only: it never takes a click, and a deployment whose Host serves no mascot route simply hides it. The shipped `mascot.webp` is an animated WebP, 160×160 at 15 fps over 5 seconds (about 283 KB); the original source was a 40 MB, 1280×1280, 30 fps GIF.

### Timer direction and length

Settings → General → **计时方式 / Timer direction** picks between **正计时 / Count up** (the default) and **倒计时 / Count down**. The choice applies to the next round.

Count-down additionally shows **倒计时时长 / Countdown length**: whole minutes from 1 to 120, 25 by default, restarted on every entry. The field is hidden while count-up is selected, because it has no meaning there.

### Exit

Four independent ways out, so the page cannot trap you:

1. The **退出 / Exit** button.
2. `Esc`.
3. The countdown reaching `00:00` — automatic exit. This exists only in count-down mode; a count-up round never ends on its own, so leaving is always explicit.
4. Reloading the page. The active flag lives only in page memory, so a reload always restores DSH.

A failed unmount also cannot trap you: shortly after an explicit exit, if the page is somehow still covered, the plugin reloads the document.

## What counts as a finished session

A session is listed when its running state goes from running to idle. Subagent sessions are excluded. The plugin does not distinguish a normal completion from an aborted, blocked, or failed turn — every stop is listed the same way, because the page only answers "which task can I stop waiting on".

Only completions inside the current round are listed. Sessions that were already finished when you entered are not replayed.

## Boundaries

- **Pure overlay.** Entering or leaving writes no session log entry, no setting, and no model-visible input. No session is paused, interrupted, or inspected beyond its public running state.
- **Global, not per-session.** One page covers the whole client. Multiple browser tabs each run their own round.
- **Leaving lands on the conversation.** The sidebar row is a panel entry, and the client exposes no public "current panel" read, so the exit restores the conversation rather than whichever panel you were on before.
- **Coverage is the Web viewport.** The desktop window's native title bar buttons and browser-level shortcuts (reload, close tab, DevTools) stay outside it.
- **No telemetry.** The plugin reports nothing anywhere.

## Compatibility

Tested against DSH `0.2.1-rc.2` and `0.2.1-rc.5` on Windows. The plugin declares no dependency on any `@deepseek-ai/dsh-*` package: the browser half resolves React from the host's module table and registers through the slot API only, so it is not pinned to one DSH release. It needs a DSH build whose Web client provides `sidebar.panellist`, `shell.overlay`, `main`, and `settings.general.item`.

### If the plugin list reports it as `missing`

That state means the installed copy is a `link:` to a directory that no longer exists — a local-development setup whose target was moved or deleted, not a version incompatibility. Reinstall from the registry, which carries its own copy and cannot dangle:

```sh
dsh plugin --profile <your-profile> remove dsh-zen-mode
dsh plugin --profile <your-profile> add dsh-zen-mode
```

## Files

| File | Role |
|---|---|
| `index.js` | Host half: serves `mascot.webp` at `/zen-mode/mascot.webp`, since a client bundle cannot reach a sibling file. |
| `client.js` | Browser half: the sidebar row, the center-panel trigger, the full-screen page, and the Settings row. |
| `mascot.webp` | The bottom-right animation. |
| `cordis.patch.yml` | Bundle patch inserting the `zen-mode` Host row. |
| `locale/*.json` | Plugin title and description shown in the plugin list. |
| `icon.svg` | Plugin artwork. |
| `test-logic.mjs` | Keyless logic test: drives the controller with a controlled clock and a stub slot runtime. Run `node test-logic.mjs`; it is not part of the published package. |

## License

MIT
