import { X, ExternalLink, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  tacticById,
  techniqueById,
  topTechniquesForTactic,
  subtechniquesOf,
} from '../../lib/atlas'
import { colorForTactic } from '../../lib/theme'
import { useStore } from '../../lib/store'
import type { Tactic, Technique } from '../../lib/types'

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-cyan-500/10">
      <div className="section-label mb-2">
        {label}
      </div>
      {children}
    </div>
  )
}

function MaturityBadge({ maturity, color }: { maturity: string; color: string }) {
  return (
    <span
      className="inline-block text-[9px] font-mono px-1.5 py-0.5 rounded mt-1"
      style={{ background: `${color}25`, color, border: `1px solid ${color}40` }}
    >
      {maturity}
    </span>
  )
}

function TacticPanel({ tactic }: { tactic: Tactic }) {
  const color = colorForTactic(tactic.id)
  const clearSelection = useStore(s => s.clearSelection)
  const selectTechnique = useStore(s => s.selectTechnique)
  const techs = topTechniquesForTactic(tactic.id)

  return (
    <div className="panel-elevated h-full flex flex-col border-l border-white/[0.08] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-cyan-500/20 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono text-[10px] text-slate-500 uppercase tracking-widest">
              {tactic.id}
            </div>
            <div
              className="font-display text-sm font-bold mt-0.5 leading-tight"
              style={{ color, textShadow: `0 0 14px ${color}66` }}
            >
              {tactic.name}
            </div>
          </div>
          <button
            onClick={clearSelection}
            className="text-slate-600 hover:text-slate-300 transition-colors shrink-0 mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {tactic.attackUrl && (
          <a
            href={tactic.attackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1 text-[10px] font-mono text-slate-600 hover:text-cyan-400 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            ATT&CK Reference
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section label="Description">
          <p className="text-xs text-slate-400 leading-relaxed">{tactic.description}</p>
        </Section>

        <Section label={`Techniques (${techs.length})`}>
          <div className="space-y-0.5">
            {techs.map(tech => (
              <button
                key={tech.id}
                onClick={() => selectTechnique(tech.id)}
                className="w-full text-left rounded px-2 py-2 hover:bg-white/5 transition-colors group border-l-2"
                style={{ borderLeftColor: `${color}44` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300 group-hover:text-white transition-colors leading-snug">
                    {tech.name}
                  </span>
                  <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 ml-1" />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-[8px] text-slate-600">{tech.id}</span>
                  {tech.subtechniques.length > 0 && (
                    <span className="text-[8px]" style={{ color: `${color}88` }}>
                      +{tech.subtechniques.length} sub
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}

function TechniquePanel({ technique }: { technique: Technique }) {
  const tacticId = technique.tactics[0] ?? null
  const color = colorForTactic(tacticId)
  const clearSelection = useStore(s => s.clearSelection)
  const selectTechnique = useStore(s => s.selectTechnique)
  const selectTactic = useStore(s => s.selectTactic)
  const subs = subtechniquesOf(technique.id)
  const parentTactic = tacticId ? tacticById.get(tacticId) : null

  return (
    <div className="panel-elevated h-full flex flex-col border-l border-white/[0.08] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-cyan-500/20 shrink-0">
        {/* Breadcrumb */}
        {parentTactic && (
          <button
            onClick={() => selectTactic(parentTactic.id)}
            className="flex items-center gap-1 text-[10px] font-mono mb-2 hover:opacity-80 transition-opacity"
            style={{ color }}
          >
            {parentTactic.name}
            <ChevronRight className="w-3 h-3" />
          </button>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {technique.isSubtechnique && (
              <div className="text-[9px] font-mono text-slate-600 mb-0.5">Sub-technique</div>
            )}
            <div className="font-mono text-[10px] text-slate-500">{technique.id}</div>
            <div className="font-display text-sm font-bold mt-0.5 text-white leading-tight">
              {technique.name}
            </div>
            {technique.maturity && (
              <MaturityBadge maturity={technique.maturity} color={color} />
            )}
          </div>
          <button
            onClick={clearSelection}
            className="text-slate-600 hover:text-slate-300 transition-colors shrink-0 mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {technique.attackUrl && (
          <a
            href={technique.attackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1 text-[10px] font-mono text-slate-600 hover:text-cyan-400 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            ATT&CK Reference
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section label="Description">
          <p className="text-xs text-slate-400 leading-relaxed">{technique.description}</p>
        </Section>

        {technique.tactics.length > 0 && (
          <Section label={`Tactics (${technique.tactics.length})`}>
            <div className="flex flex-wrap gap-1">
              {technique.tactics.map(tid => {
                const c = colorForTactic(tid)
                return (
                  <button
                    key={tid}
                    onClick={() => selectTactic(tid)}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
                    style={{ background: `${c}22`, color: c, border: `1px solid ${c}40` }}
                  >
                    {tid}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {subs.length > 0 && (
          <Section label={`Sub-techniques (${subs.length})`}>
            <div className="space-y-0.5">
              {subs.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => selectTechnique(sub.id)}
                  className="w-full text-left rounded px-2 py-1.5 hover:bg-white/5 transition-colors border-l-2 group"
                  style={{ borderLeftColor: `${color}44` }}
                >
                  <div className="text-xs text-slate-300 group-hover:text-white transition-colors">
                    {sub.name}
                  </div>
                  <div className="font-mono text-[8px] text-slate-600">{sub.id}</div>
                </button>
              ))}
            </div>
          </Section>
        )}

        {technique.mitigations.length > 0 && (
          <Section label={`Mitigations (${technique.mitigations.length})`}>
            <div className="space-y-2">
              {technique.mitigations.map(m => (
                <div key={m.id}>
                  <div className="text-xs text-slate-300 font-medium">{m.name}</div>
                  <div className="font-mono text-[8px] text-slate-600 mb-0.5">{m.id}</div>
                  {m.use && (
                    <div className="text-[10px] text-slate-500 leading-relaxed line-clamp-3">
                      {m.use}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {technique.caseStudies.length > 0 && (
          <Section label={`Case Studies (${technique.caseStudies.length})`}>
            <div className="space-y-1">
              {technique.caseStudies.map(cs => (
                <div
                  key={cs.id}
                  className="text-xs text-slate-400 px-2 py-1.5 rounded border-l-2"
                  style={{ borderLeftColor: `${color}33` }}
                >
                  <div className="text-slate-300">{cs.name}</div>
                  <div className="font-mono text-[8px] text-slate-600">{cs.id}</div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

export default function DetailPanel() {
  const selectedTacticId = useStore(s => s.selectedTacticId)
  const selectedTechniqueId = useStore(s => s.selectedTechniqueId)

  if (selectedTechniqueId) {
    const tech = techniqueById.get(selectedTechniqueId)
    if (tech) return <TechniquePanel technique={tech} />
  }

  if (selectedTacticId) {
    const tactic = tacticById.get(selectedTacticId)
    if (tactic) return <TacticPanel tactic={tactic} />
  }

  return null
}
