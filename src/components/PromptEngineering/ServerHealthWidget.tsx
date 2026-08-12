import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAgentProStore } from '../../lib/agentProStore'

/**
 * Top-right Agent Pro server health chip. OPTIONAL operational helper — the
 * app never depends on it; the actual agent communication is key/id-only.
 *
 * It talks to the guard's control API (server-guard.mjs), derived from the
 * configured Agent Pro URL (same host, guard port) so it makes no co-location
 * assumption. If the guard isn't running it just shows "Guard offline".
 */
const GUARD_PORT = '3099'

type Status = 'up' | 'down' | 'guard-offline' | 'checking'

const META: Record<Status, { dot: string; ring: string; label: string; color: string }> = {
  up:              { dot: 'bg-emerald-500', ring: 'shadow-[0_0_6px_1px_rgba(52,211,153,0.5)]', label: 'Server up',     color: 'text-emerald-600' },
  down:            { dot: 'bg-red-500',     ring: 'shadow-[0_0_6px_1px_rgba(239,68,68,0.5)]',  label: 'Server down',   color: 'text-red-600' },
  'guard-offline': { dot: 'bg-slate-300',   ring: '',                                          label: 'Guard offline', color: 'text-slate-400' },
  checking:        { dot: 'bg-slate-300',   ring: '',                                          label: 'Checking…',     color: 'text-slate-400' },
}

export default function ServerHealthWidget() {
  const masterAgentUrl = useAgentProStore((s) => s.masterAgentUrl)
  const [status, setStatus] = useState<Status>('checking')
  const [restarting, setRestarting] = useState(false)

  // Derive the guard control URL from the configured Agent Pro URL (same host,
  // guard port) — no hardcoded co-location.
  const guardUrl = useMemo(() => {
    try {
      const u = new URL(masterAgentUrl)
      return `${u.protocol}//${u.hostname}:${GUARD_PORT}`
    } catch {
      return `http://localhost:${GUARD_PORT}`
    }
  }, [masterAgentUrl])

  async function check() {
    try {
      const res = await fetch(`${guardUrl}/guard/health`, { cache: 'no-store' })
      if (!res.ok) { setStatus('guard-offline'); return }
      const data = await res.json()
      setStatus(data.serverUp ? 'up' : 'down')
    } catch {
      setStatus('guard-offline')
    }
  }

  useEffect(() => {
    check()
    const iv = setInterval(check, 8000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardUrl])

  async function handleRestart() {
    setRestarting(true)
    try {
      await fetch(`${guardUrl}/guard/restart`, { method: 'POST' })
    } catch {
      // guard offline — nothing we can do from the browser
    }
    // Poll until the dev server is back (or give up after ~40s).
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const res = await fetch(`${guardUrl}/guard/health`, { cache: 'no-store' })
        const data = await res.json()
        if (data.serverUp) { setStatus('up'); break }
      } catch {
        /* keep waiting */
      }
    }
    setRestarting(false)
    check()
  }

  const meta = META[status]
  const guardOffline = status === 'guard-offline'

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
      <span className={clsx('w-2 h-2 rounded-full shrink-0', meta.dot, meta.ring)} />
      <span className={clsx('text-[11px] font-medium whitespace-nowrap', meta.color)}>{meta.label}</span>
      <button
        onClick={handleRestart}
        disabled={restarting || guardOffline}
        title={guardOffline
          ? 'Guard offline — run `npm run guard` in Agent_pro/agent-pro (or start-guard.bat)'
          : 'Restart the Agent Pro server'}
        className={clsx(
          'flex items-center justify-center w-6 h-6 rounded-md border transition-colors',
          restarting || guardOffline
            ? 'border-slate-200 text-slate-300 cursor-not-allowed'
            : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-violet-600',
        )}
      >
        {restarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}
