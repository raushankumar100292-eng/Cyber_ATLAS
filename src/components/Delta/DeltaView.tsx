import React, { useRef, useState, type DragEvent } from 'react'
import {
  Upload, FileSpreadsheet, X, CheckCircle2, AlertCircle,
  ArrowRight, ArrowRightLeft, Plus, Minus,
  RefreshCw, ChevronDown, ChevronUp,
  FileDown, Table2, Send, Bot,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import * as XLSX from 'xlsx'
import {
  parseExcelToRaw, computeDelta,
  type DeltaDoc, type DeltaResult, type DeltaStatus,
} from '../../lib/delta'
import { useStore } from '../../lib/store'

// ── Palette ───────────────────────────────────────────────────────────────────
const STATUS_META: Record<DeltaStatus, { label: string; color: string; bg: string; border: string }> = {
  changed:   { label: 'Changed',   color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.25)' },
  added:     { label: 'Added',     color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.25)' },
  removed:   { label: 'Removed',   color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)' },
  unchanged: { label: 'Unchanged', color: '#64748b', bg: 'rgba(100,116,139,0.05)', border: 'rgba(100,116,139,0.15)' },
}

// ── Delta Agent Registry (module-level — persists across re-mounts) ───────────
interface DeltaAgentSkills {
  agentType:        string
  label:            string
  color:            string
  trainedAt:        number
  reuseCount:       number
  analysisTemplate: string[]
  outputFormat:     string
  commonPatterns:   string[]
}
const DELTA_AGENT_REGISTRY = new Map<string, DeltaAgentSkills>()

interface DeltaAgentConf {
  type: string; label: string; shortLabel: string
  color: string; icon: string; keywords: string[]; desc: string
}
const DELTA_AGENTS: DeltaAgentConf[] = [
  { type: 'trend',      label: 'Trend Analyst',      shortLabel: 'TRD', color: '#38bdf8', icon: '📈', keywords: ['trend','pattern','over time','grow','declin','increase','decrease'], desc: 'Identifies patterns and directional trends across data changes' },
  { type: 'anomaly',    label: 'Anomaly Detector',   shortLabel: 'ANM', color: '#f87171', icon: '⚠',  keywords: ['anomal','outlier','unusual','weird','spike','sudden','unexpected'], desc: 'Detects outliers and unusual changes in the dataset' },
  { type: 'compliance', label: 'Compliance Checker',  shortLabel: 'COM', color: '#fbbf24', icon: '✓',  keywords: ['compli','policy','violation','rule','mandator','regulat','standard'], desc: 'Checks data changes against compliance rules and policies' },
  { type: 'summary',    label: 'Summary Generator',  shortLabel: 'SUM', color: '#34d399', icon: '≡',  keywords: ['summar','brief','overview','highlight','executive','key point','tldr'], desc: 'Produces concise executive summaries of the delta' },
  { type: 'filter',     label: 'Filter Agent',        shortLabel: 'FLT', color: '#a78bfa', icon: '⊡',  keywords: ['filter','find','search','show','extract','where','only','specific'], desc: 'Filters and extracts rows matching specified criteria' },
  { type: 'risk',       label: 'Risk Assessor',       shortLabel: 'RSK', color: '#fb923c', icon: '⚡', keywords: ['risk','threat','danger','critical','priority','impact','severity'], desc: 'Assesses risk levels of data changes' },
  { type: 'report',     label: 'Report Generator',   shortLabel: 'RPT', color: '#818cf8', icon: '📋', keywords: ['report','document','generate','formal','write','draft','executive'], desc: 'Generates formal structured analysis reports' },
  { type: 'correlate',  label: 'Correlation Agent',   shortLabel: 'COR', color: '#00e5ff', icon: '⊕', keywords: ['correlat','relationship','connect','link','associat','between','depend'], desc: 'Finds correlations and relationships between fields' },
  { type: 'custom',     label: 'Custom Analyst',      shortLabel: 'CST', color: '#94a3b8', icon: '◇',  keywords: [], desc: 'Handles custom analysis requests with full flexibility' },
]

function classifyPrompt(prompt: string): DeltaAgentConf {
  const lower = prompt.toLowerCase()
  for (const a of DELTA_AGENTS.slice(0, -1)) {
    if (a.keywords.some(k => lower.includes(k))) return a
  }
  return DELTA_AGENTS[DELTA_AGENTS.length - 1] // custom fallback
}

// ── Groq: train agent + extract reusable skills ───────────────────────────────
interface DeltaAnalysisContext {
  docA?: DeltaDoc; docB?: DeltaDoc; result?: DeltaResult
  singleDoc?: DeltaDoc; keyField?: string; viewFields?: string[]
}

function buildContextSummary(ctx: DeltaAnalysisContext): string {
  if (ctx.result && ctx.docA && ctx.docB) {
    const { result, docA, docB } = ctx
    const topChanged = result.rows.filter(r => r.status === 'changed').slice(0, 5)
      .map(r => `Row "${r.key}": ${r.changedFields.join(', ')} changed`).join('\n')
    const added   = result.rows.filter(r => r.status === 'added').length
    const removed = result.rows.filter(r => r.status === 'removed').length
    return `Two-file delta comparison:
File A: ${docA.fileName} (${docA.rows.length} rows)
File B: ${docB.fileName} (${docB.rows.length} rows)
Key field: ${result.keyField}
Compare fields: ${result.compareFields.join(', ')}
Stats: ${result.stats.changed} changed, ${added} added, ${removed} removed, ${result.stats.unchanged} unchanged
Sample changed rows:\n${topChanged || '(none)'}`
  }
  if (ctx.singleDoc && ctx.keyField) {
    const sample = ctx.singleDoc.rows.slice(0, 3)
      .map(r => ctx.viewFields?.map(f => `${f}: ${r[f]}`).join(', ')).join('\n')
    return `Single file analysis:
File: ${ctx.singleDoc.fileName} (${ctx.singleDoc.rows.length} rows)
Key field: ${ctx.keyField}
Columns: ${ctx.viewFields?.join(', ')}
Sample rows:\n${sample || '(none)'}`
  }
  return 'No data context loaded.'
}

async function groqDeltaAgentAnalyze(
  apiKey: string, prompt: string, agentConf: DeltaAgentConf, ctx: DeltaAnalysisContext,
): Promise<{ output: string; skills: Pick<DeltaAgentSkills, 'analysisTemplate' | 'outputFormat' | 'commonPatterns'> }> {
  const contextSummary = buildContextSummary(ctx)
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: `You are a specialized ${agentConf.label} for data analysis. ${agentConf.desc}. Return ONLY valid JSON, no markdown.` },
        {
          role: 'user',
          content: `Analyst prompt: "${prompt}"\n\nData context:\n${contextSummary}\n\nReturn ONLY this JSON:\n{\n  "output": "<your analysis output — clear, structured, insightful, 200-400 words>",\n  "skills": {\n    "analysisTemplate": ["<reusable step 1 for ${agentConf.type} tasks>", "<step 2>", "<step 3>"],\n    "outputFormat": "<describe the format you used: bullet list | table | narrative | etc>",\n    "commonPatterns": ["<pattern 1 to look for in ${agentConf.type} analysis>", "<pattern 2>", "<pattern 3>"]\n  }\n}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 700,
    }),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}: ${res.statusText}`)
  const data = await res.json()
  const raw = (data.choices?.[0]?.message?.content ?? '{}')
    .replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
  return JSON.parse(raw)
}

