import { useRef, useState, type DragEvent } from 'react'
import {
  X, Upload, FileSpreadsheet, FileJson, Download,
  CheckCircle, AlertCircle, Brain, Sparkles, BarChart2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  parseUseCaseExcel, parseExcel, parseJson,
  downloadTemplate, analyzeUseCases,
} from '../../lib/coverage'
import { useStore } from '../../lib/store'
import type { CoverageDataset, UseCaseEntry, UseCaseAnalysis } from '../../lib/types'

type ParseState =
  | { status: 'idle' }
  | { status: 'parsing' }
  | { status: 'analyzing'; progress: number }
  | { status: 'done'; data: CoverageDataset; useCases: UseCaseEntry[]; analysis: UseCaseAnalysis | null }
  | { status: 'error'; message: string }

const ANALYSIS_STEPS = [
  'Reading detection use cases…',
  'Mapping to MITRE ATT&CK framework…',
  'Calculating tactic coverage…',
  'Identifying coverage gaps…',
  'Generating insights…',
]

const CATEGORY_COLORS: Record<string, string> = {
  Identity: '#00e5ff',
  Endpoint: '#ff9f43',
  Network: '#54a0ff',
  Cloud: '#5f27cd',
  AD: '#ee5a24',
  Windows: '#0abde3',
  Kubernetes: '#10ac84',
}

