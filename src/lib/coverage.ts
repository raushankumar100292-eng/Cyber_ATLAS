import * as XLSX from 'xlsx'
import { techniques, tactics, topTechniquesForTactic } from './atlas'
import type {
  CoverageDataset, CoverageEntry, CoverageLevel,
  UseCaseEntry, UseCaseAnalysis,
} from './types'

// ── Normalise level strings from coverage format ──────────────────────────────
function normaliseLevel(raw: unknown): CoverageLevel {
  const s = String(raw ?? '').toLowerCase().trim()
  if (s === 'full' || s === 'yes' || s === 'covered' || s === '1' || s === 'true') return 'full'
  if (s === 'partial' || s === 'partial coverage' || s === 'p') return 'partial'
  return 'none'
}

function isUseCaseFormat(keys: string[]): boolean {
  return keys.includes('Use Case Name') || keys.includes('Log Source')
}

// ── Parse Use Case Excel (MITRE_UseCases_Sample style) ───────────────────────
export async function parseUseCaseExcel(
  file: File,
): Promise<{ useCases: UseCaseEntry[]; coverage: CoverageDataset }> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const useCases: UseCaseEntry[] = rows
    .map(row => ({
      useCaseName: String(row['Use Case Name'] ?? '').trim(),
      logSource: String(row['Log Source'] ?? '').trim(),
      detectionCategory: String(row['Detection Category'] ?? '').trim(),
      tacticId: String(row['Tactic ID'] ?? '').trim(),
      tacticName: String(row['MITRE Tactic'] ?? '').trim(),
      techniqueId: String(row['Technique ID'] ?? '').trim(),
      techniqueName: String(row['MITRE Technique'] ?? '').trim(),
      subTechniqueId: String(row['Sub-technique ID'] ?? '').trim() || undefined,
      subTechniqueName: String(row['MITRE Sub-technique'] ?? '').trim() || undefined,
    }))
    .filter(uc => uc.techniqueId)

  const coverage = buildCoverageFromUseCases(
    useCases,
    file.name.replace(/\.[^.]+$/, ''),
  )
  return { useCases, coverage }
}

// ── Build CoverageDataset from use cases ──────────────────────────────────────
export function buildCoverageFromUseCases(
  useCases: UseCaseEntry[],
  name: string,
): CoverageDataset {
  // Group by effective technique ID (sub-technique takes priority)
  const techMap = new Map<string, UseCaseEntry[]>()
  for (const uc of useCases) {
    const id = uc.subTechniqueId || uc.techniqueId
    if (!techMap.has(id)) techMap.set(id, [])
    techMap.get(id)!.push(uc)
  }

  const entries: CoverageEntry[] = []
  for (const [techId, ucs] of techMap) {
    const logSources = [...new Set(ucs.map(u => u.logSource))]
    entries.push({
      techniqueId: techId,
      level: ucs.length >= 2 ? 'full' : 'partial',
      tool: logSources.join(', '),
      notes: ucs.map(u => u.useCaseName).join('; '),
      useCaseCount: ucs.length,
      useCaseNames: ucs.map(u => u.useCaseName),
      logSources,
    })
  }

  return { name, uploadedAt: new Date().toISOString(), entries, sourceFormat: 'usecases' }
}

