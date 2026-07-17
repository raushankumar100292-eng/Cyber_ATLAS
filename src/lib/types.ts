export interface Tactic {
  id: string
  name: string
  description: string
  order: number
  attackRef: string | null
  attackUrl: string | null
}

export interface MitigationLink {
  id: string
  name: string
  use: string
}

export interface CaseStudyLink {
  id: string
  name: string
}

export interface Technique {
  id: string
  name: string
  description: string
  tactics: string[]
  parent: string | null
  isSubtechnique: boolean
  maturity: string | null
  attackRef: string | null
  attackUrl: string | null
  mitigations: MitigationLink[]
  caseStudies: CaseStudyLink[]
  subtechniques: string[]
}

export interface Mitigation {
  id: string
  name: string
  description: string
  categories: string[]
  techniques: { id: string; use: string }[]
}

export interface ProcedureStep {
  tactic: string
  technique: string
  description: string
}

export interface Reference {
  title: string
  url: string | null
}

export interface CaseStudy {
  id: string
  name: string
  summary: string
  incidentDate: string | null
  target: string | null
  actor: string | null
  type: string | null
  procedure: ProcedureStep[]
  references: Reference[]
}

export interface AtlasDataset {
  meta: { id: string; name: string; version: string; generatedAt: string; source: string }
  stats: {
    tactics: number
    techniques: number
    subtechniques: number
    mitigations: number
    caseStudies: number
  }
  tactics: Tactic[]
  techniques: Technique[]
  mitigations: Mitigation[]
  caseStudies: CaseStudy[]
  index: { techniquesByTactic: Record<string, string[]> }
}

export type Role =
  | 'soc'
  | 'detection'
  | 'threat-hunt'
  | 'soar'
  | 'purple'
  | 'architect'
  | 'alert-gen'
  | 'prompt-eng'

export type CoverageLevel = 'full' | 'partial' | 'none'

export interface CoverageEntry {
  techniqueId: string
  level: CoverageLevel
  tool?: string
  notes?: string
  useCaseCount?: number
  useCaseNames?: string[]
  logSources?: string[]
}

export interface CoverageDataset {
  name: string
  uploadedAt: string
  entries: CoverageEntry[]
  sourceFormat?: 'usecases' | 'coverage'
}

// ── Use Case format (MITRE_UseCases_Sample_30 style) ─────────────────────────
export interface UseCaseEntry {
  useCaseName: string
  logSource: string
  detectionCategory: string
  tacticId: string
  tacticName: string
  techniqueId: string
  techniqueName: string
  subTechniqueId?: string
  subTechniqueName?: string
}

export interface UseCaseAnalysis {
  total: number
  tacticBreakdown: { tacticId: string; tacticName: string; count: number }[]
  logSourceBreakdown: { source: string; count: number }[]
  categoryBreakdown: { category: string; count: number }[]
  topGaps: string[]
  techniquesCovered: number
  tacticsFullyCovered: number
}
