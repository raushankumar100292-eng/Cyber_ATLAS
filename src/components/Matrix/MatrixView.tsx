import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, Layers, Target, GitBranch, Shield, BookOpen, Info } from 'lucide-react'
import { atlas, tactics, topTechniquesForTactic, subtechniquesOf } from '../../lib/atlas'
import { colorForTactic } from '../../lib/theme'
import { useStore } from '../../lib/store'
import type { Technique, Tactic, CoverageEntry } from '../../lib/types'

const COVERAGE_COLOR: Record<string, string> = {
  full:    '#16a34a',
  partial: '#d97706',
  none:    '#dc2626',
}

// ── Stats header ──────────────────────────────────────────────────────────────

interface StatChipProps {
  icon: React.ElementType
  label: string
  value: number
  color: string
  subLabel?: string
  tooltip?: string
}

function StatChip({ icon: Icon, label, value, color, subLabel, tooltip }: StatChipProps) {
  const [showTip, setShowTip] = useState(false)
  return (
    <div
      className="relative flex items-center gap-2"
      style={{
        padding: '5px 12px',
        background: `${color}0e`,
        border: `1px solid ${color}22`,
        borderRadius: 7,
      }}
      onMouseEnter={() => tooltip && setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <Icon size={11} style={{ color, flexShrink: 0 }} />
      <div>
        <div className="flex items-baseline gap-1.5">
          <span style={{
            fontFamily: 'Orbitron, sans-serif', fontSize: 15, fontWeight: 700,
            color, letterSpacing: '0.02em', lineHeight: 1,
          }}>
            {value}
          </span>
          <span style={{
            fontFamily: 'Inter, sans-serif', fontSize: 9, color: '#64748b',
            letterSpacing: '0.03em',
          }}>
            {label}
          </span>
          {tooltip && <Info size={9} style={{ color: '#94a3b8', marginLeft: 1, cursor: 'help' }} />}
        </div>
        {subLabel && (
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 8.5, color: '#94a3b8', marginTop: 1 }}>
            {subLabel}
          </div>
        )}
      </div>
      {showTip && tooltip && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          marginTop: 6, zIndex: 100, whiteSpace: 'nowrap',
          background: '#1e293b', color: '#f1f5f9', fontSize: 10, padding: '5px 9px',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
        }}>
          {tooltip}
        </div>
      )}
    </div>
  )
}

function MatrixStatsHeader({ matrixTechCount, matrixSubCount }: { matrixTechCount: number; matrixSubCount: number }) {
  return (
    <div
      className="flex items-center gap-0 mb-4 shrink-0"
      style={{
        background: 'rgba(255,255,255,0.98)',
        border: '1px solid rgba(0,0,0,0.10)',
        borderRadius: 10,
        padding: '10px 16px',
        backdropFilter: 'blur(8px)',
        display: 'inline-flex',
        minWidth: 'max-content',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}
    >
      {/* Title */}
      <div className="flex items-center gap-2.5 pr-5" style={{ borderRight: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#0284c7', boxShadow: '0 0 6px rgba(2,132,199,0.5)',
        }} />
        <div>
          <div style={{
            fontFamily: 'Orbitron, sans-serif', fontSize: 10, fontWeight: 700,
            color: '#1e293b', letterSpacing: '0.1em', lineHeight: 1.2,
          }}>
            {atlas.meta.name}
          </div>
          <div style={{
            fontFamily: 'Inter, sans-serif', fontSize: 9, color: '#64748b',
            letterSpacing: '0.06em', marginTop: 1,
          }}>
            {atlas.stats.tactics} Tactics · generated {new Date(atlas.meta.generatedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Stat chips */}
      <div className="flex items-center gap-2" style={{ paddingLeft: 12 }}>
        <StatChip
          icon={Layers}
          label="Tactics"
          value={atlas.stats.tactics}
          color="#0284c7"
        />
        <StatChip
          icon={Target}
          label="Unique Techniques"
          value={atlas.stats.techniques}
          color="#6366f1"
          subLabel={`${matrixTechCount} across all tactics`}
          tooltip={`${atlas.stats.techniques} unique parent techniques. ${matrixTechCount} total cells in the matrix because ${matrixTechCount - atlas.stats.techniques} techniques appear in multiple tactics.`}
        />
        <StatChip
          icon={GitBranch}
          label="Sub-techniques"
          value={atlas.stats.subtechniques}
          color="#8b5cf6"
          subLabel={`${matrixSubCount} shown in matrix`}
          tooltip={`${atlas.stats.subtechniques} unique sub-techniques. ${matrixSubCount} appear in the matrix (some sub-techniques belong to multi-tactic parent techniques).`}
        />
        <StatChip
          icon={Shield}
          label="Mitigations"
          value={atlas.stats.mitigations}
          color="#16a34a"
        />
        <StatChip
          icon={BookOpen}
          label="Case Studies"
          value={atlas.stats.caseStudies}
          color="#d97706"
        />
      </div>
    </div>
  )
}

// ── Coverage dot ──────────────────────────────────────────────────────────────

function CoverageDot({ level }: { level: string }) {
  const c = COVERAGE_COLOR[level] ?? '#94a3b8'
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ background: c, boxShadow: `0 0 3px ${c}80` }}
    />
  )
}

