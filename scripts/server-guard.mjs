/**
 * server-guard.mjs — self-healing watchdog for the ATLAS Vite dev server.
 *
 *   • Supervises `npm run dev` (Vite :5173) as a child process.
 *   • Respawns automatically on exit/crash (2s backoff).
 *   • Wedge detection: health-pings :5173 every 10s; past a 45s startup grace,
 *     kills + respawns after 3 consecutive fails.
 *   • Port-aware: if :5173 is already served, monitors it instead of spawning.
 *   • Control API on :5099 (stays up even when the dev server is down):
 *         GET  /guard/health   -> { serverUp, supervising, restarts, ... }
 *         POST /guard/restart  -> bounce the dev server
 *
 * Run INSTEAD of `npm run dev`:  npm run guard  (or double-click start-guard.bat)
 */
import { spawn } from 'node:child_process'
import http from 'node:http'

const DEV_PORT     = Number(process.env.ATLAS_PORT  || 5173)
const CONTROL_PORT = Number(process.env.GUARD_PORT  || 5099)
const STARTUP_GRACE_MS = 45_000   // Vite cold-start is fast, but give headroom
const CHECK_EVERY_MS   = 10_000
const WEDGE_FAILS      = 3

let child        = null
let starting     = false
let restarts     = 0
let lastSpawnAt  = 0
let lastRestartAt = null
let failStreak   = 0

const ts  = () => new Date().toISOString()
const log = (m) => console.log(`[guard ${ts()}] ${m}`)

/** Ping the Vite dev server root — any 2xx/3xx means it's alive. */
function pingDev() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: DEV_PORT, path: '/', timeout: 3500 },
      (res) => { res.resume(); resolve(res.statusCode < 500) }
    )
    req.on('error',   () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function startDev() {
  if (child || starting) return
  starting = true
  // If something is already serving the port (a stray Vite instance),
  // monitor it instead of hot-looping on EADDRINUSE.
  if (await pingDev()) {
    log(`:${DEV_PORT} already served — monitoring, not spawning`)
    starting = false
    return
  }
  restarts++
  lastRestartAt = ts()
  lastSpawnAt   = Date.now()
  failStreak    = 0
  log(`starting ATLAS dev server on :${DEV_PORT} (start #${restarts})`)
  const proc = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true })
  child = proc
  proc.on('spawn', () => { starting = false; lastSpawnAt = Date.now() })
  proc.on('exit',  (code) => {
    log(`dev server exited (code ${code}) — respawning in 2s`)
    child    = null
    starting = false
    setTimeout(startDev, 2000)
  })
  proc.on('error', (e) => {
    log(`spawn error: ${e.message} — retrying in 3s`)
    child    = null
    starting = false
    setTimeout(startDev, 3000)
  })
}

function killChild() {
  const proc = child
  if (!proc?.pid) return
  if (process.platform === 'win32') {
    // child.kill() only kills the npm shell; Vite grandchild survives and holds
    // the port. Kill the whole process tree so the port is freed for respawn.
    try { spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' }) } catch {}
  } else {
    try { proc.kill('SIGTERM') } catch {}
  }
}

function bounce() {
  log('manual restart requested via control API')
  if (child) killChild()  // exit handler respawns
  else       startDev()
}

// ── Control API ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const control = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  const url = req.url || ''

  if (url.startsWith('/guard/health')) {
    const serverUp = await pingDev()
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({
      serverUp, supervising: !!child || starting,
      restarts, lastRestartAt, port: DEV_PORT,
    }))
  }

  if (url.startsWith('/guard/restart') && req.method === 'POST') {
    bounce()
    res.writeHead(202, { 'Content-Type': 'application/json', ...CORS })
    return res.end(JSON.stringify({ ok: true, restarting: true }))
  }

  res.writeHead(404, CORS)
  res.end(JSON.stringify({ error: 'not found' }))
})
control.on('error', (e) => log(`control API error: ${e.message} (supervision continues)`))
control.listen(CONTROL_PORT, () =>
  log(`control API ready on http://localhost:${CONTROL_PORT}  (GET /guard/health · POST /guard/restart)`)
)

// ── Backstop health loop ──────────────────────────────────────────────────────
setInterval(async () => {
  if (starting) return
  if (!child) { startDev(); return }
  if (Date.now() - lastSpawnAt < STARTUP_GRACE_MS) return
  const up = await pingDev()
  if (up) { failStreak = 0; return }
  failStreak++
  log(`health check failed (${failStreak}/${WEDGE_FAILS})`)
  if (failStreak >= WEDGE_FAILS) {
    log('server unresponsive — killing to force a fresh respawn')
    failStreak = 0
    killChild()
  }
}, CHECK_EVERY_MS)

log(`guard starting — dev :${DEV_PORT}, control :${CONTROL_PORT}`)
startDev()
process.on('SIGINT', () => {
  log('shutting down')
  if (child) { try { killChild() } catch {} }
  process.exit(0)
})
