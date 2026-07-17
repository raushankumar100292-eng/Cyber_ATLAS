import { useRef, useState, useEffect, type DragEvent } from 'react'
import {
  Upload, FileSpreadsheet, FileJson, CheckCircle2, AlertCircle,
  Sparkles, ArrowRight, X, RotateCcw, ChevronRight,
  Brain, Building2, User, ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseUseCaseExcel, parseExcel, parseJson, analyzeUseCases } from '../../lib/coverage'
import { analyzeWithGroq } from '../../lib/groq'
import { useStore } from '../../lib/store'
import type { CoverageDataset, UseCaseEntry, UseCaseAnalysis } from '../../lib/types'

const INDUSTRIES = [
  { value: 'financial',     label: 'Financial Services & Banking' },
  { value: 'healthcare',    label: 'Healthcare & Life Sciences' },
  { value: 'technology',    label: 'Technology & Software' },
  { value: 'retail',        label: 'Retail & E-Commerce' },
  { value: 'manufacturing', label: 'Manufacturing & Industrial' },
  { value: 'government',    label: 'Government & Public Sector' },
  { value: 'energy',        label: 'Energy & Utilities' },
  { value: 'telecom',       label: 'Telecommunications' },
  { value: 'insurance',     label: 'Insurance' },
  { value: 'education',     label: 'Education & Research' },
  { value: 'transport',     label: 'Transportation & Logistics' },
  { value: 'media',         label: 'Media & Entertainment' },
  { value: 'professional',  label: 'Professional Services' },
  { value: 'defense',       label: 'Defense & Aerospace' },
  { value: 'other',         label: 'Other' },
]

const LOCAL_STEPS = [
  'Parsing MITRE ATT&CK mappings…',
  'Identifying tactics and techniques…',
  'Calculating coverage percentages…',
  'Detecting coverage gaps…',
  'Preparing AI analysis…',
]

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// Simple markdown → JSX renderer (headers, bold, bullets)
function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="text-sm font-semibold text-white mt-4 mb-1.5 first:mt-0">
          {line.slice(3)}
        </h3>
      )
    } else if (line.startsWith('# ')) {
      elements.push(
        <h2 key={i} className="text-base font-bold text-white mt-4 mb-2 first:mt-0">
          {line.slice(2)}
        </h2>
      )
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm text-slate-400 leading-relaxed">
          <span className="text-cyan-500 shrink-0 mt-0.5">•</span>
          <span dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} />
        </div>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
    } else {
      elements.push(
        <p key={i} className="text-sm text-slate-400 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
      )
    }
    i++
  }
  return <div className="space-y-0.5">{elements}</div>
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-200 font-semibold">$1</strong>')
    .replace(/`(.+?)`/g, '<code class="font-mono text-[11px] text-cyan-400 bg-cyan-500/10 px-1 rounded">$1</code>')
}