// ── Technique cell ─────────────────────────────────────────────────────────────

function TechniqueCell({
  tech,
  tacticColor,
  isSelected,
  onSelect,
  coverageEntry,
}: {
  tech: Technique
  tacticColor: string
  isSelected: boolean
  onSelect: () => void
  coverageEntry?: CoverageEntry
}) {
  const [expanded, setExpanded] = useState(false)
  const selectTechnique = useStore(s => s.selectTechnique)
  const selectedTechniqueId = useStore(s => s.selectedTechniqueId)
  const coverageMap = useStore(s => s.coverageMap)
  const subs = tech.subtechniques.length > 0 ? subtechniquesOf(tech.id) : []

  const cvgColor = coverageEntry ? COVERAGE_COLOR[coverageEntry.level] : null

  return (
    <div>
      {/* Parent technique */}
      <button
        onClick={() => {
          onSelect()
          if (subs.length) setExpanded(e => !e)
        }}
        className="w-full rounded-md px-2.5 py-2 text-left transition-all duration-150 border-l-2 mb-0.5 group"
        style={{
          borderLeftColor: isSelected ? tacticColor : cvgColor ?? `${tacticColor}28`,
          background: isSelected
            ? `${tacticColor}15`
            : cvgColor
              ? `${cvgColor}0c`
              : 'rgba(0,0,0,0.015)',
          color: isSelected ? '#0f172a' : '#374151',
        }}
      >
        <div className="flex items-start gap-1.5">
          {coverageEntry && <CoverageDot level={coverageEntry.level} />}
          <span
            className="leading-snug font-medium flex-1 text-left"
            style={{ fontSize: 12, fontFamily: 'Inter, sans-serif', color: isSelected ? '#0f172a' : '#374151' }}
          >
            {tech.name}
          </span>
        </div>

        <div className="flex items-center justify-between mt-1">
          <span
            className="font-mono"
            style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.02em' }}
          >
            {tech.id}
          </span>
          {subs.length > 0 && (
            <span
              className="flex items-center gap-0.5"
              style={{ fontSize: 10, color: `${tacticColor}aa`, fontFamily: 'JetBrains Mono, monospace' }}
            >
              {expanded
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />
              }
              <span>{subs.length}</span>
            </span>
          )}
        </div>

        {coverageEntry?.tool && (
          <div
            className="mt-0.5 truncate"
            style={{ fontSize: 10, color: '#94a3b8' }}
          >
            {coverageEntry.tool}
          </div>
        )}
      </button>

      {/* Sub-techniques */}
      {expanded && subs.map(sub => {
        const subCvg = coverageMap.get(sub.id)
        const subCvgColor = subCvg ? COVERAGE_COLOR[subCvg.level] : null
        const subSelected = selectedTechniqueId === sub.id
        return (
          <button
            key={sub.id}
            onClick={() => selectTechnique(subSelected ? null : sub.id)}
            className="w-full text-left ml-3 rounded-md px-2 py-1.5 mb-0.5 border-l-2 transition-all group"
            style={{
              borderLeftColor: subCvgColor ?? `${tacticColor}33`,
              background: subSelected
                ? `${tacticColor}12`
                : subCvgColor
                  ? `${subCvgColor}08`
                  : 'rgba(0,0,0,0.01)',
            }}
          >
            <div className="flex items-center gap-1.5">
              {subCvg && <CoverageDot level={subCvg.level} />}
              <span
                style={{
                  fontSize: 11, fontFamily: 'Inter, sans-serif',
                  color: subSelected ? '#0f172a' : '#4b5563',
                  lineHeight: 1.35,
                }}
              >
                {sub.name}
              </span>
            </div>
            <div
              className="font-mono mt-0.5"
              style={{ fontSize: 9, color: '#94a3b8', letterSpacing: '0.02em' }}
            >
              {sub.id}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Tactic column ──────────────────────────────────────────────────────────────

function TacticColumn({
  tactic,
  selectedTacticId,
  selectedTechniqueId,
}: {
  tactic: Tactic
  selectedTacticId: string | null
  selectedTechniqueId: string | null
}) {
  const color = colorForTactic(tactic.id)
  const isSelected = selectedTacticId === tactic.id
  const selectTactic = useStore(s => s.selectTactic)
  const selectTechnique = useStore(s => s.selectTechnique)
  const coverageMap = useStore(s => s.coverageMap)
  const techs = topTechniquesForTactic(tactic.id)

  const subTechCount = techs.reduce((sum, t) => sum + t.subtechniques.length, 0)

  const covered = techs.filter(t => {
    const e = coverageMap.get(t.id)
    return e && e.level !== 'none'
  }).length
  const hasCoverage = coverageMap.size > 0
  const coveragePct = techs.length > 0 ? Math.round((covered / techs.length) * 100) : 0
  const coverageBarColor =
    coveragePct >= 70 ? '#16a34a' : coveragePct >= 35 ? '#d97706' : '#dc2626'

  return (
    <div className="w-52 flex flex-col gap-0.5 flex-shrink-0">

      {/* Tactic header */}
      <button
        onClick={() => selectTactic(isSelected ? null : tactic.id)}
        className="rounded-lg p-3 text-left transition-all duration-150 mb-1.5 sticky top-0 z-10"
        style={{
          background: isSelected
            ? `linear-gradient(${color}22, ${color}22), #ffffff`
            : `linear-gradient(${color}10, ${color}10), #ffffff`,
          border: `1.5px solid ${isSelected ? color + '55' : color + '22'}`,
          boxShadow: isSelected ? `0 0 20px ${color}18, 0 2px 8px rgba(0,0,0,0.06)` : '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        {/* Tactic name */}
        <div
          style={{
            fontFamily: 'Orbitron, sans-serif',
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            lineHeight: 1.3,
            color: isSelected ? color : `${color}dd`,
          }}
        >
          {tactic.name}
        </div>

        {/* Tactic ID */}
        <div
          className="font-mono mt-1"
          style={{ fontSize: 9, color: `${color}77`, letterSpacing: '0.06em' }}
        >
          {tactic.id}
        </div>

        {/* Technique + sub-technique count badges */}
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className="font-mono font-semibold"
            style={{
              fontSize: 10, color: isSelected ? color : `${color}cc`,
              background: `${color}12`, border: `1px solid ${color}22`,
              padding: '1px 6px', borderRadius: 4,
            }}
          >
            {techs.length} T
          </span>
          {subTechCount > 0 && (
            <span
              className="font-mono"
              style={{
                fontSize: 10, color: '#64748b',
                background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.08)',
                padding: '1px 6px', borderRadius: 4,
              }}
            >
              {subTechCount} S
            </span>
          )}
        </div>

        {/* Coverage bar */}
        {hasCoverage && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: coverageBarColor }}>
                {covered}/{techs.length} covered
              </span>
              <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: coverageBarColor }}>
                {coveragePct}%
              </span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(0,0,0,0.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${coveragePct}%`, background: coverageBarColor }}
              />
            </div>
          </div>
        )}
      </button>

      {/* Techniques list */}
      {techs.map(tech => (
        <TechniqueCell
          key={tech.id}
          tech={tech}
          tacticColor={color}
          isSelected={selectedTechniqueId === tech.id}
          onSelect={() => selectTechnique(selectedTechniqueId === tech.id ? null : tech.id)}
          coverageEntry={coverageMap.get(tech.id)}
        />
      ))}
    </div>
  )
}

// ── Matrix view ────────────────────────────────────────────────────────────────

export default function MatrixView() {
  const selectedTacticId    = useStore(s => s.selectedTacticId)
  const selectedTechniqueId = useStore(s => s.selectedTechniqueId)

  // Compute actual matrix display counts (multi-tactic techniques appear in each tactic column)
  const { matrixTechCount, matrixSubCount } = useMemo(() => {
    let techCount = 0
    let subCount  = 0
    for (const tac of tactics) {
      const techs = topTechniquesForTactic(tac.id)
      techCount += techs.length
      subCount  += techs.reduce((s, t) => s + t.subtechniques.length, 0)
    }
    return { matrixTechCount: techCount, matrixSubCount: subCount }
  }, [])

  return (
    <div className="h-full overflow-auto p-5 bg-app bg-grid">
      {/* Stats header */}
      <MatrixStatsHeader
        matrixTechCount={matrixTechCount}
        matrixSubCount={matrixSubCount}
      />

      {/* Tactic columns */}
      <div className="flex gap-2 min-w-max pb-4">
        {tactics.map(tactic => (
          <TacticColumn
            key={tactic.id}
            tactic={tactic}
            selectedTacticId={selectedTacticId}
            selectedTechniqueId={selectedTechniqueId}
          />
        ))}
      </div>
    </div>
  )
}
