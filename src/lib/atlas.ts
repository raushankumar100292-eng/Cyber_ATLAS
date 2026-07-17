import raw from '../data/attck.json'
import type {
  AtlasDataset,
  CaseStudy,
  Mitigation,
  Tactic,
  Technique,
} from './types'

export const atlas = raw as unknown as AtlasDataset

export const tactics: Tactic[] = [...atlas.tactics].sort((a, b) => a.order - b.order)
export const techniques: Technique[] = atlas.techniques
export const mitigations: Mitigation[] = atlas.mitigations
export const caseStudies: CaseStudy[] = atlas.caseStudies

export const tacticById = new Map(tactics.map((t) => [t.id, t]))
export const techniqueById = new Map(techniques.map((t) => [t.id, t]))
export const mitigationById = new Map(mitigations.map((m) => [m.id, m]))
export const caseStudyById = new Map(caseStudies.map((c) => [c.id, c]))

export function topTechniquesForTactic(tacticId: string): Technique[] {
  const ids = atlas.index.techniquesByTactic[tacticId] ?? []
  return ids.map((id) => techniqueById.get(id)!).filter(Boolean)
}

export function subtechniquesOf(techniqueId: string): Technique[] {
  const t = techniqueById.get(techniqueId)
  if (!t) return []
  return t.subtechniques.map((id) => techniqueById.get(id)!).filter(Boolean)
}

/** Short human label used in space-constrained UI spots. */
export const tacticShort: Record<string, string> = {
  'TA0043': 'Recon',
  'TA0042': 'Resource Dev',
  'TA0001': 'Initial Access',
  'TA0002': 'Execution',
  'TA0003': 'Persistence',
  'TA0004': 'Priv. Esc.',
  'TA0005': 'Def. Evasion',
  'TA0006': 'Cred. Access',
  'TA0007': 'Discovery',
  'TA0008': 'Lateral Move',
  'TA0009': 'Collection',
  'TA0011': 'C2',
  'TA0010': 'Exfiltration',
  'TA0040': 'Impact',
}

export function shortName(t: Tactic): string {
  return tacticShort[t.id] ?? t.name
}

// Simple full-text search across tactics + techniques
export interface SearchHit {
  kind: 'tactic' | 'technique' | 'case-study' | 'mitigation'
  id: string
  title: string
  subtitle: string
  score: number
}

export function search(query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  const scoreOf = (hay: string, id: string) => {
    const h = hay.toLowerCase()
    if (id.toLowerCase() === q) return 100
    if (h === q) return 90
    if (h.startsWith(q)) return 60
    if (h.includes(q)) return 30
    return 0
  }
  for (const t of tactics) {
    const s = Math.max(scoreOf(t.name, t.id), scoreOf(t.id, t.id))
    if (s > 0) hits.push({ kind: 'tactic', id: t.id, title: t.name, subtitle: t.id, score: s })
  }
  for (const t of techniques) {
    let s = Math.max(scoreOf(t.name, t.id), scoreOf(t.id, t.id))
    if (s === 0 && t.description.toLowerCase().includes(q)) s = 15
    if (s > 0)
      hits.push({
        kind: 'technique',
        id: t.id,
        title: t.name,
        subtitle: `${t.id}${t.isSubtechnique ? ' · sub-technique' : ''}`,
        score: s,
      })
  }
  for (const c of caseStudies) {
    const s = Math.max(scoreOf(c.name, c.id), scoreOf(c.id, c.id))
    if (s > 0)
      hits.push({ kind: 'case-study', id: c.id, title: c.name, subtitle: c.id, score: s })
  }
  for (const m of mitigations) {
    const s = Math.max(scoreOf(m.name, m.id), scoreOf(m.id, m.id))
    if (s > 0)
      hits.push({ kind: 'mitigation', id: m.id, title: m.name, subtitle: m.id, score: s })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
