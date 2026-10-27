import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Sandbox: the plugin is a browser script that talks to window/document, so the
// test supplies both plus a minimal React and slot runtime.
// ---------------------------------------------------------------------------

let factory = null
const storage = new Map()

const fakeWindow = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)) },
    removeItem: (k) => { storage.delete(k) },
  },
  setInterval: (fn) => { fakeWindow.__tick = fn; return 1 },
  clearInterval: () => { fakeWindow.__tick = null },
  setTimeout: () => 1,
  location: { reload: () => { throw new Error('unexpected reload') } },
  addEventListener: () => {},
  removeEventListener: () => {},
  __ModuleLoader__: { load: (mod) => { factory = mod.factory } },
}

const fakeDocument = {
  querySelector: () => null,
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
}

// Minimal React: enough for element construction and one-shot hooks.
function createReact() {
  let hookIndex = 0
  let hookStore = []
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useEffect(fn) { hookIndex += 1 },
    useRef(init) {
      const i = hookIndex++
      if (!(i in hookStore)) hookStore[i] = { current: init }
      return hookStore[i]
    },
    useState(init) {
      const i = hookIndex++
      if (!(i in hookStore)) hookStore[i] = typeof init === 'function' ? init() : init
      const set = (v) => { hookStore[i] = typeof v === 'function' ? v(hookStore[i]) : v }
      return [hookStore[i], set]
    },
    __reset() { hookIndex = 0; hookStore = [] },
  }
  return react
}

const react = createReact()
const clientPath = fileURLToPath(new URL('./client.js', import.meta.url))
const code = readFileSync(clientPath, 'utf8')
const run = new Function('window', 'document', 'globalThis', 'console', code)
run(fakeWindow, fakeDocument, { ...globalThis, window: fakeWindow }, console)

if (!factory) throw new Error('factory not registered')
const mod = factory((name) => {
  if (name === 'react') return react
  throw new Error('unexpected require: ' + name)
})

// ---------------------------------------------------------------------------
// Fake slot runtime: capture registrations so the controller and components can
// be driven directly.
// ---------------------------------------------------------------------------
const registrations = []
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => () => {}, bind: () => (key) => key },
  layout: { selectPanel: () => {} },
  slots: {
    inject: (_slot, cb) => { cb(); return () => {} },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}
mod.apply(ctx)

const overlayReg = registrations.find((r) => r.options.name === 'shell.overlay')
const settingsReg = registrations.find((r) => r.options.name === 'settings.general.item')
if (!overlayReg) throw new Error('shell.overlay not registered')

const zen = overlayReg.options.inject().zen

// ---------------------------------------------------------------------------
// Time control: the controller reads Date.now(), so the test owns the clock.
// ---------------------------------------------------------------------------
let now = 1_700_000_000_000
const realNow = Date.now
Date.now = () => now
const advance = (ms) => { now += ms; if (fakeWindow.__tick) fakeWindow.__tick() }

// ---------------------------------------------------------------------------
// Helpers: render the page and read the timer text.
// ---------------------------------------------------------------------------
function renderTimer() {
  react.__reset()
  const tree = overlayReg.component({ zen, t: (k) => k, useSessions: () => ({}) })
  if (tree === null) return null
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.props && node.props.role === 'timer') {
      found.push(node.children.join(''))
    }
    if (node.children) walk(node.children)
  }
  walk(tree)
  return found[0] ?? null
}

const results = []
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  results.push({ name, ok, actual, expected })
}

// --- 1. default direction is count-up --------------------------------------
storage.clear()
zen.enter()
check('default mode is count-up', zen.getSnapshot().mode, 'up')
check('count-up starts at 00:00', renderTimer(), '00:00')

// --- 2. count-up accumulates and never auto-exits --------------------------
advance(65_000)
check('count-up after 65s shows 01:05', renderTimer(), '01:05')
check('count-up stays active', zen.getSnapshot().active, true)

advance(3_600_000)
check('count-up past an hour widens to h:mm:ss', renderTimer(), '1:01:05')
check('count-up still active after over an hour', zen.getSnapshot().active, true)

// --- 3. legacy count-down still works and exits at zero --------------------
zen.exit()
storage.set('dsh-zen-mode:mode', 'down')
storage.set('dsh-zen-mode:duration-minutes', '1')
zen.enter()
check('count-down mode respected', zen.getSnapshot().mode, 'down')
check('count-down starts at the configured length', renderTimer(), '01:00')
advance(30_000)
check('count-down after 30s shows 00:30', renderTimer(), '00:30')
advance(30_500)
check('count-down exits at zero', zen.getSnapshot().active, false)
check('count-down page unmounted', renderTimer(), null)

// --- 4. completions only accumulate inside a round -------------------------
zen.enter()
zen.addCompletion('alpha')
advance(1_000)
zen.addCompletion('beta')
const snapshot = zen.getSnapshot()
check('completions recorded in order', snapshot.completions, ['alpha', 'beta'])
zen.exit()
zen.addCompletion('ignored')
check('completion after exit ignored', zen.getSnapshot().completions, ['alpha', 'beta'])

// --- 5. a new round clears the list ---------------------------------------
zen.enter()
check('new round clears completions', zen.getSnapshot().completions, [])

// --- 6. settings row shows the mode toggle, and the length only for down ----
function renderSettings() {
  react.__reset()
  return settingsReg.component({ t: (k) => k })
}

function texts(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out }
  if (node.children) node.children.forEach((n) => texts(n, out))
  return out
}

storage.clear()
storage.set('dsh-zen-mode:mode', 'up')
const upTree = renderSettings()
check('up mode renders both direction buttons', texts(upTree).includes('modeUp'), true)
check('up mode hides the length input', texts(upTree).includes('settingsTitle'), false)
check('up mode shows the up hint', texts(upTree).includes('modeHintUp'), true)

storage.set('dsh-zen-mode:mode', 'down')
const downTree = renderSettings()
check('down mode shows the length input', texts(downTree).includes('settingsTitle'), true)
check('down mode shows the down hint', texts(downTree).includes('modeHintDown'), true)

// --- 7. pressing the toggle persists the direction ------------------------
storage.clear()
storage.set('dsh-zen-mode:mode', 'up')
const toggleTree = renderSettings()
function findButton(node, label) {
  if (node === null || node === undefined) return null
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findButton(n, label); if (hit) return hit }
    return null
  }
  if (node.type === 'button' && texts(node).includes(label)) return node
  return findButton(node.children, label)
}
const downButton = findButton(toggleTree, 'modeDown')
check('toggle button found', downButton !== null, true)
downButton.props.onClick()
check('toggle persists down', storage.get('dsh-zen-mode:mode'), 'down')

Date.now = realNow

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok)
for (const r of results) {
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : `  actual=${JSON.stringify(r.actual)} expected=${JSON.stringify(r.expected)}`))
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length === 0 ? 0 : 1