export default function UploadModal() {
  const setUploadOpen = useStore(s => s.setUploadOpen)
  const setCoverage = useStore(s => s.setCoverage)
  const setUseCases = useStore(s => s.setUseCases)
  const existing = useStore(s => s.coverage)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [state, setState] = useState<ParseState>({ status: 'idle' })
  const [stepLabel, setStepLabel] = useState('')

  async function handleFile(file: File) {
    setState({ status: 'parsing' })

    try {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
      const isJson = file.name.endsWith('.json')

      if (isExcel) {
        // Peek at columns to detect use case format
        const { parseUseCaseExcel: puc } = await import('../../lib/coverage')
        void puc // just ensure it's loaded

        // Try use-case format first
        const buf = await file.arrayBuffer()
        const XLSX = await import('xlsx')
        const wb = XLSX.read(buf, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        const cols = Object.keys(rows[0] ?? {})
        const isUseCase = cols.includes('Use Case Name') || cols.includes('Log Source')

        if (isUseCase) {
          // Simulate AI analysis steps
          setState({ status: 'analyzing', progress: 0 })
          const result = await parseUseCaseExcel(file)

          for (let i = 0; i < ANALYSIS_STEPS.length; i++) {
            setStepLabel(ANALYSIS_STEPS[i])
            setState({ status: 'analyzing', progress: Math.round(((i + 1) / ANALYSIS_STEPS.length) * 100) })
            await delay(320)
          }

          const coverageMap = new Map(result.coverage.entries.map(e => [e.techniqueId, e]))
          const analysis = analyzeUseCases(result.useCases, coverageMap)
          setState({ status: 'done', data: result.coverage, useCases: result.useCases, analysis })
        } else {
          const data = await parseExcel(file)
          setState({ status: 'done', data, useCases: [], analysis: null })
        }
      } else if (isJson) {
        const data = await parseJson(file)
        setState({ status: 'done', data, useCases: [], analysis: null })
      } else {
        setState({ status: 'error', message: 'Unsupported file type. Use .xlsx, .xls, or .json' })
      }
    } catch (err) {
      setState({ status: 'error', message: String(err) })
    }
  }

  function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function confirm() {
    if (state.status !== 'done') return
    setCoverage(state.data)
    setUseCases(state.useCases, state.analysis)
    setUploadOpen(false)
  }

  function clearData() {
    setCoverage(null)
    setUseCases([], null)
    setState({ status: 'idle' })
  }

  const isAnalyzing = state.status === 'analyzing'
  const isParsing = state.status === 'parsing'
  const isDone = state.status === 'done'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(4,6,15,0.85)', backdropFilter: 'blur(10px)' }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ duration: 0.2 }}
        className="glass hud-frame rounded-xl w-full max-w-xl mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Brain className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <div className="font-display text-sm font-bold text-cyan-400 tracking-widest">
                AI COVERAGE ANALYZER
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Upload use cases or coverage data · Excel & JSON
              </div>
            </div>
          </div>
          <button onClick={() => setUploadOpen(false)} className="text-slate-600 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Drop zone — hidden during analysis */}
          {!isAnalyzing && !isDone && (
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragging
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : 'border-cyan-500/25 hover:border-cyan-500/50 hover:bg-cyan-500/5'
              }`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.json" className="hidden" onChange={onInputChange} />
              <Upload className="w-8 h-8 text-cyan-500/50 mx-auto mb-3" />
              <div className="text-sm text-slate-300 font-medium">
                Drop file here or <span className="text-cyan-400">browse</span>
              </div>
              <div className="text-xs text-slate-600 mt-1.5 mb-3">
                Supports use case catalog or coverage mapping format
              </div>
              <div className="flex items-center justify-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Excel (.xlsx)
                </span>
                <span className="text-slate-700">·</span>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <FileJson className="w-3.5 h-3.5" /> JSON
                </span>
              </div>
            </div>
          )}

          {/* States */}
          <AnimatePresence mode="wait">

            {/* Parsing */}
            {isParsing && (
              <motion.div key="parsing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-3 text-sm text-slate-400 py-2">
                <div className="w-4 h-4 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
                Reading file…
              </motion.div>
            )}

            {/* AI Analysis progress */}
            {isAnalyzing && (
              <motion.div key="analyzing" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-4 py-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-cyan-300">AI Agent Analyzing…</div>
                    <div className="text-xs text-slate-500 mt-0.5">{stepLabel}</div>
                  </div>
                  <span className="font-mono text-sm text-cyan-400">
                    {(state as { status: 'analyzing'; progress: number }).progress}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, #00e5ff, #818cf8)' }}
                    animate={{ width: `${(state as { status: 'analyzing'; progress: number }).progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </motion.div>
            )}

            {/* Done — analysis results */}
            {isDone && state.status === 'done' && (
              <motion.div key="done" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-3">

                {/* Summary header */}
                <div className="rounded-xl border border-cyan-500/20 overflow-hidden">
                  <div className="px-4 py-2.5 flex items-center gap-2 border-b border-cyan-500/15 bg-cyan-500/5">
                    <CheckCircle className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-medium text-cyan-300">{state.data.name}</span>
                    <span className="ml-auto text-xs text-slate-500 font-mono">
                      {state.data.entries.length} techniques mapped
                    </span>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-cyan-500/15">
                    {[
                      { label: 'Full', value: state.data.entries.filter(e => e.level === 'full').length, color: '#30d158' },
                      { label: 'Partial', value: state.data.entries.filter(e => e.level === 'partial').length, color: '#ffd60a' },
                      { label: 'Use Cases', value: state.useCases.length || state.data.entries.length, color: '#00e5ff' },
                    ].map(s => (
                      <div key={s.label} className="px-4 py-3 text-center">
                        <div className="text-xl font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                        <div className="text-[10px] text-slate-600 uppercase tracking-widest mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Analysis insights */}
                {state.analysis && (
                  <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-purple-500/15 flex items-center gap-2">
                      <BarChart2 className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-[11px] font-mono uppercase tracking-widest text-purple-300">AI Analysis</span>
                    </div>
                    <div className="p-3 space-y-3">
                      {/* Detection categories */}
                      <div>
                        <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1.5">Detection Categories</div>
                        <div className="flex flex-wrap gap-1.5">
                          {state.analysis.categoryBreakdown.map(({ category, count }) => {
                            const col = CATEGORY_COLORS[category] ?? '#64748b'
                            return (
                              <span key={category} className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full"
                                style={{ background: `${col}18`, color: col, border: `1px solid ${col}35` }}>
                                {category} <span className="opacity-60">({count})</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>

                      {/* Log sources */}
                      <div>
                        <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1.5">Log Sources</div>
                        <div className="flex flex-wrap gap-1.5">
                          {state.analysis.logSourceBreakdown.slice(0, 6).map(({ source, count }) => (
                            <span key={source} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-400 border border-slate-700/50">
                              {source} <span className="text-slate-600">({count})</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Gaps */}
                      {state.analysis.topGaps.length > 0 && (
                        <div className="rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2">
                          <div className="text-[10px] text-red-400 uppercase tracking-widest mb-1">Coverage Gaps</div>
                          <div className="text-xs text-slate-400">{state.analysis.topGaps.join(' · ')}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Re-upload link */}
                <button onClick={() => setState({ status: 'idle' })}
                  className="text-[11px] text-slate-600 hover:text-slate-400 transition-colors font-mono">
                  ← Upload a different file
                </button>
              </motion.div>
            )}

            {/* Error */}
            {state.status === 'error' && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="text-sm text-red-300">{state.message}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Format guide — only when idle */}
          {state.status === 'idle' && (
            <div className="rounded-lg border border-cyan-500/10 bg-black/20 px-4 py-3 text-xs text-slate-500 space-y-1">
              <div className="font-mono text-slate-400 text-[11px] uppercase tracking-wider mb-1.5">Accepted Formats</div>
              <div>• <span className="text-slate-400">Use Case Catalog</span>: columns — <span className="font-mono text-cyan-700">Use Case Name, Log Source, Detection Category, MITRE Tactic, Technique ID…</span></div>
              <div>• <span className="text-slate-400">Coverage Map</span>: columns — <span className="font-mono text-cyan-700">Technique ID, Coverage (Full/Partial/None), Tool, Notes</span></div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-cyan-500/20 bg-black/20">
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-400 transition-colors font-mono">
            <Download className="w-3.5 h-3.5" />
            Download Template
          </button>

          {existing && (
            <button onClick={clearData} className="text-xs text-red-400/70 hover:text-red-400 transition-colors font-mono ml-1">
              Clear Data
            </button>
          )}

          <div className="flex-1" />

          <button onClick={() => setUploadOpen(false)}
            className="px-4 py-1.5 text-xs font-mono text-slate-500 hover:text-slate-300 transition-colors">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={state.status !== 'done'}
            className="px-5 py-1.5 text-xs font-mono rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
            style={{
              background: isDone ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(0,229,255,0.4)',
              color: isDone ? '#00e5ff' : '#64748b',
            }}
          >
            <Sparkles className="w-3 h-3" />
            Apply to Dashboard
          </button>
        </div>
      </motion.div>
    </div>
  )
}
