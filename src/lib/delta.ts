export interface RawRow {
  [key: string]: string
}

export interface DeltaDoc {
  fileName: string
  columns: string[]
  rows: RawRow[]
}

export type DeltaStatus = 'added' | 'removed' | 'changed' | 'unchanged'

export interface DeltaRow {
  key: string
  status: DeltaStatus
  rowA: RawRow | null
  rowB: RawRow | null
  changedFields: string[]
}

export interface DeltaResult {
  keyField: string      // display label (= keyFieldA)
  keyFieldA: string     // key column in Doc A
  keyFieldB: string     // key column in Doc B (may differ from keyFieldA)
  compareFields: string[]
  rows: DeltaRow[]
  stats: {
    added: number
    removed: number
    changed: number
    unchanged: number
  }
}

export async function parseExcelToRaw(file: File): Promise<DeltaDoc> {
  const buf = await file.arrayBuffer()
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  const columns = rawRows.length > 0 ? Object.keys(rawRows[0]) : []
  const rows: RawRow[] = rawRows.map(r => {
    const row: RawRow = {}
    for (const col of columns) row[col] = String(r[col] ?? '').trim()
    return row
  })
  return { fileName: file.name, columns, rows }
}

export function getCommonColumns(docA: DeltaDoc, docB: DeltaDoc): string[] {
  const setB = new Set(docB.columns)
  return docA.columns.filter(c => setB.has(c))
}

export function computeDelta(
  docA: DeltaDoc,
  docB: DeltaDoc,
  keyFieldA: string,
  compareFields: string[],
  keyFieldB: string = keyFieldA,
): DeltaResult {
  const mapA = new Map<string, RawRow>()
  const mapB = new Map<string, RawRow>()

  for (const row of docA.rows) {
    const key = (row[keyFieldA] ?? '').trim()
    if (key) mapA.set(key, row)
  }
  for (const row of docB.rows) {
    const key = (row[keyFieldB] ?? '').trim()
    if (key) mapB.set(key, row)
  }

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()])
  const rows: DeltaRow[] = []
  const stats = { added: 0, removed: 0, changed: 0, unchanged: 0 }

  for (const key of allKeys) {
    const rowA = mapA.get(key) ?? null
    const rowB = mapB.get(key) ?? null

    if (!rowA && rowB) {
      rows.push({ key, status: 'added', rowA: null, rowB, changedFields: compareFields })
      stats.added++
    } else if (rowA && !rowB) {
      rows.push({ key, status: 'removed', rowA, rowB: null, changedFields: compareFields })
      stats.removed++
    } else if (rowA && rowB) {
      const changedFields = compareFields.filter(f => {
        const va = (rowA[f] ?? '').toLowerCase().trim()
        const vb = (rowB[f] ?? '').toLowerCase().trim()
        return va !== vb
      })
      if (changedFields.length > 0) {
        rows.push({ key, status: 'changed', rowA, rowB, changedFields })
        stats.changed++
      } else {
        rows.push({ key, status: 'unchanged', rowA, rowB, changedFields: [] })
        stats.unchanged++
      }
    }
  }

  rows.sort((a, b) => {
    const order = { changed: 0, added: 1, removed: 2, unchanged: 3 }
    return order[a.status] - order[b.status]
  })

  return { keyField: keyFieldA, keyFieldA, keyFieldB, compareFields, rows, stats }
}

export function buildDeltaPrompt(docA: DeltaDoc, docB: DeltaDoc, delta: DeltaResult): string {
  const { stats, keyField, compareFields, rows } = delta
  const total = Math.max(docA.rows.length, docB.rows.length)
  const changeRate = total > 0
    ? Math.round(((stats.added + stats.removed + stats.changed) / total) * 100)
    : 0

  const changedSamples = rows
    .filter(r => r.status === 'changed')
    .slice(0, 10)
    .map(r => {
      const diffs = r.changedFields
        .map(f => `${f}: "${r.rowA![f]}" → "${r.rowB![f]}"`)
        .join('; ')
      return `  - [${r.key}]: ${diffs}`
    })
    .join('\n')

  const addedSamples = rows
    .filter(r => r.status === 'added')
    .slice(0, 5)
    .map(r => {
      const vals = compareFields.slice(0, 3).map(f => `${f}="${r.rowB![f]}"`).join(', ')
      return `  - ${r.key} (${vals})`
    })
    .join('\n')

  const removedSamples = rows
    .filter(r => r.status === 'removed')
    .slice(0, 5)
    .map(r => {
      const vals = compareFields.slice(0, 3).map(f => `${f}="${r.rowA![f]}"`).join(', ')
      return `  - ${r.key} (${vals})`
    })
    .join('\n')

  return `You are a senior data analyst comparing two versions of a security dataset.

## Document Comparison
- **Document A**: ${docA.fileName} (${docA.rows.length} rows)
- **Document B**: ${docB.fileName} (${docB.rows.length} rows)
- **Identifier Field**: ${keyField}
- **Compared Fields**: ${compareFields.join(', ')}

## Delta Statistics
- New records added in B: **${stats.added}**
- Records removed from A: **${stats.removed}**
- Records with changed values: **${stats.changed}**
- Unchanged records: **${stats.unchanged}**
- Overall change rate: **${changeRate}%**

## Sample Modified Records
${changedSamples || '  (no changes)'}

## Sample New Records (in B only)
${addedSamples || '  (none added)'}

## Sample Deleted Records (in A only)
${removedSamples || '  (none removed)'}

---

Provide a structured analysis using exactly this format:

## Executive Summary
2–3 sentences on the scale and nature of changes between the two documents.

## Key Changes
Top 3 most significant changes with specific field/value details from the data.

## Impact Assessment
What do these changes mean from an operational or security perspective?

## Recommendations
3 specific, actionable next steps based on the delta findings.

## Risk Rating
**High / Medium / Low** — one sentence explaining the rating based on change volume and impact.

Be concise, technical, and cite specific field names and values from the data.`
}