// ── Apply cached skills — zero Groq tokens ────────────────────────────────────
function applyDeltaSkills(skills: DeltaAgentSkills, prompt: string, ctx: DeltaAnalysisContext): string {
  const contextSummary = buildContextSummary(ctx)
  const steps = skills.analysisTemplate.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const patterns = skills.commonPatterns.map(p => `• ${p}`).join('\n')

  // Programmatic quick analysis for delta context
  let dataInsights = ''
  if (ctx.result) {
    const r = ctx.result
    const topChanged = r.rows.filter(x => x.status === 'changed').slice(0, 5)
    dataInsights = [
      `Changed: ${r.stats.changed} records across ${r.compareFields.length} fields.`,
      `Added: ${r.stats.added} new records in File B.`,
      `Removed: ${r.stats.removed} records missing from File B.`,
      topChanged.length > 0 ? `Top changed rows: ${topChanged.map(x => `"${x.key}" (${x.changedFields.join(', ')})`).join('; ')}.` : '',
    ].filter(Boolean).join(' ')
  } else if (ctx.singleDoc) {
    dataInsights = `File has ${ctx.singleDoc.rows.length} rows across ${ctx.viewFields?.length ?? 0} selected columns.`
  }

  return `**${skills.label} — Skills Reuse** *(0 tokens · trained ${new Date(skills.trainedAt).toLocaleTimeString()})*

**Prompt interpreted:** ${prompt}

**Context:**
${contextSummary.slice(0, 300)}

**Applied analysis approach (${skills.reuseCount + 1}× reuse):**
${steps}

**Data insights:**
${dataInsights}

**Patterns applied:**
${patterns}

---
*Reused cached skills — no AI tokens consumed. For deeper custom analysis, the next new task type will train a new agent.*`
}

// ── Excel download helper ────────────────────────────────────────────────────
function downloadXlsx(wb: XLSX.WorkBook, filename: string) {
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.style.display = 'none'
  document.body.appendChild(a); a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 3000)
}

