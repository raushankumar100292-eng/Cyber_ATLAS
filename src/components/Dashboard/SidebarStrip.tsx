import { useMemo } from 'react'
import { ChevronRight, Shield } from 'lucide-react'
import { useStore } from '../../lib/store'
import { tactics } from '../../lib/atlas'
import { tacticCoverage, overallCoverage } from '../../lib/coverage'

export default function SidebarStrip() {
  const coverage        = useStore(s => s.coverage)
  const coverageMap     = useStore(s => s.coverageMap)
  const useCaseTacticMap = useStore(s => s.useCaseTacticMap)
  const clientName      = useStore(s => s.clientName)
  const industryLabel   = useStore(s => s.industryLabel)

  const stats = useMemo(() => {
    if (!coverage) return null
    if (useCaseTacticMap.size > 0) {
      const full    = coverage.entries.filter(e => e.level === 'full').length
      const partial = coverage.entries.filter(e => e.level === 'partial').length
      return { full, partial, total: coverage.entries.length }
    }
    const oc = overallCoverage(coverageMap)
    return { full: oc.full, partial: oc.partial, total: oc.total }
  }, [coverage, coverageMap, useCaseTacticMap])

  const tacticDots = useMemo(() => {
    return tactics.map(tac => {
      let pct = 0
      if (useCaseTacticMap.size > 0) {
        const maxCount = Math.max(1, ...Array.from(useCaseTacticMap.values()))
        const count = useCaseTacticMap.get(tac.name.toLowerCase().trim()) ?? 0
        pct = Math.round((count / maxCount) * 100)
      } else {
        const c = tacticCoverage(tac.id, coverageMap)
        pct = c.total > 0 ? Math.round(((c.full + c.partial * 0.5) / c.total) * 100) : 0
      }
      const color =
        pct >= 70 ? '#22c55e' :
        pct >= 40 ? '#f59e0b' :
        pct > 0   ? '#f43f5e' :
                    'rgba(255,255,255,0.10)'
      return { id: tac.id, pct, color }
    })
  }, [coverageMap, useCaseTacticMap])

  const overallPct = stats
    ? Math.round(((stats.full + stats.partial) / Math.max(stats.total, 1)) * 100)
    : 0

  const pctColor =
    overallPct >= 70 ? '#22c55e' :
    overallPct >= 40 ? '#f59e0b' :
    overallPct > 0   ? '#f43f5e' :
                       '#64748b'

  return (
    <div
      style={{
        width: 52,
        height: '100%',
        background: 'rgba(3,6,15,0.94)',
        borderRight: '1px solid rgba(0,229,255,0.07)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 14,
        paddingBottom: 14,
        gap: 0,
        cursor: 'pointer',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Expand button */}
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'rgba(0,229,255,0.07)',
        border: '1px solid rgba(0,229,255,0.14)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginBottom: 14,
      }}>
        <ChevronRight size={15} style={{ color: '#00e5ff' }} />
      </div>

      {/* Coverage % — rotated */}
      {stats && (
        <div style={{
          writingMode: 'vertical-rl' as const,
          transform: 'rotate(180deg)',
          fontFamily: 'Orbitron, sans-serif',
          fontSize: 11, fontWeight: 800,
          color: pctColor,
          letterSpacing: '0.06em',
          marginBottom: 10,
          flexShrink: 0,
          lineHeight: 1,
        }}>
          {overallPct}%
        </div>
      )}

      {/* "CVG" label rotated */}
      {stats && (
        <div style={{
          writingMode: 'vertical-rl' as const,
          transform: 'rotate(180deg)',
          fontFamily: 'Inter, sans-serif',
          fontSize: 8, fontWeight: 700,
          color: 'rgba(100,116,139,0.80)',
          letterSpacing: '0.14em',
          textTransform: 'uppercase' as const,
          marginBottom: 14, flexShrink: 0,
        }}>
          COVERAGE
        </div>
      )}

      {/* Client name rotated */}
      {clientName && (
        <>
          <div style={{
            width: 28, height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.20), transparent)',
            marginBottom: 10, flexShrink: 0,
          }} />
          <div style={{
            writingMode: 'vertical-rl' as const,
            transform: 'rotate(180deg)',
            fontFamily: 'Inter, sans-serif',
            fontSize: 9, fontWeight: 600,
            color: 'rgba(148,163,184,0.65)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            marginBottom: 4, flexShrink: 0,
            maxHeight: 110,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {clientName}
          </div>
          {industryLabel && (
            <div style={{
              writingMode: 'vertical-rl' as const,
              transform: 'rotate(180deg)',
              fontFamily: 'Inter, sans-serif',
              fontSize: 7.5, fontWeight: 500,
              color: 'rgba(71,85,105,0.70)',
              letterSpacing: '0.06em',
              marginBottom: 12, flexShrink: 0,
              maxHeight: 80,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {industryLabel}
            </div>
          )}
        </>
      )}

      {/* Divider */}
      <div style={{
        width: 28, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.14), transparent)',
        marginBottom: 10, flexShrink: 0,
      }} />

      {/* Tactic dots — 14 colored indicators */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        gap: 5, alignItems: 'center',
        flex: 1, overflow: 'hidden', justifyContent: 'center',
      }}>
        {tacticDots.map(({ id, pct, color }) => (
          <div
            key={id}
            title={`${pct}%`}
            style={{
              width: 7, height: 7,
              borderRadius: '50%',
              background: color,
              boxShadow: pct > 0 ? `0 0 5px ${color}88` : 'none',
              flexShrink: 0,
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>

      {/* MITRE shield at bottom */}
      <div style={{ marginTop: 12, flexShrink: 0 }}>
        <Shield size={13} style={{ color: 'rgba(0,229,255,0.22)' }} />
      </div>
    </div>
  )
}