// ── Analyse use cases (local "AI" analysis) ───────────────────────────────────
export function analyzeUseCases(
  useCases: UseCaseEntry[],
  coverageMap: Map<string, CoverageEntry>,
): UseCaseAnalysis {
  const tacticMap = new Map<string, { name: string; count: number }>()
  const logSourceMap = new Map<string, number>()
  const categoryMap = new Map<string, number>()

  for (const uc of useCases) {
    // Tactic
    const prev = tacticMap.get(uc.tacticId) ?? { name: uc.tacticName, count: 0 }
    tacticMap.set(uc.tacticId, { name: uc.tacticName, count: prev.count + 1 })
    // Log source
    logSourceMap.set(uc.logSource, (logSourceMap.get(uc.logSource) ?? 0) + 1)
    // Category
    categoryMap.set(uc.detectionCategory, (categoryMap.get(uc.detectionCategory) ?? 0) + 1)
  }

  // Match by both ID (ATLAS format) and name (ATT&CK format) to handle both upload types
  const coveredTacticKeys = new Set([
    ...useCases.map(u => u.tacticId.toLowerCase()),
    ...useCases.map(u => u.tacticName.toLowerCase().trim()),
  ])
  const topGaps = tactics
    .filter(t => !coveredTacticKeys.has(t.id.toLowerCase()) && !coveredTacticKeys.has(t.name.toLowerCase().trim()))
    .map(t => t.name)

  return {
    total: useCases.length,
    tacticBreakdown: [...tacticMap.entries()]
      .map(([tacticId, v]) => ({ tacticId, tacticName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count),
    logSourceBreakdown: [...logSourceMap.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    categoryBreakdown: [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    topGaps,
    techniquesCovered: coverageMap.size,
    tacticsFullyCovered: new Set(useCases.map(u => u.tacticName.toLowerCase().trim())).size,
  }
}

// ── Parse legacy coverage Excel ───────────────────────────────────────────────
export async function parseExcel(file: File): Promise<CoverageDataset> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  if (rows.length > 0 && isUseCaseFormat(Object.keys(rows[0]))) {
    const useCases: UseCaseEntry[] = rows
      .map(row => ({
        useCaseName: String(row['Use Case Name'] ?? '').trim(),
        logSource: String(row['Log Source'] ?? '').trim(),
        detectionCategory: String(row['Detection Category'] ?? '').trim(),
        tacticId: String(row['Tactic ID'] ?? '').trim(),
        tacticName: String(row['MITRE Tactic'] ?? '').trim(),
        techniqueId: String(row['Technique ID'] ?? '').trim(),
        techniqueName: String(row['MITRE Technique'] ?? '').trim(),
        subTechniqueId: String(row['Sub-technique ID'] ?? '').trim() || undefined,
        subTechniqueName: String(row['MITRE Sub-technique'] ?? '').trim() || undefined,
      }))
      .filter(uc => uc.techniqueId)
    return buildCoverageFromUseCases(useCases, file.name.replace(/\.[^.]+$/, ''))
  }

  const entries: CoverageEntry[] = []
  for (const row of rows) {
    const id = String(row['Technique ID'] ?? row['technique_id'] ?? row['ID'] ?? row['id'] ?? '').trim()
    if (!id) continue
    const rawLevel = row['Coverage'] ?? row['Coverage Level'] ?? row['coverage'] ?? row['level'] ?? 'none'
    const tool = String(row['Tool'] ?? row['tool'] ?? row['Control'] ?? row['control'] ?? '').trim()
    const notes = String(row['Notes'] ?? row['notes'] ?? '').trim()
    entries.push({
      techniqueId: id,
      level: normaliseLevel(rawLevel),
      tool: tool || undefined,
      notes: notes || undefined,
    })
  }

  return { name: file.name.replace(/\.[^.]+$/, ''), uploadedAt: new Date().toISOString(), entries, sourceFormat: 'coverage' }
}

// ── Parse JSON ────────────────────────────────────────────────────────────────
export async function parseJson(file: File): Promise<CoverageDataset> {
  const text = await file.text()
  const parsed = JSON.parse(text) as unknown

  let rawEntries: unknown[]
  if (Array.isArray(parsed)) {
    rawEntries = parsed
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    rawEntries = Array.isArray(obj.coverage)
      ? (obj.coverage as unknown[])
      : Array.isArray(obj.entries)
        ? (obj.entries as unknown[])
        : []
  } else {
    rawEntries = []
  }

  const name =
    typeof parsed === 'object' && parsed !== null
      ? String((parsed as Record<string, unknown>).name ?? file.name.replace(/\.json$/, ''))
      : file.name.replace(/\.json$/, '')

  const entries: CoverageEntry[] = (rawEntries as Record<string, unknown>[])
    .map(row => ({
      techniqueId: String(row.id ?? row.techniqueId ?? row.technique_id ?? '').trim(),
      level: normaliseLevel(row.level ?? row.coverage ?? row.Coverage ?? 'none'),
      tool: row.tool ? String(row.tool) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
    }))
    .filter(e => e.techniqueId)

  return { name, uploadedAt: new Date().toISOString(), entries, sourceFormat: 'coverage' }
}

// ── Generate & download Excel template ───────────────────────────────────────
export function downloadTemplate() {
  const headers = ['Technique ID', 'Technique Name', 'Tactic', 'Coverage', 'Tool / Control', 'Notes']
  const rows: string[][] = []
  for (const tac of tactics) {
    for (const tech of topTechniquesForTactic(tac.id)) {
      rows.push([tech.id, tech.name, tac.name, '', '', ''])
    }
  }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = [{ wch: 14 }, { wch: 48 }, { wch: 22 }, { wch: 12 }, { wch: 24 }, { wch: 36 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Coverage')
  XLSX.writeFile(wb, 'atlas_coverage_template.xlsx')
}

// ── Export full analysis report ───────────────────────────────────────────────
export function downloadReport(
  coverage: CoverageDataset,
  useCases: UseCaseEntry[],
) {
  const wb = XLSX.utils.book_new()

  // Sheet 1: Use Cases (if available)
  if (useCases.length > 0) {
    const ucRows = useCases.map(uc => ({
      'Use Case Name': uc.useCaseName,
      'Log Source': uc.logSource,
      'Detection Category': uc.detectionCategory,
      'MITRE Tactic': uc.tacticName,
      'Tactic ID': uc.tacticId,
      'MITRE Technique': uc.techniqueName,
      'Technique ID': uc.techniqueId,
      'MITRE Sub-technique': uc.subTechniqueName ?? '',
      'Sub-technique ID': uc.subTechniqueId ?? '',
      'Coverage Level': coverage.entries.find(
        e => e.techniqueId === (uc.subTechniqueId || uc.techniqueId),
      )?.level ?? 'none',
    }))
    const ucWs = XLSX.utils.json_to_sheet(ucRows)
    ucWs['!cols'] = [
      { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 10 },
      { wch: 36 }, { wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 14 },
    ]
    XLSX.utils.book_append_sheet(wb, ucWs, 'Use Cases')
  }

  // Sheet 2: Coverage Summary
  const covRows = coverage.entries.map(e => ({
    'Technique ID': e.techniqueId,
    'Coverage Level': e.level,
    'Use Case Count': e.useCaseCount ?? 1,
    'Log Sources': e.tool ?? '',
    'Use Cases': e.notes ?? '',
  }))
  const covWs = XLSX.utils.json_to_sheet(covRows)
  covWs['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 32 }, { wch: 64 }]
  XLSX.utils.book_append_sheet(wb, covWs, 'Coverage Summary')

  // Sheet 3: Tactic Coverage
  const tacRows = tactics.map(tac => {
    const techs = topTechniquesForTactic(tac.id)
    const covered = techs.filter(t => coverage.entries.find(e => e.techniqueId === t.id))
    return {
      'Tactic': tac.name,
      'Tactic ID': tac.id,
      'Total Techniques': techs.length,
      'Covered': covered.length,
      'Coverage %': techs.length > 0 ? `${Math.round((covered.length / techs.length) * 100)}%` : '0%',
    }
  })
  const tacWs = XLSX.utils.json_to_sheet(tacRows)
  tacWs['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, tacWs, 'Tactic Summary')

  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `atlas_report_${date}.xlsx`)
}

// ── Coverage stats ────────────────────────────────────────────────────────────
export function tacticCoverage(
  tacticId: string,
  coverageMap: Map<string, CoverageEntry>,
): { full: number; partial: number; total: number } {
  const techs = topTechniquesForTactic(tacticId)
  let full = 0, partial = 0
  for (const t of techs) {
    const e = coverageMap.get(t.id)
    if (!e) continue
    if (e.level === 'full') full++
    else if (e.level === 'partial') partial++
  }
  return { full, partial, total: techs.length }
}

export function overallCoverage(coverageMap: Map<string, CoverageEntry>) {
  const all = techniques.filter(t => !t.isSubtechnique)
  let full = 0, partial = 0, none = 0, untagged = 0
  for (const t of all) {
    const e = coverageMap.get(t.id)
    if (!e) { untagged++; continue }
    if (e.level === 'full') full++
    else if (e.level === 'partial') partial++
    else none++
  }
  return { full, partial, none, untagged, total: all.length }
}