// ── Enhanced Delta Excel export (includes raw File A + File B sheets) ─────────
function exportDeltaToExcel(result: DeltaResult, docA: DeltaDoc, docB: DeltaDoc) {
  const wb  = XLSX.utils.book_new()
  const now = new Date().toLocaleString()

  // 1. Summary
  const summaryData: (string | number)[][] = [
    ['DELTA ANALYSIS REPORT'], ['Generated', now], [],
    ['Document A (Baseline)', docA.fileName, `${docA.rows.length} rows`, `${docA.columns.length} cols`],
    ['Document B (Updated)',  docB.fileName, `${docB.rows.length} rows`, `${docB.columns.length} cols`],
    [], ['Key Field (A)', result.keyFieldA], ['Key Field (B)', result.keyFieldB],
    ['Compared Fields', result.compareFields.join(', ')],
    [], ['─── DELTA STATISTICS ───'],
    ['Changed',   result.stats.changed],
    ['Added',     result.stats.added],
    ['Removed',   result.stats.removed],
    ['Unchanged', result.stats.unchanged],
    ['Total',     result.rows.length],
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 55 }, { wch: 14 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  // 2. File A — full raw data
  const wsA = XLSX.utils.aoa_to_sheet([docA.columns, ...docA.rows.map(r => docA.columns.map(c => r[c] ?? ''))])
  wsA['!cols'] = docA.columns.map(() => ({ wch: 22 }))
  XLSX.utils.book_append_sheet(wb, wsA, 'File A (Baseline)')

  // 3. File B — full raw data
  const wsB = XLSX.utils.aoa_to_sheet([docB.columns, ...docB.rows.map(r => docB.columns.map(c => r[c] ?? ''))])
  wsB['!cols'] = docB.columns.map(() => ({ wch: 22 }))
  XLSX.utils.book_append_sheet(wb, wsB, 'File B (Updated)')

  // 4. Changed — side-by-side A vs B for every compare field
  const changedRows = result.rows.filter(r => r.status === 'changed')
  if (changedRows.length > 0) {
    const headers = [result.keyField, 'Changed Fields',
      ...result.compareFields.flatMap(f => [`${f} (A — Before)`, `${f} (B — After)`])]
    const rows = changedRows.map(r => [
      r.key,
      r.changedFields.join(', '),
      ...result.compareFields.flatMap(f => [r.rowA?.[f] ?? '', r.rowB?.[f] ?? '']),
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 25 }, { wch: 30 }, ...result.compareFields.flatMap(() => [{ wch: 25 }, { wch: 25 }])]
    XLSX.utils.book_append_sheet(wb, ws, 'Changed')
  }

  // 5. Added (only in B)
  const addedRows = result.rows.filter(r => r.status === 'added')
  if (addedRows.length > 0) {
    const headers = [result.keyField, ...result.compareFields]
    const rows    = addedRows.map(r => [r.key, ...result.compareFields.map(f => r.rowB?.[f] ?? '')])
    const ws      = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols']   = [{ wch: 25 }, ...result.compareFields.map(() => ({ wch: 25 }))]
    XLSX.utils.book_append_sheet(wb, ws, 'Added (in B only)')
  }

  // 6. Removed (only in A)
  const removedRows = result.rows.filter(r => r.status === 'removed')
  if (removedRows.length > 0) {
    const headers = [result.keyField, ...result.compareFields]
    const rows    = removedRows.map(r => [r.key, ...result.compareFields.map(f => r.rowA?.[f] ?? '')])
    const ws      = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols']   = [{ wch: 25 }, ...result.compareFields.map(() => ({ wch: 25 }))]
    XLSX.utils.book_append_sheet(wb, ws, 'Removed (in A only)')
  }

  // 7. All Changes combined
  const headers = [result.keyField, 'Status', ...result.compareFields.flatMap(f => [`${f} (A)`, `${f} (B)`])]
  const allRows = result.rows.filter(r => r.status !== 'unchanged').map(r => [
    r.key, r.status.toUpperCase(),
    ...result.compareFields.flatMap(f => [r.rowA?.[f] ?? '', r.rowB?.[f] ?? '']),
  ])
  const wsAll = XLSX.utils.aoa_to_sheet([headers, ...allRows])
  wsAll['!cols'] = [{ wch: 25 }, { wch: 12 }, ...result.compareFields.flatMap(() => [{ wch: 25 }, { wch: 25 }])]
  XLSX.utils.book_append_sheet(wb, wsAll, 'All Changes')

  downloadXlsx(wb, `Delta_${docA.fileName.replace(/\.[^/.]+$/, '')}_vs_${docB.fileName.replace(/\.[^/.]+$/, '')}.xlsx`)
}

function exportSingleFileToExcel(doc: DeltaDoc, keyField: string, viewFields: string[]) {
  const wb  = XLSX.utils.book_new()
  const now = new Date().toLocaleString()

  const summaryData: (string | number)[][] = [
    ['FILE ANALYSIS REPORT'], ['Generated', now], [],
    ['File', doc.fileName, `${doc.rows.length} rows`, `${doc.columns.length} cols`],
    ['Key Field', keyField],
    ['Selected Columns', viewFields.join(', ')],
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 55 }, { wch: 14 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  const displayCols = [keyField, ...viewFields.filter(f => f !== keyField)]
  const wsData = XLSX.utils.aoa_to_sheet([displayCols, ...doc.rows.map(r => displayCols.map(c => r[c] ?? ''))])
  wsData['!cols'] = displayCols.map(() => ({ wch: 25 }))
  XLSX.utils.book_append_sheet(wb, wsData, 'Data')

  downloadXlsx(wb, `Analysis_${doc.fileName.replace(/\.[^/.]+$/, '')}.xlsx`)
}

function exportAgentResultToExcel(
  prompt: string, agentLabel: string, output: string,
  ctx: DeltaAnalysisContext, isReuse: boolean,
) {
  const wb  = XLSX.utils.book_new()
  const now = new Date().toLocaleString()

  const summaryData: (string | number)[][] = [
    ['AGENT ANALYSIS REPORT'], ['Generated', now],
    ['Agent', agentLabel], ['Method', isReuse ? 'Cached Skills (0 tokens)' : 'Groq AI'],
    ['Prompt', prompt], [],
    ['─── ANALYSIS OUTPUT ───'],
    ...output.split('\n').map(line => [line]),
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 24 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Agent Analysis')

  if (ctx.result) {
    const r = ctx.result
    const headers = [r.keyField, 'Status', ...r.compareFields.flatMap(f => [`${f} (A)`, `${f} (B)`])]
    const rows = r.rows.filter(x => x.status !== 'unchanged').map(x => [
      x.key, x.status.toUpperCase(),
      ...r.compareFields.flatMap(f => [x.rowA?.[f] ?? '', x.rowB?.[f] ?? '']),
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 25 }, { wch: 12 }, ...r.compareFields.flatMap(() => [{ wch: 25 }, { wch: 25 }])]
    XLSX.utils.book_append_sheet(wb, ws, 'Delta Data')
  } else if (ctx.singleDoc && ctx.keyField && ctx.viewFields) {
    const cols = [ctx.keyField, ...ctx.viewFields.filter(f => f !== ctx.keyField)]
    const ws = XLSX.utils.aoa_to_sheet([cols, ...ctx.singleDoc.rows.map(r => cols.map(c => r[c] ?? ''))])
    ws['!cols'] = cols.map(() => ({ wch: 25 }))
    XLSX.utils.book_append_sheet(wb, ws, 'File Data')
  }

  downloadXlsx(wb, `AgentReport_${agentLabel.replace(/\s+/g, '_')}_${Date.now()}.xlsx`)
}

// ── Doc Upload Slot ──────────────────────────────────────────────────────────
interface DocSlotProps {
  label: 'A' | 'B'; doc: DeltaDoc | null
  onLoad: (doc: DeltaDoc) => void; onClear: () => void
  disabled?: boolean; optional?: boolean
}
function DocSlot({ label, doc, onLoad, onClear, disabled, optional }: DocSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  async function handleFile(file: File) {
    setError(null)
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls'].includes(ext ?? '')) { setError('Please upload an Excel file (.xlsx or .xls)'); return }
    setLoading(true)
    try {
      const parsed = await parseExcelToRaw(file)
      if (parsed.rows.length === 0) { setError('No rows found in the file'); setLoading(false); return }
      onLoad(parsed)
    } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }
  function onDrop(e: DragEvent) { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }

  const accentColor  = label === 'A' ? '#00e5ff' : '#d946ef'
  const accentBg     = label === 'A' ? 'rgba(0,229,255,0.08)' : 'rgba(217,70,239,0.08)'
  const accentBorder = label === 'A' ? 'rgba(0,229,255,0.25)' : 'rgba(217,70,239,0.25)'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold font-mono"
          style={{ background: accentBg, border: `1px solid ${accentBorder}`, color: accentColor }}>{label}</div>
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Document {label}</span>
        {optional && !doc && <span className="text-[10px] text-slate-700 ml-1">(optional — for two-file comparison)</span>}
        {doc && <button onClick={onClear} disabled={disabled} className="ml-auto text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30"><X className="w-3.5 h-3.5" /></button>}
      </div>

      {!doc && !loading && (
        <div className={`rounded-xl border-2 border-dashed transition-all cursor-pointer p-8 text-center ${disabled ? 'opacity-40 pointer-events-none' : dragging ? '' : 'hover:bg-white/[0.02]'}`}
          style={dragging ? { borderColor: accentColor, background: accentBg } : { borderColor: 'rgba(255,255,255,0.1)' }}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()}>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          <Upload className="w-7 h-7 mx-auto mb-2" style={{ color: accentColor, opacity: 0.5 }} />
          <div className="text-sm font-medium text-slate-300 mb-1">Drop Excel file or <span style={{ color: accentColor }}>browse</span></div>
          <div className="text-xs text-slate-600">.xlsx / .xls</div>
        </div>
      )}
      {loading && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 flex items-center justify-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: accentColor, borderTopColor: 'transparent' }} />
          <span className="text-sm text-slate-400">Parsing file…</span>
        </div>
      )}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <span className="text-xs text-red-300">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {doc && !loading && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border overflow-hidden" style={{ borderColor: accentBorder, background: accentBg }}>
          <div className="px-4 py-3 flex items-center gap-3 border-b" style={{ borderColor: accentBorder }}>
            <FileSpreadsheet className="w-5 h-5 shrink-0" style={{ color: accentColor }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-200 truncate">{doc.fileName}</div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5">{doc.rows.length} rows · {doc.columns.length} columns</div>
            </div>
            <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: accentColor }} />
          </div>
          <div className="px-4 py-3">
            <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-2">Columns</div>
            <div className="flex flex-wrap gap-1">
              {doc.columns.slice(0, 12).map(col => (
                <span key={col} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-slate-400">{col}</span>
              ))}
              {doc.columns.length > 12 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-slate-500">+{doc.columns.length - 12} more</span>}
            </div>
          </div>
          <button onClick={() => setPreviewOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2 border-t text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            style={{ borderColor: accentBorder }}>
            <Eye className="w-3 h-3" />{previewOpen ? 'Hide preview' : 'Show preview (first 5 rows)'}
            {previewOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </button>
          <AnimatePresence>
            {previewOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                className="overflow-hidden border-t" style={{ borderColor: accentBorder }}>
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-[10px] font-mono">
                    <thead><tr className="border-b" style={{ borderColor: accentBorder }}>
                      {doc.columns.slice(0, 6).map(col => <th key={col} className="px-3 py-1.5 text-left text-slate-500 font-semibold whitespace-nowrap">{col}</th>)}
                      {doc.columns.length > 6 && <th className="px-3 py-1.5 text-slate-700">…</th>}
                    </tr></thead>
                    <tbody>
                      {doc.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-b border-white/[0.04]">
                          {doc.columns.slice(0, 6).map(col => <td key={col} className="px-3 py-1.5 text-slate-400 max-w-[140px] truncate whitespace-nowrap">{row[col] || '—'}</td>)}
                          {doc.columns.length > 6 && <td className="px-3 py-1.5 text-slate-700">…</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}

// ── Single File Mapper ────────────────────────────────────────────────────────
function SingleFileMapper({ doc, keyField, viewFields, onKeyField, onToggleView, onRun, running }: {
  doc: DeltaDoc; keyField: string; viewFields: string[]
  onKeyField: (f: string) => void; onToggleView: (f: string) => void; onRun: () => void; running: boolean
}) {
  const canRun = !!keyField && viewFields.length > 0 && !running

  function KeyChip({ col }: { col: string }) {
    const selected = col === keyField
    return (
      <button onClick={() => onKeyField(col)}
        className="text-[11px] font-mono px-2.5 py-1 rounded-lg transition-all hover:opacity-90 flex items-center gap-1"
        style={selected
          ? { background: 'rgba(0,229,255,0.15)', border: '1px solid rgba(0,229,255,0.5)', color: '#00e5ff' }
          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
        {selected && <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-cyan-400" />}
        {col}
      </button>
    )
  }
  function ViewChip({ col }: { col: string }) {
    const checked = viewFields.includes(col); const isKey = col === keyField
    return (
      <button onClick={() => onToggleView(col)} className="text-[11px] font-mono px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5"
        style={{ background: checked ? 'rgba(129,140,248,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${checked ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.08)'}`, color: checked ? '#a5b4fc' : '#475569' }}>
        <div className="w-3 h-3 rounded flex items-center justify-center shrink-0 transition-all"
          style={{ border: `1px solid ${checked ? '#818cf8' : 'rgba(255,255,255,0.2)'}`, background: checked ? 'rgba(129,140,248,0.3)' : 'transparent' }}>
          {checked && <div className="w-1.5 h-1.5 rounded-sm bg-indigo-400" />}
        </div>
        {col}
        {isKey && <span className="text-[9px] px-1 py-0.5 rounded font-semibold" style={{ background: 'rgba(0,229,255,0.15)', color: '#00e5ff' }}>key</span>}
      </button>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <Table2 className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-slate-200">Single File Analysis</span>
        <span className="text-[11px] text-slate-600 ml-1">— or upload Document B above to compare two files</span>
      </div>
      <div className="p-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Identifier / Key Column</div>
          {keyField && <span className="ml-auto text-[10px] font-mono text-cyan-500">{keyField} ✓</span>}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
          {doc.columns.map(col => <KeyChip key={col} col={col} />)}
        </div>
      </div>
      {keyField && (
        <div className="p-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Columns to Include</div>
            {viewFields.length > 0 && <span className="ml-auto text-[10px] font-mono text-indigo-400">{viewFields.length} selected</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {doc.columns.map(col => <ViewChip key={col} col={col} />)}
          </div>
        </div>
      )}
      <div className="px-5 pb-5 pt-4">
        <button onClick={onRun} disabled={!canRun}
          className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: canRun ? 'linear-gradient(135deg,rgba(0,229,255,0.12),rgba(129,140,248,0.12))' : 'rgba(255,255,255,0.03)', border: `1px solid ${canRun ? 'rgba(0,229,255,0.35)' : 'rgba(255,255,255,0.07)'}`, color: canRun ? '#00e5ff' : '#475569' }}>
          {running ? <><div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />Analyzing…</> : <><Table2 className="w-4 h-4" />Analyze File &amp; Export Excel<ArrowRight className="w-4 h-4" /></>}
        </button>
      </div>
    </motion.div>
  )
}

// ── Single File Results ───────────────────────────────────────────────────────
function SingleFileResults({ doc, keyField, viewFields }: { doc: DeltaDoc; keyField: string; viewFields: string[] }) {
  const [showAllRows, setShowAllRows] = useState(false)
  const displayCols  = viewFields.filter(f => f !== keyField)
  const visibleRows  = showAllRows ? doc.rows : doc.rows.slice(0, 30)

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Rows',       value: doc.rows.length,    color: '#00e5ff', border: 'rgba(0,229,255,0.25)',    bg: 'rgba(0,229,255,0.08)' },
          { label: 'Total Columns',    value: doc.columns.length, color: '#818cf8', border: 'rgba(129,140,248,0.25)', bg: 'rgba(129,140,248,0.08)' },
          { label: 'Columns Selected', value: viewFields.length,  color: '#34d399', border: 'rgba(52,211,153,0.25)',  bg: 'rgba(52,211,153,0.08)' },
        ].map(({ label, value, color, border, bg }) => (
          <div key={label} className="rounded-xl border px-4 py-3 text-center" style={{ borderColor: border, background: bg }}>
            <div className="text-2xl font-bold font-mono" style={{ color }}>{value}</div>
            <div className="text-[10px] uppercase tracking-wider mt-1" style={{ color, opacity: 0.7 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Download button */}
      <button onClick={() => exportSingleFileToExcel(doc, keyField, viewFields)}
        className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all hover:opacity-90 active:scale-[0.99]"
        style={{ background: 'linear-gradient(135deg,rgba(0,229,255,0.15),rgba(129,140,248,0.15))', border: '1px solid rgba(0,229,255,0.40)', color: '#00e5ff', boxShadow: '0 0 18px rgba(0,229,255,0.10)' }}>
        <FileDown className="w-5 h-5" />Download Excel Report
        <span className="text-[11px] font-normal text-cyan-600 ml-1">— {doc.rows.length} rows · Summary + Data sheets</span>
      </button>

      {/* Data table */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
          <Table2 className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Data Preview</span>
          <span className="ml-auto text-[10px] text-slate-600 font-mono">{doc.rows.length} rows · {doc.fileName}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-white/[0.06]">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-cyan-500 uppercase tracking-wider whitespace-nowrap">{keyField}</th>
              {displayCols.map(col => <th key={col} className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{col}</th>)}
            </tr></thead>
            <tbody>
              {visibleRows.map((row, i) => (
                <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5 font-mono font-semibold text-cyan-400 whitespace-nowrap">{row[keyField] || '—'}</td>
                  {displayCols.map(col => <td key={col} className="px-4 py-2.5 font-mono text-slate-400 max-w-[180px] truncate">{row[col] || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {doc.rows.length > 30 && !showAllRows && (
            <div className="px-4 py-3 border-t border-white/[0.06] text-center">
              <button onClick={() => setShowAllRows(true)} className="text-xs text-slate-500 hover:text-cyan-400 transition-colors font-mono">
                Show all {doc.rows.length} rows ↓
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ── Column Mapper (two-file delta) ────────────────────────────────────────────
function ColumnMapper({ docA, docB, keyFieldA, keyFieldB, compareFields, onKeyFieldA, onKeyFieldB, onToggleCompare, onRun, running }: {
  docA: DeltaDoc; docB: DeltaDoc; keyFieldA: string; keyFieldB: string; compareFields: string[]
  onKeyFieldA: (f: string) => void; onKeyFieldB: (f: string) => void
  onToggleCompare: (f: string) => void; onRun: () => void; running: boolean
}) {
  const setA = new Set(docA.columns); const setB = new Set(docB.columns)
  const commonCols = docA.columns.filter(c => setB.has(c))
  const aOnlyCols  = docA.columns.filter(c => !setB.has(c))
  const bOnlyCols  = docB.columns.filter(c => !setA.has(c))
  const hasCompare = commonCols.length + aOnlyCols.length + bOnlyCols.length > 0
  const canRun     = !!keyFieldA && !!keyFieldB && compareFields.length > 0 && !running

  function ColChip({ col, selected, color, onClick }: { col: string; selected: boolean; color: 'cyan' | 'fuchsia'; onClick: () => void }) {
    const styles = {
      cyan:    { on: { background: 'rgba(0,229,255,0.15)', border: '1px solid rgba(0,229,255,0.5)', color: '#00e5ff' }, off: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' } },
      fuchsia: { on: { background: 'rgba(217,70,239,0.15)', border: '1px solid rgba(217,70,239,0.5)', color: '#e879f9' }, off: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' } },
    }
    const s = selected ? styles[color].on : styles[color].off
    return (
      <button onClick={onClick} className="text-[11px] font-mono px-2.5 py-1 rounded-lg transition-all hover:opacity-90 flex items-center gap-1" style={s}>
        {selected && <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />}
        {col}
      </button>
    )
  }
  function CompareChip({ col, tag }: { col: string; tag: 'A+B' | 'A' | 'B' }) {
    const checked = compareFields.includes(col)
    const tagColor = tag === 'A+B' ? '#818cf8' : tag === 'A' ? '#00e5ff' : '#e879f9'
    const isKeyCol = col === keyFieldA || col === keyFieldB
    return (
      <button onClick={() => onToggleCompare(col)} className="text-[11px] font-mono px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5"
        style={{ background: checked ? 'rgba(129,140,248,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${checked ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.08)'}`, color: checked ? '#a5b4fc' : '#475569' }}>
        <div className="w-3 h-3 rounded flex items-center justify-center shrink-0 transition-all"
          style={{ border: `1px solid ${checked ? '#818cf8' : 'rgba(255,255,255,0.2)'}`, background: checked ? 'rgba(129,140,248,0.3)' : 'transparent' }}>
          {checked && <div className="w-1.5 h-1.5 rounded-sm bg-indigo-400" />}
        </div>
        {col}
        <span className="text-[9px] px-1 py-0.5 rounded font-semibold opacity-70" style={{ background: `${tagColor}22`, color: tagColor }}>{tag}</span>
        {isKeyCol && <span className="text-[9px] px-1 py-0.5 rounded font-semibold" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>key</span>}
      </button>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2 flex-wrap">
        <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
        <span className="text-sm font-semibold text-slate-200">Configure Delta</span>
        <div className="flex items-center gap-2 ml-auto text-[11px] text-slate-600 flex-wrap">
          {commonCols.length > 0 && <span className="font-mono">{commonCols.length} shared</span>}
          {aOnlyCols.length  > 0 && <span className="font-mono text-cyan-800">{aOnlyCols.length} A-only</span>}
          {bOnlyCols.length  > 0 && <span className="font-mono text-fuchsia-900">{bOnlyCols.length} B-only</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-0 divide-x divide-white/[0.06]">
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold font-mono" style={{ background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.25)', color: '#00e5ff' }}>A</div>
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Key Field — Doc A</div>
              <div className="text-[10px] text-slate-700 truncate max-w-[160px]">{docA.fileName}</div></div>
            {keyFieldA && <span className="ml-auto text-[10px] font-mono text-cyan-500 truncate max-w-[80px]">{keyFieldA} ✓</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
            {docA.columns.map(col => <ColChip key={col} col={col} selected={keyFieldA === col} color="cyan" onClick={() => onKeyFieldA(col)} />)}
          </div>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold font-mono" style={{ background: 'rgba(217,70,239,0.1)', border: '1px solid rgba(217,70,239,0.25)', color: '#e879f9' }}>B</div>
            <div><div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Key Field — Doc B</div>
              <div className="text-[10px] text-slate-700 truncate max-w-[160px]">{docB.fileName}</div></div>
            {keyFieldB && <span className="ml-auto text-[10px] font-mono text-fuchsia-500 truncate max-w-[80px]">{keyFieldB} ✓</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
            {docB.columns.map(col => <ColChip key={col} col={col} selected={keyFieldB === col} color="fuchsia" onClick={() => onKeyFieldB(col)} />)}
          </div>
        </div>
      </div>
      {(keyFieldA || keyFieldB) && hasCompare && (
        <div className="border-t border-white/[0.06] p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Compare Fields</div>
            <span className="text-[10px] text-slate-700">click to include / exclude</span>
            {compareFields.length > 0 && <span className="ml-auto text-[10px] font-mono text-indigo-400">{compareFields.length} selected</span>}
          </div>
          <div className="space-y-2">
            {commonCols.length > 0 && <div className="flex flex-wrap gap-1.5">{commonCols.map(f => <CompareChip key={f} col={f} tag="A+B" />)}</div>}
            {(aOnlyCols.length > 0 || bOnlyCols.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {aOnlyCols.map(f => <CompareChip key={f} col={f} tag="A" />)}
                {bOnlyCols.map(f => <CompareChip key={f} col={f} tag="B" />)}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="px-5 pb-5 pt-2">
        {keyFieldA && keyFieldB && (
          <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-600 font-mono">
            <span style={{ color: '#00e5ff' }}>{keyFieldA}</span><span className="text-slate-700">↔</span><span style={{ color: '#e879f9' }}>{keyFieldB}</span>
            {keyFieldA !== keyFieldB && <span className="text-amber-700 ml-1">(different column names)</span>}
            {compareFields.length > 0 && <span className="ml-auto text-slate-600">{compareFields.length} field{compareFields.length !== 1 ? 's' : ''} to compare</span>}
          </div>
        )}
        <button onClick={onRun} disabled={!canRun}
          className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: canRun ? 'linear-gradient(135deg,rgba(0,229,255,0.12),rgba(129,140,248,0.12))' : 'rgba(255,255,255,0.03)', border: `1px solid ${canRun ? 'rgba(0,229,255,0.35)' : 'rgba(255,255,255,0.07)'}`, color: canRun ? '#00e5ff' : '#475569' }}>
          {running ? <><div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />Running Delta…</> : <><ArrowRightLeft className="w-4 h-4" />Run Delta &amp; Export Excel<ArrowRight className="w-4 h-4" /></>}
        </button>
      </div>
    </motion.div>
  )
}

// ── Delta Results ─────────────────────────────────────────────────────────────
type DeltaTab = 'changed' | 'added' | 'removed'

function DeltaResults({ result, docA, docB }: { result: DeltaResult; docA: DeltaDoc; docB: DeltaDoc }) {
  const [activeTab, setActiveTab]     = useState<DeltaTab>('changed')
  const [showAllRows, setShowAllRows] = useState(false)
  const [downloaded, setDownloaded]   = useState(false)

  const filteredRows = result.rows.filter(r => r.status === activeTab)
  const visibleRows  = showAllRows ? filteredRows : filteredRows.slice(0, 30)

  function handleDownload() {
    exportDeltaToExcel(result, docA, docB)
    setDownloaded(true)
    setTimeout(() => setDownloaded(false), 3000)
  }

  const STAT_CARDS = [
    { label: 'Changed',   value: result.stats.changed,   status: 'changed'   as DeltaStatus },
    { label: 'Added',     value: result.stats.added,     status: 'added'     as DeltaStatus },
    { label: 'Removed',   value: result.stats.removed,   status: 'removed'   as DeltaStatus },
    { label: 'Unchanged', value: result.stats.unchanged, status: 'unchanged' as DeltaStatus },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Stat chips */}
      <div className="grid grid-cols-4 gap-3">
        {STAT_CARDS.map(({ label, value, status }) => {
          const meta = STATUS_META[status]
          return (
            <div key={label} className="rounded-xl border px-4 py-3 text-center transition-all" style={{ borderColor: meta.border, background: meta.bg }}>
              <div className="text-2xl font-bold font-mono" style={{ color: meta.color }}>{value}</div>
              <div className="text-[10px] uppercase tracking-wider mt-1" style={{ color: meta.color, opacity: 0.7 }}>{label}</div>
            </div>
          )
        })}
      </div>

      {/* Immediate Excel download */}
      <button onClick={handleDownload}
        className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all hover:opacity-90 active:scale-[0.99]"
        style={{ background: 'linear-gradient(135deg,rgba(52,211,153,0.15),rgba(129,140,248,0.15))', border: `1px solid ${downloaded ? 'rgba(52,211,153,0.60)' : 'rgba(52,211,153,0.35)'}`, color: downloaded ? '#34d399' : '#a7f3d0', boxShadow: '0 0 20px rgba(52,211,153,0.10)' }}>
        <FileDown className="w-5 h-5" />
        {downloaded ? '✓ Downloading…' : 'Download Delta Report (.xlsx)'}
        <span className="text-[11px] font-normal opacity-70 ml-1">
          — Summary · File A · File B · Changed · Added · Removed · All Changes
        </span>
      </button>

      {/* Tabbed delta table */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <div className="flex border-b border-white/[0.06]">
          {(['changed', 'added', 'removed'] as DeltaTab[]).map(tab => {
            const meta = STATUS_META[tab]; const count = result.rows.filter(r => r.status === tab).length; const active = activeTab === tab
            return (
              <button key={tab} onClick={() => { setActiveTab(tab); setShowAllRows(false) }}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all border-b-2 -mb-px"
                style={{ borderBottomColor: active ? meta.color : 'transparent', color: active ? meta.color : '#64748b', background: active ? meta.bg : 'transparent' }}>
                {tab === 'changed' && <ArrowRightLeft className="w-3 h-3" />}
                {tab === 'added'   && <Plus className="w-3 h-3" />}
                {tab === 'removed' && <Minus className="w-3 h-3" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono" style={{ background: meta.bg, color: meta.color }}>{count}</span>
              </button>
            )
          })}
        </div>
        {filteredRows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-600">No {activeTab} records</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-white/[0.06]">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                  {result.keyFieldA !== result.keyFieldB ? <>{result.keyFieldA} <span className="text-slate-700">/ {result.keyFieldB}</span></> : result.keyField}
                </th>
                {activeTab === 'changed' ? (
                  <>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Changed Fields</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">File A (Before)</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">File B (After)</th>
                  </>
                ) : (
                  result.compareFields.slice(0, 5).map(f => <th key={f} className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{f}</th>)
                )}
              </tr></thead>
              <tbody>
                {visibleRows.map((row, i) => {
                  const meta = STATUS_META[row.status]
                  return (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 font-mono font-semibold whitespace-nowrap" style={{ color: meta.color }}>{row.key}</td>
                      {activeTab === 'changed' ? (
                        <>
                          <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">
                            {row.changedFields.map(f => <span key={f} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>{f}</span>)}
                          </div></td>
                          <td className="px-4 py-2.5">{row.changedFields.map(f => <div key={f} className="text-[11px] font-mono text-red-300/80 line-through">{row.rowA?.[f] || '—'}</div>)}</td>
                          <td className="px-4 py-2.5">{row.changedFields.map(f => <div key={f} className="text-[11px] font-mono text-green-300/90">{row.rowB?.[f] || '—'}</div>)}</td>
                        </>
                      ) : (
                        result.compareFields.slice(0, 5).map(f => {
                          const val = activeTab === 'added' ? row.rowB?.[f] : row.rowA?.[f]
                          return <td key={f} className="px-4 py-2.5 font-mono text-slate-400 max-w-[180px] truncate">{val || '—'}</td>
                        })
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filteredRows.length > 30 && !showAllRows && (
              <div className="px-4 py-3 border-t border-white/[0.06] text-center">
                <button onClick={() => setShowAllRows(true)} className="text-xs text-slate-500 hover:text-cyan-400 transition-colors font-mono">
                  Show all {filteredRows.length} records ↓
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Delta Agent Panel ─────────────────────────────────────────────────────────
interface AgentMessage {
  id:        string
  prompt:    string
  agentConf: DeltaAgentConf
  isReuse:   boolean
  output:    string
  status:    'running' | 'done' | 'error'
  error?:    string
  timestamp: number
}

function DeltaAgentPanel({ groqKey, ctx }: { groqKey: string; ctx: DeltaAnalysisContext }) {
  const [prompt,     setPrompt]     = useState('')
  const [messages,   setMessages]   = useState<AgentMessage[]>([])
  const [regVersion, setRegVersion] = useState(0)
  const [running,    setRunning]    = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const hasData = !!(ctx.result || ctx.singleDoc)
  const agents  = Array.from(DELTA_AGENT_REGISTRY.values()).sort((a, b) => b.trainedAt - a.trainedAt)
  const totalReuses = agents.reduce((s, a) => s + a.reuseCount, 0)

  async function handleSubmit() {
    if (!prompt.trim() || running || !hasData) return
    const agentConf = classifyPrompt(prompt.trim())
    const msgId     = `msg-${Date.now()}`
    const cached    = DELTA_AGENT_REGISTRY.get(agentConf.type)
    const isReuse   = !!cached

    const msg: AgentMessage = { id: msgId, prompt: prompt.trim(), agentConf, isReuse, output: '', status: 'running', timestamp: Date.now() }
    setMessages(prev => [msg, ...prev])
    setPrompt('')
    setRunning(true)

    try {
      let output: string
      if (isReuse) {
        // Apply cached skills — zero tokens
        output = applyDeltaSkills(cached!, prompt.trim(), ctx)
        cached!.reuseCount++
        setRegVersion(v => v + 1)
      } else if (groqKey.trim()) {
        // Train new agent via Groq
        const result = await groqDeltaAgentAnalyze(groqKey.trim(), prompt.trim(), agentConf, ctx)
        output = result.output
        const skills: DeltaAgentSkills = {
          agentType: agentConf.type, label: agentConf.label, color: agentConf.color,
          trainedAt: Date.now(), reuseCount: 0, ...result.skills,
        }
        DELTA_AGENT_REGISTRY.set(agentConf.type, skills)
        setRegVersion(v => v + 1)
      } else {
        output = `**${agentConf.label}** — No Groq API key configured.\n\nAdd a Groq API key above to enable AI-powered analysis. The agent will remember skills for future requests of the same type.`
      }
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, output, status: 'done' } : m))
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, output: '', status: 'error', error: String(err) } : m))
    } finally {
      setRunning(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.04] overflow-hidden">

      {/* Master agent header */}
      <div className="px-5 py-3 border-b border-indigo-500/15 flex items-center gap-3 flex-wrap">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.35)' }}>
          <Bot className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div>
          <div className="text-sm font-semibold text-indigo-200">Data Analysis Agents</div>
          <div className="text-[10px] text-slate-600 font-mono">master agent routes prompts · child agents store skills · reuse = 0 tokens</div>
        </div>
        <div className="ml-auto flex gap-4">
          <div className="text-center">
            <div className="text-base font-bold font-mono text-indigo-400">{agents.length}</div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wider">Trained</div>
          </div>
          <div className="text-center">
            <div className="text-base font-bold font-mono text-green-400">{totalReuses}</div>
            <div className="text-[9px] text-slate-600 uppercase tracking-wider">Reused</div>
          </div>
        </div>
      </div>

      <div className="flex divide-x divide-white/[0.06]" style={{ minHeight: 320 }}>

        {/* Agent Registry sidebar */}
        <div style={{ width: 200, flexShrink: 0 }} className="flex flex-col">
          <div className="px-4 py-2.5 border-b border-white/[0.05] text-[9.5px] font-semibold text-slate-600 uppercase tracking-wider">
            Agent Registry
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {agents.length === 0 ? (
              <div className="text-center py-6">
                <div className="text-2xl mb-2 opacity-30">◈</div>
                <div className="text-[10px] text-slate-700">No agents trained yet. Send a prompt to begin.</div>
              </div>
            ) : agents.map(a => (
              <div key={a.agentType} className="rounded-lg p-2.5 text-[10px]" style={{ background: `${a.color}08`, border: `1px solid ${a.color}25` }}>
                <div className="font-semibold mb-1" style={{ color: a.color }}>{DELTA_AGENTS.find(d => d.type === a.agentType)?.icon} {a.label}</div>
                <div className="text-slate-600 font-mono text-[9px] mb-1">trained {new Date(a.trainedAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</div>
                <div className="flex gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}>
                    {a.reuseCount}× reused
                  </span>
                </div>
              </div>
            ))}
          </div>
          {/* Available agent types */}
          <div className="border-t border-white/[0.05] p-3">
            <div className="text-[9px] text-slate-700 uppercase tracking-wider mb-2">Available Agents</div>
            <div className="space-y-1">
              {DELTA_AGENTS.map(a => {
                const trained = DELTA_AGENT_REGISTRY.has(a.type)
                return (
                  <div key={a.type} className="flex items-center gap-1.5">
                    <span style={{ color: a.color, fontSize: 10 }}>{a.icon}</span>
                    <span className="text-[9px]" style={{ color: trained ? a.color : '#475569' }}>{a.label}</span>
                    {trained && <span className="ml-auto text-[8px] text-green-600">✓</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Prompt + Messages area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
                <div className="text-3xl opacity-20">◈</div>
                <div className="text-sm text-slate-600">Type a prompt to analyze the data</div>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {[
                    'Summarize the key changes between both files',
                    'Identify any anomalous records in the delta',
                    'Assess the risk level of these data changes',
                    'Find all records where Status field changed',
                    'Generate a compliance report for these changes',
                    'Analyze trends in the changed records',
                  ].map(s => (
                    <button key={s} onClick={() => setPrompt(s)} className="text-[10px] px-2.5 py-1 rounded-full transition-all hover:opacity-90"
                      style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.20)', color: '#818cf8' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl overflow-hidden" style={{ border: `1px solid ${msg.agentConf.color}25`, background: `${msg.agentConf.color}06` }}>

                {/* Message header */}
                <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: `${msg.agentConf.color}18` }}>
                  <span style={{ color: msg.agentConf.color, fontSize: 14 }}>{msg.agentConf.icon}</span>
                  <span className="text-xs font-semibold" style={{ color: msg.agentConf.color }}>{msg.agentConf.label}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{
                    background: msg.isReuse ? 'rgba(52,211,153,0.12)' : 'rgba(129,140,248,0.12)',
                    border: `1px solid ${msg.isReuse ? 'rgba(52,211,153,0.25)' : 'rgba(129,140,248,0.25)'}`,
                    color: msg.isReuse ? '#34d399' : '#818cf8',
                  }}>
                    {msg.isReuse ? 'CACHED — 0 TOKENS' : 'GROQ AI'}
                  </span>
                  <span className="text-[10px] text-slate-600 ml-auto font-mono">{new Date(msg.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                  {msg.status === 'done' && (
                    <button onClick={() => exportAgentResultToExcel(msg.prompt, msg.agentConf.label, msg.output, ctx, msg.isReuse)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] transition-all hover:opacity-80"
                      style={{ background: `${msg.agentConf.color}10`, border: `1px solid ${msg.agentConf.color}30`, color: msg.agentConf.color }}>
                      <FileDown className="w-2.5 h-2.5" /> Export
                    </button>
                  )}
                </div>

                {/* User prompt */}
                <div className="px-4 pt-3 pb-1">
                  <div className="text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-semibold">Prompt</div>
                  <div className="text-xs text-slate-300 font-mono bg-white/[0.03] rounded-lg px-3 py-2">{msg.prompt}</div>
                </div>

                {/* Output */}
                <div className="px-4 pb-4 pt-2">
                  {msg.status === 'running' && (
                    <div className="flex items-center gap-2 text-[11px] py-3" style={{ color: msg.agentConf.color }}>
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: msg.agentConf.color, borderTopColor: 'transparent' }} />
                      {msg.agentConf.label} analyzing…
                    </div>
                  )}
                  {msg.status === 'error' && (
                    <div className="flex items-start gap-2 text-xs text-red-300 mt-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                      {msg.error}
                    </div>
                  )}
                  {msg.status === 'done' && (
                    <div className="text-[11px] text-slate-300 leading-relaxed mt-2 whitespace-pre-wrap font-mono" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                      {msg.output}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Prompt input */}
          <div className="border-t border-white/[0.06] p-4">
            {!hasData && (
              <div className="text-xs text-slate-600 text-center mb-3 flex items-center justify-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                Run a delta comparison or file analysis above to enable agents
              </div>
            )}
            <div className="flex gap-3">
              <textarea ref={inputRef} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={handleKey}
                disabled={!hasData || running} rows={2}
                placeholder={hasData ? 'Describe what you want to analyze… (Enter to send, Shift+Enter for newline)' : 'Run an analysis above first…'}
                className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-xl px-4 py-3 text-sm text-slate-300 placeholder-slate-700 resize-none focus:outline-none focus:border-indigo-500/40 transition-all leading-relaxed disabled:opacity-40"
              />
              <button onClick={handleSubmit} disabled={!prompt.trim() || !hasData || running}
                className="px-4 py-2 rounded-xl text-sm font-semibold flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                style={{ background: prompt.trim() && hasData && !running ? 'linear-gradient(135deg,rgba(129,140,248,0.20),rgba(99,102,241,0.25))' : 'rgba(255,255,255,0.03)', border: `1px solid ${prompt.trim() && hasData && !running ? 'rgba(129,140,248,0.40)' : 'rgba(255,255,255,0.07)'}`, color: prompt.trim() && hasData && !running ? '#a5b4fc' : '#475569', minWidth: 60 }}>
                {running
                  ? <div className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                  : <><Send className="w-4 h-4" /><span className="text-[9px]">Send</span></>}
              </button>
            </div>
            {prompt.trim() && hasData && (
              <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-600">
                <Bot className="w-3 h-3" />
                Master Agent will route to:
                <span style={{ color: classifyPrompt(prompt).color }}>
                  {classifyPrompt(prompt).icon} {classifyPrompt(prompt).label}
                </span>
                {DELTA_AGENT_REGISTRY.has(classifyPrompt(prompt).type)
                  ? <span className="text-green-600 ml-1">↑ skills cached — 0 tokens</span>
                  : groqKey.trim() ? <span className="text-indigo-500 ml-1">↑ new agent — will train via Groq</span>
                  : <span className="text-amber-700 ml-1">↑ no Groq key — basic output only</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Main DeltaView ────────────────────────────────────────────────────────────
export default function DeltaView() {
  const [docA, setDocA]               = useState<DeltaDoc | null>(null)
  const [docB, setDocB]               = useState<DeltaDoc | null>(null)
  const [keyFieldA, setKeyFieldA]     = useState('')
  const [keyFieldB, setKeyFieldB]     = useState('')
  const [compareFields, setCompareFields] = useState<string[]>([])
  const [deltaResult, setDeltaResult] = useState<DeltaResult | null>(null)
  const [isRunning, setIsRunning]     = useState(false)

  const [singleKeyField,  setSingleKeyField]  = useState('')
  const [singleViewFields, setSingleViewFields] = useState<string[]>([])
  const [singleResult, setSingleResult]       = useState<{ doc: DeltaDoc; keyField: string; viewFields: string[] } | null>(null)
  const [isSingleRunning, setIsSingleRunning] = useState(false)

  const groqKey = useStore(s => s.apiKey)

  const bothLoaded    = docA !== null && docB !== null
  const anyLoaded     = docA !== null || docB !== null
  const onlySingleDoc = docA !== null && docB === null

  function handleClearDoc(slot: 'A' | 'B') {
    if (slot === 'A') { setDocA(null); setSingleKeyField(''); setSingleViewFields([]); setSingleResult(null) }
    else              { setDocB(null) }
    setKeyFieldA(''); setKeyFieldB(''); setCompareFields([]); setDeltaResult(null)
  }

  function handleKeyFieldA(f: string) {
    setKeyFieldA(f); setCompareFields(prev => prev.filter(c => c !== f))
    if (!keyFieldB && docB?.columns.includes(f)) {
      setKeyFieldB(f)
      const common = (docA?.columns ?? []).filter(c => docB?.columns.includes(c) && c !== f)
      if (common.length > 0) setCompareFields(common)
    } else if (keyFieldB) {
      const common = (docA?.columns ?? []).filter(c => docB?.columns.includes(c) && c !== f && c !== keyFieldB)
      if (compareFields.length === 0 && common.length > 0) setCompareFields(common)
    }
  }
  function handleKeyFieldB(f: string) {
    setKeyFieldB(f); setCompareFields(prev => prev.filter(c => c !== f))
    if (keyFieldA) {
      const common = (docA?.columns ?? []).filter(c => docB?.columns.includes(c) && c !== keyFieldA && c !== f)
      if (compareFields.length === 0 && common.length > 0) setCompareFields(common)
    } else if (!keyFieldA && docA?.columns.includes(f)) {
      setKeyFieldA(f)
      const common = (docA?.columns ?? []).filter(c => docB?.columns.includes(c) && c !== f)
      if (common.length > 0) setCompareFields(common)
    }
  }
  function handleToggleCompare(f: string) {
    setCompareFields(prev => prev.includes(f) ? prev.filter(c => c !== f) : [...prev, f])
  }

  async function handleRun() {
    if (!docA || !docB || !keyFieldA || !keyFieldB || compareFields.length === 0) return
    setIsRunning(true); setDeltaResult(null)
    await new Promise(r => setTimeout(r, 180))
    const result = computeDelta(docA, docB, keyFieldA, compareFields, keyFieldB)
    setDeltaResult(result)
    setIsRunning(false)
    // Auto-export immediately after run
    setTimeout(() => exportDeltaToExcel(result, docA, docB), 400)
  }

  function handleSingleKeyField(f: string) {
    setSingleKeyField(f)
    if (docA) setSingleViewFields(docA.columns.filter(c => c !== f))
  }
  function handleToggleSingleView(f: string) {
    setSingleViewFields(prev => prev.includes(f) ? prev.filter(c => c !== f) : [...prev, f])
  }
  async function handleSingleRun() {
    if (!docA || !singleKeyField || singleViewFields.length === 0) return
    setIsSingleRunning(true); setSingleResult(null)
    await new Promise(r => setTimeout(r, 180))
    setSingleResult({ doc: docA, keyField: singleKeyField, viewFields: singleViewFields })
    setIsSingleRunning(false)
    // Auto-export immediately
    setTimeout(() => exportSingleFileToExcel(docA, singleKeyField, singleViewFields), 400)
  }

  function handleReset() {
    setDocA(null); setDocB(null)
    setKeyFieldA(''); setKeyFieldB(''); setCompareFields([]); setDeltaResult(null); setIsRunning(false)
    setSingleKeyField(''); setSingleViewFields([]); setSingleResult(null); setIsSingleRunning(false)
  }

  // Context for agents
  const agentCtx: DeltaAnalysisContext = deltaResult
    ? { result: deltaResult, docA: docA!, docB: docB! }
    : singleResult
    ? { singleDoc: singleResult.doc, keyField: singleResult.keyField, viewFields: singleResult.viewFields }
    : {}

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center">
                <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
              </div>
              <h1 className="text-xl font-semibold text-white">Delta Analyzer</h1>
            </div>
            <p className="text-sm text-slate-500 ml-11">
              Compare two Excel files or analyze a single file. Comparison auto-exports a full delta report with both raw files included.
            </p>
          </div>
          {(docA || docB || deltaResult || singleResult) && (
            <button onClick={handleReset} className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors mt-1">
              <RefreshCw className="w-3.5 h-3.5" /> Reset All
            </button>
          )}
        </div>

        {/* Groq API Key — for agents */}
        {/* Upload slots */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <DocSlot label="A" doc={docA}
            onLoad={d => { setDocA(d); setSingleKeyField(''); setSingleViewFields([]); setSingleResult(null) }}
            onClear={() => handleClearDoc('A')} disabled={isRunning} />
          <DocSlot label="B" doc={docB} onLoad={setDocB}
            onClear={() => handleClearDoc('B')} disabled={isRunning} optional />
        </div>

        {/* Single File Mapper */}
        <AnimatePresence>
          {onlySingleDoc && !singleResult && (
            <div className="mb-6">
              <SingleFileMapper doc={docA!} keyField={singleKeyField} viewFields={singleViewFields}
                onKeyField={handleSingleKeyField} onToggleView={handleToggleSingleView}
                onRun={handleSingleRun} running={isSingleRunning} />
            </div>
          )}
        </AnimatePresence>

        {/* Single file reconfigure bar */}
        <AnimatePresence>
          {singleResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs text-slate-400">
                  Key <span className="text-cyan-400 font-mono">{singleResult.keyField}</span>
                  {' '}· <span className="text-indigo-300 font-mono">{singleResult.viewFields.length} column{singleResult.viewFields.length !== 1 ? 's' : ''}</span>
                  {' '}· {singleResult.doc.rows.length} rows
                </span>
              </div>
              <button onClick={() => setSingleResult(null)} className="text-xs text-slate-600 hover:text-slate-400 transition-colors font-mono">← Reconfigure</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Single File Results */}
        <AnimatePresence>
          {singleResult && (
            <div className="mb-6">
              <SingleFileResults doc={singleResult.doc} keyField={singleResult.keyField} viewFields={singleResult.viewFields} />
            </div>
          )}
        </AnimatePresence>

        {/* Column Mapper — both docs loaded */}
        <AnimatePresence>
          {bothLoaded && !deltaResult && (
            <div className="mb-6">
              <ColumnMapper docA={docA!} docB={docB!} keyFieldA={keyFieldA} keyFieldB={keyFieldB} compareFields={compareFields}
                onKeyFieldA={handleKeyFieldA} onKeyFieldB={handleKeyFieldB}
                onToggleCompare={handleToggleCompare} onRun={handleRun} running={isRunning} />
            </div>
          )}
        </AnimatePresence>

        {/* Delta reconfigure bar */}
        <AnimatePresence>
          {deltaResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-xs text-slate-400">
                  Key <span className="text-cyan-400 font-mono">{deltaResult.keyFieldA}</span>
                  {deltaResult.keyFieldA !== deltaResult.keyFieldB && <> ↔ <span className="text-fuchsia-400 font-mono">{deltaResult.keyFieldB}</span></>}
                  {' '}· <span className="text-indigo-300 font-mono">{deltaResult.compareFields.length} field{deltaResult.compareFields.length !== 1 ? 's' : ''}</span>
                </span>
              </div>
              <button onClick={() => setDeltaResult(null)} className="text-xs text-slate-600 hover:text-slate-400 transition-colors font-mono">← Reconfigure</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delta Results */}
        <AnimatePresence>
          {deltaResult && (
            <div className="mb-6">
              <DeltaResults result={deltaResult} docA={docA!} docB={docB!} />
            </div>
          )}
        </AnimatePresence>

        {/* Data Analysis Agent Panel — shown as soon as data is available */}
        <AnimatePresence>
          {anyLoaded && (
            <div className="mt-6">
              <DeltaAgentPanel groqKey={groqKey} ctx={agentCtx} />
            </div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!docA && !docB && (
          <div className="mt-8 rounded-xl border border-white/[0.05] bg-white/[0.01] px-6 py-10 text-center">
            <ArrowRightLeft className="w-10 h-10 mx-auto mb-3 text-slate-700" />
            <div className="text-sm font-medium text-slate-500 mb-1">Upload an Excel file to begin</div>
            <div className="text-xs text-slate-700 max-w-sm mx-auto">
              Upload Document A alone to analyze a single file, or both A and B to compare two files. Delta report exports automatically with both raw files included.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