export default function UploadPanel() {
  const setView = useStore(s => s.setView)
  const uploadStep = useStore(s => s.uploadStep)
  const setUploadStep = useStore(s => s.setUploadStep)
  const setPendingFileInfo = useStore(s => s.setPendingFileInfo)
  const setPendingData = useStore(s => s.setPendingData)
  const applyAnalysis = useStore(s => s.applyAnalysis)
  const resetUpload = useStore(s => s.resetUpload)
  const setClientInfo = useStore(s => s.setClientInfo)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Client details
  const [clientName, setClientName]     = useState('')
  const [industryType, setIndustryType] = useState('')

  // Submit state
  const [submitResult, setSubmitResult] = useState<{
    coverage: CoverageDataset; useCases: UseCaseEntry[]; format: string; count: number
  } | null>(null)

  // Analysis state
  const [localProgress, setLocalProgress] = useState(0)
  const [localStep, setLocalStep] = useState('')
  const [localAnalysis, setLocalAnalysis] = useState<UseCaseAnalysis | null>(null)

  // Groq state
  const groqKey = useStore(s => s.apiKey)
  const [groqStatus, setGroqStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const [groqText, setGroqText] = useState('')
  const [groqError, setGroqError] = useState<string | null>(null)
  const groqTextRef = useRef('')

  const isIdle = uploadStep === 'idle'
  const isFileSelected = uploadStep === 'file-selected'
  const isSubmitting = uploadStep === 'submitting'
  const isReady = uploadStep === 'ready'
  const isAnalyzing = uploadStep === 'analyzing'
  const isDone = uploadStep === 'done'

  function selectFile(f: File) {
    setError(null)
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'json'].includes(ext ?? '')) {
      setError('Unsupported file type. Please upload .xlsx, .xls, or .json')
      return
    }
    setFile(f)
    setPendingFileInfo({ name: f.name, size: f.size, format: f.name.endsWith('.json') ? 'json' : 'usecases' })
    setUploadStep('file-selected')
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) selectFile(f)
  }

  async function handleSubmit() {
    if (!file) return
    if (!clientName.trim()) { setError('Please enter a client name before submitting.'); return }
    if (!industryType)      { setError('Please select an industry type before submitting.'); return }
    setUploadStep('submitting'); setError(null)
    try {
      let coverage: CoverageDataset
      let useCases: UseCaseEntry[] = []

      if (file.name.endsWith('.json')) {
        coverage = await parseJson(file)
      } else {
        const buf = await file.arrayBuffer()
        const XLSX = await import('xlsx')
        const wb = XLSX.read(buf, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        const cols = Object.keys(rows[0] ?? {})
        if (cols.includes('Use Case Name') || cols.includes('Log Source')) {
          const r = await parseUseCaseExcel(file); coverage = r.coverage; useCases = r.useCases
        } else {
          coverage = await parseExcel(file)
        }
      }

      if (coverage.entries.length === 0) {
        setError('No valid data found. Check that your file matches an expected format.')
        setUploadStep('file-selected'); return
      }

      const format = useCases.length > 0 ? 'Use Case Catalog' : 'Coverage Mapping'
      setPendingData({ coverage, useCases })
      setSubmitResult({ coverage, useCases, format, count: coverage.entries.length })
      setClientInfo(
        clientName.trim(),
        INDUSTRIES.find(i => i.value === industryType)?.label ?? industryType,
      )
      setUploadStep('ready')
    } catch (err) {
      setError(String(err)); setUploadStep('file-selected')
    }
  }

  async function handleAnalyze() {
    if (!submitResult) return
    setUploadStep('analyzing')
    setLocalProgress(0); setGroqText(''); setGroqError(null)
    groqTextRef.current = ''

    try {
      // Run local analysis steps
      const covMap = new Map(submitResult.coverage.entries.map(e => [e.techniqueId, e]))
      const analysis = analyzeUseCases(submitResult.useCases, covMap)
      setLocalAnalysis(analysis)

      for (let i = 0; i < LOCAL_STEPS.length; i++) {
        setLocalStep(LOCAL_STEPS[i])
        setLocalProgress(Math.round(((i + 1) / LOCAL_STEPS.length) * 100))
        await delay(300)
      }

      // Push coverage data to the dashboard (does NOT change uploadStep,
      // so the Analyzing panel stays visible during Groq streaming)
      applyAnalysis(analysis)

      // Start Groq streaming (if key provided) — Analyzing panel shows the preview
      if (groqKey.trim()) {
        setLocalStep('Generating AI security narrative…')
        setGroqStatus('streaming')
        await analyzeWithGroq(
          groqKey.trim(),
          submitResult.coverage,
          submitResult.useCases,
          analysis,
          {
            onToken: (token) => {
              groqTextRef.current += token
              setGroqText(t => t + token)
            },
            onDone: () => { setGroqStatus('done') },
            onError: (err) => {
              setGroqError(err)
              setGroqStatus('error')
            },
          },
        )
      }
    } catch (err) {
      setError(`Analysis failed: ${String(err)}`)
    } finally {
      // Always transition to Done — whether Groq succeeded, errored, or was skipped
      setUploadStep('done')
    }
  }

  function handleReset() {
    setFile(null); setSubmitResult(null); setLocalAnalysis(null)
    setLocalStep(''); setLocalProgress(0)
    setGroqText(''); setGroqError(null); setGroqStatus('idle')
    groqTextRef.current = ''; setError(null)
    setClientName(''); setIndustryType('')
    resetUpload()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
              <Upload className="w-4 h-4 text-cyan-400" />
            </div>
            <h1 className="text-xl font-semibold text-white">Data Upload & Analysis</h1>
          </div>
          <p className="text-sm text-slate-500 ml-11">
            Upload your MITRE ATT&CK use case catalog. The AI agent will map coverage, identify gaps, and generate recommendations.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {['Client Details', 'Select File', 'Submit', 'Analyze'].map((label, i) => {
            const done =
              i === 0 ? !!(clientName.trim() && industryType) :
              i === 1 ? !isIdle && !!(clientName.trim() && industryType) :
              i === 2 ? isReady || isAnalyzing || isDone :
              isDone
            const active =
              i === 0 ? (isIdle && !(clientName.trim() && industryType)) :
              i === 1 ? isFileSelected :
              false
            return (
              <div key={label} className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono transition-all"
                    style={{
                      background: done ? 'rgba(34,197,94,0.15)' : active ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${done ? 'rgba(34,197,94,0.4)' : active ? 'rgba(0,229,255,0.35)' : 'rgba(255,255,255,0.09)'}`,
                      color: done ? '#22c55e' : active ? '#00e5ff' : '#475569',
                    }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className="text-xs font-medium" style={{ color: done ? '#22c55e' : '#64748b' }}>{label}</span>
                </div>
                {i < 3 && <ChevronRight className="w-3.5 h-3.5 text-slate-700" />}
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-2 gap-6">

          {/* ── Left: File upload ── */}
          <div className="space-y-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">1 — Client Details</div>

            {/* Client details card */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
              {/* Client name */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  <User className="w-3 h-3 text-cyan-500" />
                  Client Name <span className="text-red-500 normal-case tracking-normal font-normal">*</span>
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  placeholder="e.g. Accenture, HDFC Bank, Infosys…"
                  disabled={isReady || isAnalyzing || isDone}
                  className="w-full h-9 rounded-lg pl-3 pr-3 text-sm text-slate-300 placeholder-slate-600 focus:outline-none transition-all disabled:opacity-40"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: clientName.trim()
                      ? '1px solid rgba(0,229,255,0.30)'
                      : '1px solid rgba(255,255,255,0.08)',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(0,229,255,0.45)' }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = clientName.trim()
                      ? 'rgba(0,229,255,0.30)'
                      : 'rgba(255,255,255,0.08)'
                  }}
                />
              </div>

              {/* Industry type */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  <Building2 className="w-3 h-3 text-indigo-400" />
                  Industry Type <span className="text-red-500 normal-case tracking-normal font-normal">*</span>
                </label>
                <div className="relative">
                  <select
                    value={industryType}
                    onChange={e => setIndustryType(e.target.value)}
                    disabled={isReady || isAnalyzing || isDone}
                    className="w-full h-9 rounded-lg pl-3 pr-8 text-sm focus:outline-none transition-all appearance-none disabled:opacity-40 cursor-pointer"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: industryType
                        ? '1px solid rgba(129,140,248,0.35)'
                        : '1px solid rgba(255,255,255,0.08)',
                      color: industryType ? '#e2e8f0' : '#475569',
                    }}
                  >
                    <option value="" disabled style={{ background: '#1e293b', color: '#64748b' }}>
                      Select industry…
                    </option>
                    {INDUSTRIES.map(ind => (
                      <option
                        key={ind.value}
                        value={ind.value}
                        style={{ background: '#1e293b', color: '#e2e8f0' }}
                      >
                        {ind.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                    style={{ color: industryType ? '#818cf8' : '#475569' }}
                  />
                </div>
              </div>

              {/* Completion indicator */}
              {clientName.trim() && industryType && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-[11px] text-green-400"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="font-medium">{clientName.trim()}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">{INDUSTRIES.find(i => i.value === industryType)?.label}</span>
                </motion.div>
              )}
            </div>

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">2 — Select File</div>

            {/* Drop zone */}
            <div
              className={`relative rounded-xl border-2 border-dashed transition-all ${
                isReady || isAnalyzing || isDone ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
              } ${dragging ? 'border-cyan-400 bg-cyan-500/[0.08]' : 'border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.02]'}`}
              style={{ padding: '32px 24px' }}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.json" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) selectFile(f) }} />
              <div className="text-center">
                <Upload className="w-8 h-8 mx-auto mb-3 text-slate-600" />
                <div className="text-sm font-medium text-slate-300 mb-1">
                  Drop file here or <span className="text-cyan-400">browse</span>
                </div>
                <div className="text-xs text-slate-600">Excel (.xlsx) or JSON</div>
              </div>
            </div>

            {/* File card */}
            <AnimatePresence>
              {file && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="flex items-start gap-3">
                    {file.name.endsWith('.json')
                      ? <FileJson className="w-8 h-8 text-purple-400 shrink-0" />
                      : <FileSpreadsheet className="w-8 h-8 text-green-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200 truncate">{file.name}</div>
                      <div className="text-xs text-slate-600 font-mono mt-0.5">{formatBytes(file.size)}</div>
                      <div className="mt-2">
                        {isSubmitting && (
                          <span className="flex items-center gap-1.5 text-[11px] text-cyan-400">
                            <div className="w-3 h-3 rounded-full border border-cyan-400 border-t-transparent animate-spin" />
                            Validating…
                          </span>
                        )}
                        {(isReady || isAnalyzing || isDone) && (
                          <span className="flex items-center gap-1.5 text-[11px] text-green-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Validated
                          </span>
                        )}
                      </div>
                    </div>
                    {!isSubmitting && !isReady && !isAnalyzing && !isDone && (
                      <button onClick={handleReset} className="text-slate-600 hover:text-slate-400 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-sm text-red-300">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!isFileSelected || isSubmitting}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: isFileSelected ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isFileSelected ? 'rgba(0,229,255,0.35)' : 'rgba(255,255,255,0.07)'}`,
                color: isFileSelected ? '#00e5ff' : '#475569',
              }}
            >
              {isSubmitting
                ? <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />Validating…</span>
                : 'Submit Data'}
            </button>

            {/* Format guide */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-slate-600 space-y-1.5">
              <div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] mb-2">Accepted Formats</div>
              <div><span className="text-slate-500">Use Case Catalog</span> — <span className="font-mono text-[10px] text-slate-700">Use Case Name, Log Source, Detection Category, Tactic ID, Technique ID…</span></div>
              <div><span className="text-slate-500">Coverage Map</span> — <span className="font-mono text-[10px] text-slate-700">Technique ID, Coverage (Full/Partial/None), Tool, Notes</span></div>
            </div>
          </div>

          {/* ── Right: Analysis ── */}
          <div className="space-y-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">2 — AI Analysis</div>

            {/* Placeholder */}
            {(isIdle || isFileSelected || isSubmitting) && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] h-52 flex items-center justify-center">
                <div className="text-center">
                  <Brain className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                  <div className="text-sm text-slate-600">Submit your data to run AI analysis</div>
                  {groqKey && <div className="text-[11px] text-indigo-500/70 mt-1">Groq LLM connected</div>}
                </div>
              </div>
            )}

            {/* Ready state */}
            <AnimatePresence>
              {isReady && submitResult && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-medium text-slate-200">{submitResult.format} detected</span>
                    </div>

                    {/* Client + industry summary row */}
                    <div className="px-4 py-2.5 border-b border-white/[0.05] flex items-center gap-3 bg-white/[0.01]">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 text-cyan-500" />
                        <span className="text-xs font-semibold text-slate-300">{clientName.trim()}</span>
                      </div>
                      <span className="text-slate-700">·</span>
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 text-indigo-400" />
                        <span className="text-xs text-slate-400">
                          {INDUSTRIES.find(i => i.value === industryType)?.label}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 divide-x divide-white/[0.06]">
                      {[
                        { label: 'Techniques', value: submitResult.count },
                        { label: 'Use Cases', value: submitResult.useCases.length || '—' },
                        { label: 'AI', value: groqKey ? 'ON' : 'OFF' },
                      ].map(s => (
                        <div key={s.label} className="px-4 py-3 text-center">
                          <div className="text-xl font-bold font-mono" style={{ color: s.label === 'AI' ? (groqKey ? '#818cf8' : '#475569') : '#00e5ff' }}>{s.value}</div>
                          <div className="text-[10px] text-slate-600 uppercase tracking-wider mt-1">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={handleAnalyze}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                    style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.35)', color: '#818cf8' }}>
                    <Sparkles className="w-4 h-4" />
                    {groqKey ? 'Analyze with AI' : 'Analyze Coverage'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Analyzing */}
            <AnimatePresence>
              {isAnalyzing && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05] p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-indigo-300">
                        {groqKey ? 'AI Agent Analyzing…' : 'Analyzing Coverage…'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{localStep}</div>
                    </div>
                    <span className="font-mono text-sm font-bold text-indigo-400">{localProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full"
                      style={{ background: 'linear-gradient(90deg,#818cf8,#00e5ff)' }}
                      animate={{ width: `${localProgress}%` }}
                      transition={{ duration: 0.3 }} />
                  </div>
                  {groqKey && groqText && (
                    <div className="mt-2 text-[11px] text-slate-500 font-mono leading-relaxed line-clamp-3">
                      {groqText.slice(-200)}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Done */}
            <AnimatePresence>
              {isDone && localAnalysis && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

                  {/* Quick stats */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Techniques Covered', value: localAnalysis.techniquesCovered, color: '#22c55e' },
                      { label: 'Tactics Active', value: `${localAnalysis.tacticsFullyCovered}/14`, color: '#00e5ff' },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-center">
                        <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                        <div className="text-[10px] text-slate-600 uppercase tracking-wider mt-1">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Category chips */}
                  {localAnalysis.categoryBreakdown.length > 0 && (
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                      <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-2">Detection Categories</div>
                      <div className="flex flex-wrap gap-1.5">
                        {localAnalysis.categoryBreakdown.map(({ category, count }) => (
                          <span key={category} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-slate-400">
                            {category} · {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Groq AI narrative */}
                  {(groqStatus === 'streaming' || groqStatus === 'done') && groqText && (
                    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-indigo-500/15 flex items-center gap-2">
                        <Brain className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-[11px] font-semibold text-indigo-300 uppercase tracking-wider">AI Security Analysis</span>
                        {groqStatus === 'streaming' && (
                          <div className="ml-auto w-3 h-3 rounded-full border border-indigo-400 border-t-transparent animate-spin" />
                        )}
                        {groqStatus === 'done' && (
                          <span className="ml-auto text-[10px] text-green-500 font-mono">Complete</span>
                        )}
                      </div>
                      <div className="px-4 py-4 max-h-72 overflow-y-auto">
                        <MarkdownBlock text={groqText} />
                        {groqStatus === 'streaming' && (
                          <span className="inline-block w-0.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Groq error */}
                  {groqStatus === 'error' && groqError && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-medium text-red-300">Groq API Error</div>
                        <div className="text-xs text-slate-500 mt-0.5">{groqError}</div>
                      </div>
                    </div>
                  )}

                  {/* Gap warning */}
                  {localAnalysis.topGaps.length > 0 && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3">
                      <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-1">Coverage Gaps</div>
                      <div className="text-xs text-slate-500">{localAnalysis.topGaps.join(' · ')}</div>
                    </div>
                  )}

                  {/* CTA */}
                  <button onClick={() => setView('globe')}
                    className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                    style={{ background: 'linear-gradient(135deg,rgba(0,229,255,0.1),rgba(129,140,248,0.1))', border: '1px solid rgba(0,229,255,0.3)', color: '#00e5ff' }}>
                    View Coverage Dashboard <ArrowRight className="w-4 h-4" />
                  </button>

                  <button onClick={handleReset}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors">
                    <RotateCcw className="w-3 h-3" /> Upload a different file
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
