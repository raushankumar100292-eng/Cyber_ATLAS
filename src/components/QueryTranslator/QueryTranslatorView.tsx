import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as XLSX from 'xlsx'
import {
  ArrowRightLeft, Wand2, Bot, Table2, Settings2, FileText,
  Copy, Download, Plus, Trash2, Edit3, Send, Layers,
  CheckCircle2, AlertTriangle, Loader2, ChevronDown,
  X, Check, RefreshCw, FileCode2,
  Shield, Zap, AlertCircle, Info, BookOpen, CornerDownRight,
  Upload, PlayCircle, StopCircle, FileSpreadsheet, ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '../../lib/store'
import {
  streamConversion, streamRuleGeneration, streamRuleMetadata,
  streamAssistantChat, streamIntDocGeneration,
  type ConversionDirection, type RuleLanguage, type RuleGenParams,
  type ChatMessage, type RuleMetadata, type IntDocParams,
  DIRECTION_META, LANG_LABELS,
} from '../../lib/splKqlGroq'

// ── Constants ─────────────────────────────────────────────────────────────────

const CUSTOM_RULES_KEY = 'atlas_qt_custom_rules'

type QueryTab = 'convert' | 'generate' | 'bulk' | 'intdoc' | 'assistant' | 'mappings' | 'custom'

interface CustomRule {
  id: string; name: string; description: string
  pattern: string; replacement: string; appliesTo: 'spl' | 'aql' | 'both'; category: string
}
interface SharedResult { code: string; language: RuleLanguage }

const DETECTION_CATEGORIES = [
  'Authentication', 'Network', 'Process', 'File', 'Registry',
  'DNS', 'Email', 'Web', 'Endpoint', 'Cloud', 'General',
]

const LOG_SOURCE_SUGGESTIONS = [
  'Windows Security Event Log', 'Sysmon', 'Microsoft Defender for Endpoint',
  'Azure AD Sign-in Logs', 'Azure Activity Log', 'Office 365 Unified Audit Log',
  'AWS CloudTrail', 'GCP Cloud Audit Logs', 'Kubernetes Audit Log',
  'Firewall / Palo Alto', 'Proxy / Squid / Zscaler', 'DNS Logs',
  'Email Gateway / Proofpoint', 'Linux Auditd / Syslog', 'EDR (CrowdStrike)',
]

const INTEGRATION_METHOD_SUGGESTIONS = [
  'Splunk HEC (HTTP Event Collector)', 'Logstash', 'Fluentd / Fluent Bit',
  'Kafka', 'Syslog (UDP/TCP)', 'REST API / Webhook', 'Azure Monitor Agent',
  'AWS Kinesis Firehose', 'Direct Database / JDBC', 'File / FTP / SFTP',
]

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseConversionOutput(raw: string) {
  const codeMatch = raw.match(/```[\w-]*\n?([\s\S]*?)```/)
  const code = codeMatch ? codeMatch[1].trim() : raw.split('CONFIDENCE:')[0].trim()
  const confMatch = raw.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i)
  const confidence = confMatch ? confMatch[1].toUpperCase() : 'MEDIUM'
  const reasonMatch = raw.match(/REASON:\s*(.+?)(?:\n|$)/i)
  const reason = reasonMatch ? reasonMatch[1].trim() : ''
  const warnSection = raw.match(/WARNINGS?:\s*([\s\S]*)$/i)
  const warnings: string[] = []
  if (warnSection) {
    for (const line of warnSection[1].split('\n')) {
      const t = line.replace(/^[-*•]\s*/, '').trim()
      if (t && t.toLowerCase() !== 'none') warnings.push(t)
    }
  }
  return { code, confidence, reason, warnings }
}

function parseAssistantOutput(raw: string) {
  const codeMatch = raw.match(/```[\w-]*\n?([\s\S]*?)```/)
  const updatedRule = codeMatch ? codeMatch[1].trim() : ''
  const changesMatch = raw.match(/##\s*Changes Made\s*([\s\S]*)$/i)
  const changes: string[] = []
  if (changesMatch) {
    for (const line of changesMatch[1].split('\n')) {
      const t = line.replace(/^[-*•]\s*/, '').trim()
      if (t) changes.push(t)
    }
  }
  return { updatedRule, changes }
}

function parseMetadataJson(raw: string): RuleMetadata | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    return JSON.parse(jsonMatch[0]) as RuleMetadata
  } catch { return null }
}

function extractCleanRule(raw: string) {
  const match = raw.match(/```[\w-]*\n?([\s\S]*?)```/)
  return match ? match[1].trim() : raw.trim()
}

// ── Field Mappings Data ───────────────────────────────────────────────────────

const FIELD_MAPPINGS = [
  { cat: 'Common',   splunk: '_time',               sentinel: 'TimeGenerated',           aql: 'deviceTime',          desc: 'Event timestamp' },
  { cat: 'Common',   splunk: 'host',                sentinel: 'Computer',                aql: 'deviceHostName',      desc: 'Source hostname' },
  { cat: 'Common',   splunk: 'sourcetype',          sentinel: 'SourceSystem',            aql: 'logSourceTypeName',   desc: 'Log source type' },
  { cat: 'Common',   splunk: 'index',               sentinel: 'Table name',              aql: 'logSourceId',         desc: 'Data store / table' },
  { cat: 'Network',  splunk: 'src_ip',              sentinel: 'SrcIpAddr / SourceIP',    aql: 'sourceAddress',       desc: 'Source IP address' },
  { cat: 'Network',  splunk: 'dest_ip',             sentinel: 'DstIpAddr / DestinationIP', aql: 'destinationAddress', desc: 'Destination IP address' },
  { cat: 'Network',  splunk: 'src_port',            sentinel: 'SrcPortNumber',           aql: 'sourcePort',          desc: 'Source port number' },
  { cat: 'Network',  splunk: 'dest_port',           sentinel: 'DstPortNumber',           aql: 'destinationPort',     desc: 'Destination port number' },
  { cat: 'Network',  splunk: 'protocol',            sentinel: 'NetworkProtocol',         aql: 'transportProtocol',   desc: 'Network protocol (TCP/UDP)' },
  { cat: 'Network',  splunk: 'bytes_in',            sentinel: 'ReceivedBytes',           aql: 'bytesReceived',       desc: 'Inbound byte count' },
  { cat: 'Network',  splunk: 'bytes_out',           sentinel: 'SentBytes',               aql: 'bytesSent',           desc: 'Outbound byte count' },
  { cat: 'Network',  splunk: 'packets_in',          sentinel: 'ReceivedPackets',         aql: 'packetsReceived',     desc: 'Inbound packet count' },
  { cat: 'Network',  splunk: 'packets_out',         sentinel: 'SentPackets',             aql: 'packetsSent',         desc: 'Outbound packet count' },
  { cat: 'Identity', splunk: 'user',                sentinel: 'AccountName / Account',   aql: 'userName',            desc: 'Initiating username' },
  { cat: 'Identity', splunk: 'src_user',            sentinel: 'SubjectUserName',         aql: 'userName',            desc: 'Source / subject user' },
  { cat: 'Identity', splunk: 'dest_user',           sentinel: 'TargetUserName',          aql: 'identityDescription', desc: 'Target / destination user' },
  { cat: 'Identity', splunk: 'domain',              sentinel: 'SubjectDomainName',       aql: 'networkDomainName',   desc: 'Windows domain name' },
  { cat: 'Identity', splunk: 'action',              sentinel: 'EventResult',             aql: 'categoryOutcome',     desc: 'Outcome: success / failure' },
  { cat: 'Identity', splunk: 'LogonType',           sentinel: 'LogonType',               aql: 'eventId',             desc: 'Windows logon type code' },
  { cat: 'Process',  splunk: 'process',             sentinel: 'CommandLine',             aql: 'commandText',         desc: 'Full process command line' },
  { cat: 'Process',  splunk: 'process_name',        sentinel: 'Process',                 aql: 'processName',         desc: 'Process executable name' },
  { cat: 'Process',  splunk: 'parent_process',      sentinel: 'ParentProcessName',       aql: 'parentProcessName',   desc: 'Parent process name' },
  { cat: 'Process',  splunk: 'pid',                 sentinel: 'ProcessId',               aql: 'pid',                 desc: 'Process ID' },
  { cat: 'Process',  splunk: 'parent_pid',          sentinel: 'InitiatingProcessId',     aql: 'parentProcessId',     desc: 'Parent process ID' },
  { cat: 'Process',  splunk: 'process_hash',        sentinel: 'SHA256 / MD5HashData',    aql: 'fileHash',            desc: 'Process file hash' },
  { cat: 'File',     splunk: 'file_path',           sentinel: 'FilePath',                aql: 'fileName',            desc: 'Absolute file path' },
  { cat: 'File',     splunk: 'file_name',           sentinel: 'FileName',                aql: 'fileName',            desc: 'File name (no path)' },
  { cat: 'File',     splunk: 'file_hash',           sentinel: 'FileHash / SHA256',       aql: 'fileHash',            desc: 'Cryptographic file hash' },
  { cat: 'File',     splunk: 'file_size',           sentinel: 'FileSize',                aql: 'fileSize',            desc: 'File size in bytes' },
  { cat: 'Web',      splunk: 'url',                 sentinel: 'RequestURL / Url',        aql: 'URL',                 desc: 'Full URL with query string' },
  { cat: 'Web',      splunk: 'uri_path',            sentinel: 'FilePath',                aql: 'requestURL',          desc: 'URI path component only' },
  { cat: 'Web',      splunk: 'http_method',         sentinel: 'RequestMethod',           aql: 'method',              desc: 'HTTP method (GET/POST…)' },
  { cat: 'Web',      splunk: 'http_status',         sentinel: 'EventResultDetails',      aql: 'responseCode',        desc: 'HTTP response status code' },
  { cat: 'Web',      splunk: 'user_agent',          sentinel: 'HttpUserAgent',           aql: 'userAgent',           desc: 'Browser / client user agent' },
  { cat: 'Web',      splunk: 'referrer',            sentinel: 'ReferUri',                aql: 'referrerURL',         desc: 'HTTP referrer URL' },
  { cat: 'DNS',      splunk: 'query',               sentinel: 'DnsQuery',                aql: 'domainName',          desc: 'DNS query name' },
  { cat: 'DNS',      splunk: 'answer',              sentinel: 'DnsResponseName',         aql: 'receiverAddress',     desc: 'DNS response value' },
  { cat: 'DNS',      splunk: 'record_type',         sentinel: 'DnsQueryType',            aql: 'recordType',          desc: 'DNS record type (A/AAAA/MX…)' },
  { cat: 'Registry', splunk: 'registry_key_name',   sentinel: 'RegistryKey',             aql: 'registryKey',         desc: 'Registry key full path' },
  { cat: 'Registry', splunk: 'registry_value_name', sentinel: 'RegistryValueName',       aql: 'registryValue',       desc: 'Registry value name' },
  { cat: 'Registry', splunk: 'registry_value_data', sentinel: 'RegistryValueData',       aql: 'registryValueData',   desc: 'Registry value data' },
  { cat: 'Windows',  splunk: 'EventCode',           sentinel: 'EventID',                 aql: 'eventId',             desc: 'Windows Security Event ID' },
  { cat: 'Windows',  splunk: 'Workstation_Name',    sentinel: 'WorkstationName',         aql: 'sourceHostName',      desc: 'Workstation name from event' },
  { cat: 'Email',    splunk: 'src_user (email)',    sentinel: 'SenderFromAddress',       aql: 'sourceEmail',         desc: 'Email sender address' },
  { cat: 'Email',    splunk: 'recipient',           sentinel: 'RecipientEmailAddress',   aql: 'destinationEmail',    desc: 'Email recipient address' },
  { cat: 'Email',    splunk: 'subject',             sentinel: 'Subject',                 aql: 'emailSubject',        desc: 'Email subject line' },
  { cat: 'Email',    splunk: 'message_id',          sentinel: 'InternetMessageId',       aql: 'emailMessageID',      desc: 'Email Message-ID header' },
]

// ── Shared helpers ────────────────────────────────────────────────────────────

function useCopyState() {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])
  return { copied, copy }
}

function ConfidenceBadge({ level }: { level: string }) {
  const cfg = {
    HIGH:   { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: <CheckCircle2 className="w-3 h-3" /> },
    MEDIUM: { bg: 'bg-amber-50 border-amber-200',    text: 'text-amber-700',   icon: <AlertTriangle className="w-3 h-3" /> },
    LOW:    { bg: 'bg-red-50 border-red-200',         text: 'text-red-700',     icon: <AlertCircle className="w-3 h-3" /> },
  }[level] ?? { bg: 'bg-slate-100 border-slate-200', text: 'text-slate-600', icon: <Info className="w-3 h-3" /> }
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border', cfg.bg, cfg.text)}>
      {cfg.icon} {level}
    </span>
  )
}

function SeverityBadge({ level }: { level: string }) {
  const cfg: Record<string, string> = {
    Critical: 'bg-red-50 border-red-200 text-red-700',
    High:     'bg-orange-50 border-orange-200 text-orange-700',
    Medium:   'bg-amber-50 border-amber-200 text-amber-700',
    Low:      'bg-blue-50 border-blue-200 text-blue-700',
    Informational: 'bg-slate-100 border-slate-200 text-slate-600',
  }
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border', cfg[level] ?? 'bg-slate-100 border-slate-200 text-slate-600')}>
      {level}
    </span>
  )
}

function NoKeyBanner() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
        <KeyRound className="w-5 h-5 text-amber-600" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800">Groq API Key Required</p>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">Enter your Groq API key in the header above. The key is shared with the ATLAS Upload module.</p>
      </div>
    </div>
  )
}

// ── Tag Input ─────────────────────────────────────────────────────────────────

function TagInput({ tags, onChange, placeholder, suggestions }: {
  tags: string[]
  onChange: (t: string[]) => void
  placeholder?: string
  suggestions?: string[]
}) {
  const [draft, setDraft] = useState('')
  const [showSugg, setShowSugg] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function addTag(val: string) {
    const t = val.trim().replace(/,+$/, '').trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (draft.trim()) addTag(draft) }
    else if (e.key === 'Backspace' && !draft && tags.length > 0) onChange(tags.slice(0, -1))
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val.includes(',')) {
      val.split(',').forEach((p, i, arr) => {
        if (i < arr.length - 1) { if (p.trim()) addTag(p) }
        else setDraft(p)
      })
    } else {
      setDraft(val)
      setShowSugg(val.length > 0)
    }
  }

  const filteredSugg = (suggestions ?? [])
    .filter(s => !tags.includes(s) && s.toLowerCase().includes(draft.toLowerCase()))
    .slice(0, 6)

  return (
    <div
      className="min-h-9 flex flex-wrap gap-1.5 items-center bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus-within:ring-2 focus-within:ring-cyan-500/20 focus-within:border-cyan-400 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-50 border border-cyan-200 text-cyan-800 text-xs font-medium">
          {tag}
          <button type="button" onClick={e => { e.stopPropagation(); onChange(tags.filter(t => t !== tag)) }}
            className="text-cyan-400 hover:text-cyan-700 transition-colors">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <div className="relative flex-1 min-w-[120px]">
        <input
          ref={inputRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (draft.trim()) addTag(draft); setTimeout(() => setShowSugg(false), 150) }}
          onFocus={() => setShowSugg(draft.length > 0)}
          placeholder={tags.length === 0 ? placeholder : 'Add more…'}
          className="w-full bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none py-0.5"
        />
        {showSugg && filteredSugg.length > 0 && (
          <div className="absolute z-20 left-0 top-full mt-1 w-64 panel-elevated rounded-lg border border-slate-200 overflow-hidden shadow-lg">
            {filteredSugg.map(s => (
              <button key={s} onMouseDown={() => { addTag(s); setShowSugg(false) }}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Markdown Doc Renderer (for Int Doc output) ────────────────────────────────

function MarkdownDoc({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  function renderInline(s: string) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono text-slate-800">$1</code>')
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-lg font-bold text-slate-900 mt-2 mb-1">{line.slice(2)}</h1>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-sm font-bold text-cyan-700 mt-5 mb-2 flex items-center gap-2">
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />{line.slice(3)}
      </h2>)
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} className="border-slate-200 my-3" />)
    } else if (line.startsWith('| ')) {
      // Collect table rows
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('| ')) { tableLines.push(lines[i]); i++ }
      const rows = tableLines.filter(l => !l.match(/^\|[-| ]+\|$/))
      elements.push(
        <div key={`tbl-${i}`} className="overflow-x-auto my-3">
          <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
            <tbody>
              {rows.map((row, ri) => {
                const cells = row.split('|').filter(c => c.trim() !== '')
                const isHeader = ri === 0
                return (
                  <tr key={ri} className={isHeader ? 'bg-slate-50 font-semibold text-slate-700' : 'border-t border-slate-100 text-slate-600 hover:bg-slate-50'}>
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2">{cell.trim()}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
      continue
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm text-slate-700 leading-relaxed ml-2">
          <span className="text-cyan-500 shrink-0 mt-1">•</span>
          <span dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} />
        </div>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
    } else {
      elements.push(
        <p key={i} className="text-sm text-slate-700 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
      )
    }
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}

// ── Convert Tab ───────────────────────────────────────────────────────────────

const DIRECTION_LIST: ConversionDirection[] = [
  'spl-to-kql', 'aql-to-kql', 'kql-to-spl', 'kql-to-aql', 'sigma-to-kql', 'sigma-to-spl',
]

function ConvertTab({ apiKey, customRules, onResult }: {
  apiKey: string
  customRules: CustomRule[]
  onResult: (r: SharedResult) => void
}) {
  const [direction, setDirection]   = useState<ConversionDirection>('spl-to-kql')
  const [input, setInput]           = useState('')
  const [rawOutput, setRawOutput]   = useState('')
  const [streaming, setStreaming]   = useState(false)
  const [error, setError]           = useState('')
  const [showWarnings, setShowWarnings] = useState(true)
  const { copied, copy } = useCopyState()
  const parsed = rawOutput ? parseConversionOutput(rawOutput) : null

  const customRulesText = customRules
    .filter(r => r.appliesTo === 'both' || DIRECTION_META[direction].sourceLang.startsWith(r.appliesTo))
    .map(r => `• ${r.name}: Translate "${r.pattern}" as "${r.replacement}" — ${r.description}`)
    .join('\n')

  async function handleConvert() {
    if (!input.trim()) return
    setStreaming(true); setRawOutput(''); setError('')
    let full = ''
    await streamConversion(apiKey, direction, input.trim(), customRulesText, {
      onToken: t => { full += t; setRawOutput(full) },
      onDone: f => {
        setStreaming(false)
        const p = parseConversionOutput(f)
        if (p.code) onResult({ code: p.code, language: DIRECTION_META[direction].targetLang as RuleLanguage })
      },
      onError: e => { setError(e); setStreaming(false) },
    })
  }

  function handleDownload() {
    if (!parsed?.code) return
    const ext = { kql: 'kql', spl: 'spl', aql: 'aql' }[DIRECTION_META[direction].targetLang] ?? 'txt'
    const blob = new Blob([parsed.code], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `converted.${ext}`; a.click()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-slate-200 bg-white">
        <p className="section-label mb-3">Conversion Direction</p>
        <div className="flex flex-wrap gap-2">
          {DIRECTION_LIST.map(dir => (
            <button key={dir} onClick={() => setDirection(dir)}
              className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                direction === dir ? 'bg-cyan-50 border-cyan-300 text-cyan-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}>
              {DIRECTION_META[dir].source} → {DIRECTION_META[dir].target}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex">
        {/* Input pane */}
        <div className="flex-1 flex flex-col border-r border-slate-200">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-600 font-mono">{DIRECTION_META[direction].source}</span>
            <button onClick={() => setInput('')} className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1"><X className="w-3 h-3" /> Clear</button>
          </div>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            placeholder={`Paste your ${DIRECTION_META[direction].source} query here…`}
            className="flex-1 font-mono text-xs text-slate-800 bg-white p-4 resize-none focus:outline-none placeholder-slate-400 leading-relaxed"
            spellCheck={false} />
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-slate-50">
            <span className="text-[11px] text-slate-400 font-mono">{input.length} chars · {input.split('\n').length} lines</span>
            {!apiKey ? <span className="text-[11px] text-amber-600">No API key set</span> : (
              <button onClick={handleConvert} disabled={streaming || !input.trim()} className="btn-primary text-xs py-1.5 disabled:opacity-40">
                {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                {streaming ? 'Translating…' : 'Convert'}
              </button>
            )}
          </div>
        </div>
        {/* Output pane */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 font-mono">{DIRECTION_META[direction].target}</span>
              {parsed?.confidence && <ConfidenceBadge level={parsed.confidence} />}
            </div>
            {parsed?.code && (
              <div className="flex items-center gap-1">
                <button onClick={() => copy(parsed.code)} className="btn-ghost py-0.5 px-2 text-[11px]">
                  {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied' : 'Copy'}
                </button>
                <button onClick={handleDownload} className="btn-ghost py-0.5 px-2 text-[11px]"><Download className="w-3 h-3" /> Save</button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
            {error && <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}</div>}
            {!apiKey ? <NoKeyBanner /> : (
              <pre className={clsx('font-mono text-xs text-slate-800 bg-slate-50 rounded-lg p-4 overflow-auto leading-relaxed border border-slate-200 whitespace-pre-wrap min-h-[180px] flex-1',
                streaming && 'border-cyan-200 bg-cyan-50/30')}>
                {streaming && !parsed?.code
                  ? <span className="text-slate-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin inline" /> Translating…</span>
                  : parsed?.code || <span className="text-slate-400 italic">Output will appear here…</span>}
                {streaming && parsed?.code && <span className="inline-block w-1 h-4 ml-0.5 bg-cyan-500 animate-pulse align-middle" />}
              </pre>
            )}
            {parsed?.reason && <p className="text-[11px] text-slate-500 italic">{parsed.reason}</p>}
            {parsed?.warnings && parsed.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
                <button onClick={() => setShowWarnings(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                  <AlertTriangle className="w-3.5 h-3.5" />{parsed.warnings.length} Warning{parsed.warnings.length > 1 ? 's' : ''}
                  <ChevronDown className={clsx('w-3 h-3 ml-auto transition-transform', showWarnings && 'rotate-180')} />
                </button>
                {showWarnings && <ul className="px-3 pb-3 space-y-1">
                  {parsed.warnings.map((w, i) => <li key={i} className="flex gap-2 text-xs text-amber-800"><CornerDownRight className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />{w}</li>)}
                </ul>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Rule Generator Tab ────────────────────────────────────────────────────────

function RuleGeneratorTab({ apiKey, onResult }: {
  apiKey: string
  onResult: (r: SharedResult) => void
}) {
  const [useCaseName, setUseCaseName]           = useState('')
  const [description, setDescription]           = useState('')
  const [logSourceTags, setLogSourceTags]       = useState<string[]>([])
  const [detectionCategory, setDetectionCategory] = useState('Authentication')
  const [language, setLanguage]                 = useState<RuleLanguage>('kql')
  const [ruleOutput, setRuleOutput]             = useState('')
  const [metaOutput, setMetaOutput]             = useState<RuleMetadata | null>(null)
  const [generatingRule, setGeneratingRule]     = useState(false)
  const [generatingMeta, setGeneratingMeta]     = useState(false)
  const [error, setError]                       = useState('')
  const [metaExpanded, setMetaExpanded]         = useState(true)
  const { copied, copy } = useCopyState()

  const displayRule = ruleOutput ? extractCleanRule(ruleOutput) : ''

  async function handleGenerate() {
    if (!useCaseName.trim()) return
    setGeneratingRule(true); setRuleOutput(''); setMetaOutput(null); setError('')
    const params: RuleGenParams = {
      useCaseName: useCaseName.trim(),
      description: description.trim(),
      logSource: logSourceTags.join(', '),
      detectionCategory,
      language,
    }
    let full = ''
    await streamRuleGeneration(apiKey, params, {
      onToken: t => { full += t; setRuleOutput(full) },
      onDone: async f => {
        setGeneratingRule(false)
        const cleanRule = extractCleanRule(f)
        onResult({ code: cleanRule, language })
        setGeneratingMeta(true)
        let metaFull = ''
        await streamRuleMetadata(apiKey, cleanRule, language, {
          onToken: t => { metaFull += t },
          onDone: mf => { setGeneratingMeta(false); const meta = parseMetadataJson(mf); if (meta) setMetaOutput(meta) },
          onError: () => setGeneratingMeta(false),
        })
      },
      onError: e => { setError(e); setGeneratingRule(false) },
    })
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left form */}
      <div className="w-80 shrink-0 flex flex-col border-r border-slate-200 overflow-y-auto">
        <div className="p-5 space-y-4">
          <div>
            <label className="section-label block mb-1.5">Use Case Name *</label>
            <input value={useCaseName} onChange={e => setUseCaseName(e.target.value)}
              placeholder="e.g. Suspicious PowerShell Execution"
              className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
          </div>
          <div>
            <label className="section-label block mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe the threat behaviour to detect…" rows={4}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
          </div>
          <div>
            <label className="section-label block mb-1.5">Log Source(s)</label>
            <TagInput
              tags={logSourceTags}
              onChange={setLogSourceTags}
              placeholder="Type and press , or Enter"
              suggestions={LOG_SOURCE_SUGGESTIONS}
            />
            <p className="text-[11px] text-slate-400 mt-1">Separate multiple sources with <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px]">,</kbd></p>
          </div>
          <div>
            <label className="section-label block mb-1.5">Detection Category</label>
            <select value={detectionCategory} onChange={e => setDetectionCategory(e.target.value)}
              className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400">
              {DETECTION_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="section-label block mb-1.5">Target Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value as RuleLanguage)}
              className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400">
              {(Object.keys(LANG_LABELS) as RuleLanguage[]).map(l => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
            </select>
          </div>
          {error && <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}</div>}
          {!apiKey ? <NoKeyBanner /> : (
            <button onClick={handleGenerate} disabled={generatingRule || !useCaseName.trim()}
              className="w-full btn-primary justify-center py-2.5 disabled:opacity-40">
              {generatingRule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {generatingRule ? 'Generating…' : 'Generate Rule'}
            </button>
          )}
        </div>
      </div>

      {/* Right output */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600 font-mono">{LANG_LABELS[language]}</span>
            {generatingRule && <span className="chip bg-cyan-50 border border-cyan-200 text-cyan-700">Generating…</span>}
            {generatingMeta && <span className="chip bg-violet-50 border border-violet-200 text-violet-700">Building metadata…</span>}
          </div>
          {displayRule && (
            <button onClick={() => copy(displayRule)} className="btn-ghost py-0.5 px-2 text-[11px]">
              {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">
          <pre className={clsx('font-mono text-xs text-slate-800 bg-slate-50 rounded-lg p-4 leading-relaxed border border-slate-200 whitespace-pre-wrap min-h-[160px] transition-colors',
            generatingRule && 'border-cyan-200 bg-cyan-50/20')}>
            {generatingRule && !displayRule ? <span className="text-slate-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin inline" /> Generating…</span>
              : displayRule || <span className="text-slate-400 italic">Generated rule will appear here…</span>}
            {generatingRule && displayRule && <span className="inline-block w-1 h-4 ml-0.5 bg-cyan-500 animate-pulse align-middle" />}
          </pre>

          {(metaOutput || generatingMeta) && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={() => setMetaExpanded(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 border-b border-slate-200">
                <Shield className="w-3.5 h-3.5 text-cyan-600" /> Detection Metadata
                {generatingMeta && <Loader2 className="w-3 h-3 animate-spin ml-1 text-violet-500" />}
                <ChevronDown className={clsx('w-3.5 h-3.5 ml-auto text-slate-400 transition-transform', metaExpanded && 'rotate-180')} />
              </button>
              {metaExpanded && metaOutput && (
                <div className="p-4 grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="section-label">MITRE ATT&CK</p>
                    <p className="text-xs font-mono text-cyan-700 font-semibold">{metaOutput.mitreId}</p>
                    <p className="text-xs text-slate-600">{metaOutput.mitreTactic}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="section-label">Severity / Priority</p>
                    <div className="flex items-center gap-2"><SeverityBadge level={metaOutput.severity} /><span className="chip bg-slate-100 border border-slate-200 text-slate-600">{metaOutput.priority}</span></div>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <p className="section-label">False Positives</p>
                    <ul className="space-y-0.5">{metaOutput.falsePositives.map((fp, i) => <li key={i} className="text-xs text-slate-600 flex gap-2"><span className="text-slate-400 shrink-0">•</span>{fp}</li>)}</ul>
                  </div>
                  <div className="space-y-1">
                    <p className="section-label">Investigation Steps</p>
                    <ol className="space-y-0.5">{metaOutput.investigationSteps.map((s, i) => <li key={i} className="text-xs text-slate-600 flex gap-2"><span className="text-cyan-600 shrink-0 font-mono">{i + 1}.</span>{s}</li>)}</ol>
                  </div>
                  <div className="space-y-1">
                    <p className="section-label">Response Actions</p>
                    <ol className="space-y-0.5">{metaOutput.responseActions.map((a, i) => <li key={i} className="text-xs text-slate-600 flex gap-2"><Zap className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />{a}</li>)}</ol>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Bulk Rule Generator Tab ───────────────────────────────────────────────────

type ColumnRole = 'useCaseName' | 'logSource' | 'description'
               | 'category' | 'mitreTactic' | 'mitreTacticId' | 'mitreTechnique' | 'mitreTechniqueId'
               | 'extra' | 'ignore'
type BulkStep   = 'input' | 'map' | 'generate'

interface BulkRow {
  id: string
  useCaseName: string
  logSource: string
  description: string
  category: string
  mitreTactic: string
  mitreTacticId: string
  mitreTechnique: string
  mitreTechniqueId: string
  extraFields: Record<string, string>
  status: 'pending' | 'running' | 'done' | 'failed'
  generatedRule: string
  error: string
  duration: number
}

interface ParsedSheet {
  headers: string[]
  rows: string[][]
}

const ROLE_META: Record<ColumnRole, { label: string; color: string; group?: string }> = {
  useCaseName:      { label: 'Use Case Name',    color: 'text-cyan-700 bg-cyan-50 border-cyan-200',         group: 'core'  },
  logSource:        { label: 'Log Source',        color: 'text-violet-700 bg-violet-50 border-violet-200',   group: 'core'  },
  description:      { label: 'Description',       color: 'text-emerald-700 bg-emerald-50 border-emerald-200',group: 'core'  },
  category:         { label: 'Category',          color: 'text-sky-700 bg-sky-50 border-sky-200',            group: 'mitre' },
  mitreTactic:      { label: 'MITRE Tactic',      color: 'text-rose-700 bg-rose-50 border-rose-200',         group: 'mitre' },
  mitreTacticId:    { label: 'MITRE Tactic ID',   color: 'text-rose-600 bg-rose-50 border-rose-200',         group: 'mitre' },
  mitreTechnique:   { label: 'MITRE Technique',   color: 'text-orange-700 bg-orange-50 border-orange-200',   group: 'mitre' },
  mitreTechniqueId: { label: 'MITRE Technique ID',color: 'text-orange-600 bg-orange-50 border-orange-200',   group: 'mitre' },
  extra:            { label: 'Extra Context',      color: 'text-amber-700 bg-amber-50 border-amber-200',      group: 'other' },
  ignore:           { label: '— Ignore —',         color: 'text-slate-400 bg-white border-slate-200',         group: 'other' },
}

const COLUMN_SYNONYMS_NEW: Record<ColumnRole, string[]> = {
  useCaseName:      ['use case name', 'usecase', 'use_case', 'name', 'use case', 'title', 'rule name', 'rulename'],
  logSource:        ['log source', 'log source / table', 'log_source', 'logsource', 'table', 'source', 'data source'],
  description:      ['description', 'desc', 'details', 'detail', 'scenario', 'threat description'],
  category:         ['category', 'detection category', 'log category', 'type'],
  mitreTactic:      ['mitre_tactic', 'mitre tactic', 'tactic', 'tactic name', 'attack tactic'],
  mitreTacticId:    ['mitre_tactic_id', 'tactic id', 'tactic_id', 'tacticid'],
  mitreTechnique:   ['mitre_technique', 'mitre technique', 'technique', 'technique name', 'attack technique'],
  mitreTechniqueId: ['mitre_technique_id', 'technique id', 'technique_id', 'techniqueid', 'mitre id', 'mitre_id'],
  extra:            [],
  ignore:           [],
}

// roles shown in Required Column Settings (not extra/ignore)
const REQUIRED_ELIGIBLE: ColumnRole[] = [
  'useCaseName', 'logSource', 'description',
  'category', 'mitreTactic', 'mitreTacticId', 'mitreTechnique', 'mitreTechniqueId',
]

function autoDetectRole(header: string): ColumnRole {
  const h = header.toLowerCase().trim()
  for (const role of (Object.keys(COLUMN_SYNONYMS_NEW) as ColumnRole[])) {
    if (role === 'extra' || role === 'ignore') continue
    if (COLUMN_SYNONYMS_NEW[role].includes(h)) return role
  }
  return 'extra'
}

function parseTextToSheet(text: string): ParsedSheet | null {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return null
  const sep = lines[0].includes('\t') ? '\t' : ','
  const splitLine = (line: string) =>
    line.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''))
  return { headers: splitLine(lines[0]), rows: lines.slice(1).map(splitLine) }
}

// ── Column Mapper step ────────────────────────────────────────────────────────
function ColumnMapper({ sheet, onConfirm, onBack }: {
  sheet: ParsedSheet
  onConfirm: (mapping: Record<number, ColumnRole>, required: Set<ColumnRole>) => void
  onBack: () => void
}) {
  const [mapping, setMapping] = useState<Record<number, ColumnRole>>(() => {
    const m: Record<number, ColumnRole> = {}
    sheet.headers.forEach((h, i) => { m[i] = autoDetectRole(h) })
    return m
  })
  const [required, setRequired] = useState<Set<ColumnRole>>(new Set(['useCaseName']))

  const previewRows  = sheet.rows.slice(0, 3)
  const useCaseEntry = Object.entries(mapping).find(([, r]) => r === 'useCaseName')
  const canConfirm   = useCaseEntry !== undefined
  const validRows    = sheet.rows.filter(row => useCaseEntry ? row[+useCaseEntry[0]]?.trim() : false).length
  const assignedRoles = new Set(Object.values(mapping))

  function toggleRequired(role: ColumnRole) {
    if (role === 'useCaseName') return
    setRequired(prev => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role); else next.add(role)
      return next
    })
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost py-1.5 px-2 text-xs">← Back</button>
          <div>
            <p className="text-sm font-bold text-slate-800">Map Columns</p>
            <p className="text-xs text-slate-500">{sheet.headers.length} columns · {sheet.rows.length} rows · {validRows} valid</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Column assignment */}
          <div className="panel rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <Table2 className="w-3.5 h-3.5 text-slate-500" />
              <p className="text-xs font-semibold text-slate-700">Assign Column Roles</p>
              <span className="ml-auto text-[11px] text-slate-400">One column per role</span>
            </div>
            <div className="divide-y divide-slate-100">
              {sheet.headers.map((header, idx) => {
                const role = mapping[idx]
                return (
                  <div key={idx} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-[11px] font-mono text-slate-400 w-5 shrink-0">{String.fromCharCode(65 + idx)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">{header}</p>
                      {previewRows[0]?.[idx] && (
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{previewRows[0][idx]}</p>
                      )}
                    </div>
                    <select value={role} onChange={e => setMapping(m => ({ ...m, [idx]: e.target.value as ColumnRole }))}
                      className={clsx('h-7 text-[11px] font-medium border rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 cursor-pointer', ROLE_META[role].color)}>
                      {(Object.keys(ROLE_META) as ColumnRole[]).map(r => (
                        <option key={r} value={r}>{ROLE_META[r].label}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Required config + summary */}
          <div className="space-y-4">
            <div className="panel rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5 text-slate-500" />
                <p className="text-xs font-semibold text-slate-700">Required Column Settings</p>
              </div>
              <div className="p-4 space-y-2.5">
                <p className="text-[11px] text-slate-500">Rows missing a required column are skipped during generation.</p>
                {REQUIRED_ELIGIBLE
                  .filter(r => assignedRoles.has(r))
                  .map(role => {
                    const isReq    = required.has(role)
                    const isAlways = role === 'useCaseName'
                    return (
                      <label key={role} className={clsx('flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors',
                        isReq ? 'bg-cyan-50 border-cyan-200' : 'bg-white border-slate-200 hover:bg-slate-50',
                        isAlways && 'cursor-default')}>
                        <div className={clsx('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                          isReq ? 'bg-cyan-500 border-cyan-500' : 'border-slate-300 bg-white')}>
                          {isReq && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <input type="checkbox" checked={isReq} onChange={() => toggleRequired(role)} className="sr-only" disabled={isAlways} />
                        <div>
                          <p className="text-xs font-medium text-slate-800">{ROLE_META[role].label}</p>
                          {isAlways && <p className="text-[11px] text-slate-400">Always required</p>}
                        </div>
                        <span className={clsx('ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded border', ROLE_META[role].color)}>
                          {ROLE_META[role].label.split(' ')[0]}
                        </span>
                      </label>
                    )
                  })}
              </div>
            </div>

            <div className="panel rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-700">Mapping Summary</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(ROLE_META) as ColumnRole[]).filter(r => r !== 'ignore').map(role => {
                  const cols = Object.entries(mapping).filter(([, r]) => r === role).map(([i]) => sheet.headers[+i])
                  if (!cols.length) return null
                  return (
                    <div key={role} className={clsx('px-2.5 py-2 rounded-lg border text-[11px]', ROLE_META[role].color)}>
                      <p className="font-semibold">{ROLE_META[role].label}</p>
                      <p className="opacity-70 truncate">{cols.join(', ')}</p>
                    </div>
                  )
                })}
              </div>
              {!canConfirm && (
                <div className="flex gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Assign at least one column as <strong>Use Case Name</strong> to continue.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Preview table */}
        {previewRows.length > 0 && (
          <div className="panel rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <p className="text-xs font-semibold text-slate-700">Data Preview <span className="text-slate-400 font-normal">(first {previewRows.length} rows)</span></p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    {sheet.headers.map((h, i) => (
                      <th key={i} className="text-left px-3 py-2 font-medium text-slate-500 whitespace-nowrap">
                        {h}
                        <span className={clsx('ml-1.5 px-1 py-0.5 rounded border text-[10px] font-semibold', ROLE_META[mapping[i]].color)}>
                          {mapping[i] === 'ignore' ? '—' : ROLE_META[mapping[i]].label.split(' ')[0]}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className={clsx('border-b border-slate-100', ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50')}>
                      {sheet.headers.map((_, ci) => (
                        <td key={ci} className={clsx('px-3 py-2 max-w-[180px] truncate',
                          mapping[ci] === 'ignore' ? 'text-slate-300' : 'text-slate-700')}>
                          {row[ci] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pb-4">
          <button onClick={onBack} className="btn-ghost px-4">Back</button>
          <button onClick={() => onConfirm(mapping, required)} disabled={!canConfirm}
            className="btn-primary px-6 disabled:opacity-40">
            <Check className="w-3.5 h-3.5" /> Confirm &amp; Load {validRows} Row{validRows !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Map-Reduce worker pool ────────────────────────────────────────────────────
// Map phase: each task is a BulkRow → generated rule
// Reduce phase: results are merged back into rows state as they complete
// Distribution: N concurrent workers pull from a shared queue (closure over index)
async function runMapReducePool(
  tasks: BulkRow[],
  concurrency: number,
  abortRef: React.MutableRefObject<boolean>,
  processTask: (row: BulkRow) => Promise<void>,
): Promise<void> {
  let cursor = 0
  async function worker() {
    while (cursor < tasks.length) {
      if (abortRef.current) break
      const idx = cursor++                   // atomic-style index claim
      if (idx >= tasks.length) break
      await processTask(tasks[idx])
    }
  }
  // Spawn `concurrency` workers — this is the map step
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
}

// ── Main Bulk Generator component ─────────────────────────────────────────────
function BulkGeneratorTab({ apiKey }: { apiKey: string }) {
  const [step, setStep]               = useState<BulkStep>('input')
  const [sheet, setSheet]             = useState<ParsedSheet | null>(null)
  const [rows, setRows]               = useState<BulkRow[]>([])
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [language, setLanguage]       = useState<RuleLanguage>('kql')
  const [concurrency, setConcurrency] = useState(3)
  const [running, setRunning]         = useState(false)
  const [activeWorkers, setActiveWorkers] = useState(0)
  const [pasteText, setPasteText]     = useState('')
  const [parseError, setParseError]   = useState('')
  const [viewRule, setViewRule]       = useState<BulkRow | null>(null)
  const [exportOpen, setExportOpen]   = useState(false)
  const abortRef     = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedRows = rows.filter(r => selected.has(r.id))
  const doneCount    = selectedRows.filter(r => r.status === 'done').length
  const failedCount  = selectedRows.filter(r => r.status === 'failed').length
  const pendingCount = selectedRows.filter(r => r.status === 'pending' || r.status === 'running').length
  const totalDone    = rows.filter(r => r.status === 'done').length
  const progressPct  = selectedRows.length > 0
    ? Math.round(((doneCount + failedCount) / selectedRows.length) * 100) : 0
  const allSelected  = rows.length > 0 && selected.size === rows.length
  const someSelected = selected.size > 0 && !allSelected

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(rows.map(r => r.id)))
  }
  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function loadSheet(s: ParsedSheet) { setSheet(s); setStep('map'); setParseError('') }

  function handlePasteParse() {
    setParseError('')
    const s = parseTextToSheet(pasteText)
    if (!s) { setParseError('Need at least a header row and one data row'); return }
    loadSheet(s)
    setPasteText('')
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    const isCSV = /\.(csv|tsv|txt)$/i.test(file.name)
    if (isCSV) {
      const reader = new FileReader()
      reader.onload = ev => {
        const s = parseTextToSheet(ev.target?.result as string)
        if (!s) { setParseError('CSV appears empty or malformed'); return }
        loadSheet(s)
      }
      reader.onerror = () => setParseError('Failed to read file')
      reader.readAsText(file)
    } else {
      const reader = new FileReader()
      reader.onload = ev => {
        try {
          const data = ev.target?.result as ArrayBuffer
          const wb   = XLSX.read(new Uint8Array(data), { type: 'array' })
          const ws   = wb.Sheets[wb.SheetNames[0]]
          const raw  = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]
          if (raw.length < 2) { setParseError('File appears empty'); return }
          loadSheet({
            headers: raw[0].map(h => String(h ?? '')),
            rows:    raw.slice(1).map(row => (row as unknown[]).map(c => String(c ?? ''))),
          })
        } catch (err) { setParseError(`Failed to parse Excel: ${String(err)}`) }
      }
      reader.onerror = () => setParseError('Failed to read file')
      reader.readAsArrayBuffer(file)
    }
    e.target.value = ''
  }

  function handleConfirmMapping(mapping: Record<number, ColumnRole>, required: Set<ColumnRole>) {
    if (!sheet) return

    // index lookup helper
    function colIdx(role: ColumnRole) {
      return Object.entries(mapping).find(([, r]) => r === role)?.[0]
    }

    const ucIdx   = colIdx('useCaseName')
    const lsIdx   = colIdx('logSource')
    const dIdx    = colIdx('description')
    const catIdx  = colIdx('category')
    const mtIdx   = colIdx('mitreTactic')
    const mtIdIdx = colIdx('mitreTacticId')
    const mteIdx  = colIdx('mitreTechnique')
    const mteIdIdx= colIdx('mitreTechniqueId')
    const exIdxs  = Object.entries(mapping).filter(([, r]) => r === 'extra').map(([i]) => +i)

    const pick = (idx: string | undefined, row: string[]) =>
      idx !== undefined ? (row[+idx] ?? '').trim() : ''

    const built: BulkRow[] = []
    sheet.rows.forEach(row => {
      const ucName = pick(ucIdx, row)
      if (!ucName) return
      // required-field checks
      for (const role of required) {
        if (role === 'useCaseName') continue
        const idx = colIdx(role)
        if (idx !== undefined && !row[+idx]?.trim()) return
      }

      const extraFields: Record<string, string> = {}
      exIdxs.forEach(i => { const hdr = sheet.headers[i]; if (hdr && row[i]?.trim()) extraFields[hdr] = row[i] })

      built.push({
        id: Math.random().toString(36).slice(2),
        useCaseName:      ucName,
        logSource:        pick(lsIdx, row),
        description:      pick(dIdx, row),
        category:         pick(catIdx, row),
        mitreTactic:      pick(mtIdx, row),
        mitreTacticId:    pick(mtIdIdx, row),
        mitreTechnique:   pick(mteIdx, row),
        mitreTechniqueId: pick(mteIdIdx, row),
        extraFields,
        status: 'pending', generatedRule: '', error: '', duration: 0,
      })
    })

    setRows(built)
    setSelected(new Set(built.map(r => r.id)))  // auto-select all by default
    setStep('generate')
  }

  function updateRow(id: string, patch: Partial<BulkRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function handleGenerate() {
    if (!selected.size || running) return
    abortRef.current = false
    setRunning(true)
    setActiveWorkers(0)

    // ── MAP phase: snapshot selected tasks, reset their status ────────────────
    const tasks = rows.filter(r => selected.has(r.id))
    setRows(prev => prev.map(r =>
      selected.has(r.id) ? { ...r, status: 'pending', generatedRule: '', error: '', duration: 0 } : r
    ))

    // ── Worker: processes one row end-to-end ──────────────────────────────────
    async function processTask(row: BulkRow) {
      setActiveWorkers(n => n + 1)
      updateRow(row.id, { status: 'running' })
      const start = Date.now()

      // Build enriched prompt context
      const mitreParts = [
        row.mitreTacticId    && `Tactic: ${row.mitreTactic || ''} (${row.mitreTacticId})`,
        row.mitreTechniqueId && `Technique: ${row.mitreTechnique || ''} (${row.mitreTechniqueId})`,
        !row.mitreTacticId   && row.mitreTactic    && `Tactic: ${row.mitreTactic}`,
        !row.mitreTechniqueId && row.mitreTechnique && `Technique: ${row.mitreTechnique}`,
      ].filter(Boolean).join('; ')
      const extraCtx     = Object.entries(row.extraFields).map(([k, v]) => `${k}: ${v}`).join('; ')
      const contextLines = [mitreParts, extraCtx].filter(Boolean).join('\n')
      const fullDesc     = [row.description, contextLines && `Additional context: ${contextLines}`].filter(Boolean).join('\n\n')

      try {
        // ── REDUCE phase: stream result and merge into shared state ──────────
        const rule = await new Promise<string>((resolve, reject) => {
          let full = ''
          streamRuleGeneration(apiKey, {
            useCaseName: row.useCaseName,
            description: fullDesc,
            logSource: row.logSource,
            detectionCategory: row.category || 'General',
            language,
          }, {
            onToken: t => { full += t },
            onDone:  f => resolve(extractCleanRule(f)),
            onError: e => reject(new Error(e)),
          })
        })
        updateRow(row.id, { status: 'done',   generatedRule: rule,      duration: (Date.now() - start) / 1000 })
      } catch (err) {
        updateRow(row.id, { status: 'failed', error: String(err),       duration: (Date.now() - start) / 1000 })
      } finally {
        setActiveWorkers(n => Math.max(0, n - 1))
      }
    }

    // ── Distribute tasks across `concurrency` workers ─────────────────────────
    await runMapReducePool(tasks, concurrency, abortRef, processTask)
    setRunning(false)
    setActiveWorkers(0)
  }

  function handleStop()  { abortRef.current = true }
  function handleReset() {
    setStep('input'); setSheet(null); setRows([])
    setSelected(new Set()); setRunning(false); setActiveWorkers(0); abortRef.current = true
  }

  function doneRows() { return rows.filter(r => r.status === 'done') }

  function exportCSV() {
    const done = doneRows()
    const extraHdrs = [...new Set(done.flatMap(r => Object.keys(r.extraFields)))]
    const fixedCols = ['Use Case Name','Log Source','Description','Category',
      'MITRE Tactic','MITRE Tactic ID','MITRE Technique','MITRE Technique ID']
    const header = [...fixedCols, ...extraHdrs, 'Language','Generated Rule','Duration (s)']
      .map(h => `"${h}"`).join(',') + '\n'
    const body = done.map(r =>
      [r.useCaseName, r.logSource, r.description, r.category,
        r.mitreTactic, r.mitreTacticId, r.mitreTechnique, r.mitreTechniqueId,
        ...extraHdrs.map(h => r.extraFields[h] ?? ''),
        language, r.generatedRule.replace(/\n/g,'\\n'), r.duration.toFixed(1)]
        .map(v => `"${String(v).replace(/"/g,'""')}"`)
        .join(',')
    ).join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bulk_rules.csv'; a.click()
  }

  function exportJSON() {
    const done = doneRows().map(r => ({
      use_case_name: r.useCaseName, log_source: r.logSource, description: r.description,
      category: r.category,
      mitre_tactic: r.mitreTactic, mitre_tactic_id: r.mitreTacticId,
      mitre_technique: r.mitreTechnique, mitre_technique_id: r.mitreTechniqueId,
      extra_fields: r.extraFields, language, generated_rule: r.generatedRule, duration_sec: r.duration,
    }))
    const blob = new Blob([JSON.stringify(done, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bulk_rules.json'; a.click()
  }

  function exportTXT() {
    const txt = doneRows().map((r, i) => {
      const meta = [
        r.logSource         && `Log Source : ${r.logSource}`,
        r.category          && `Category   : ${r.category}`,
        r.mitreTacticId     && `Tactic     : ${r.mitreTactic} (${r.mitreTacticId})`,
        !r.mitreTacticId  && r.mitreTactic    && `Tactic     : ${r.mitreTactic}`,
        r.mitreTechniqueId  && `Technique  : ${r.mitreTechnique} (${r.mitreTechniqueId})`,
        !r.mitreTechniqueId && r.mitreTechnique && `Technique  : ${r.mitreTechnique}`,
        `Language   : ${LANG_LABELS[language]}`,
      ].filter(Boolean).join('\n')
      return `${'='.repeat(70)}\nRULE ${i+1}: ${r.useCaseName}\n${meta}\n${'='.repeat(70)}\n${r.generatedRule}\n`
    }).join('\n')
    const blob = new Blob([txt], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bulk_rules.txt'; a.click()
  }

  function exportXLSX() {
    const done = doneRows()
    const extraHdrs = [...new Set(done.flatMap(r => Object.keys(r.extraFields)))]
    const headers = ['Use Case Name','Log Source','Description','Category',
      'MITRE Tactic','MITRE Tactic ID','MITRE Technique','MITRE Technique ID',
      ...extraHdrs, 'Language','Generated Rule','Duration (s)']
    const dataRows = done.map(r => [
      r.useCaseName, r.logSource, r.description, r.category,
      r.mitreTactic, r.mitreTacticId, r.mitreTechnique, r.mitreTechniqueId,
      ...extraHdrs.map(h => r.extraFields[h] ?? ''),
      language, r.generatedRule, r.duration.toFixed(1),
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
    // Style header row bold + freeze top row
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    // Auto column widths
    ws['!cols'] = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...dataRows.map(row => String(row[i] ?? '').length))
      return { wch: Math.min(Math.max(maxLen + 2, 10), 60) }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Bulk Rules')
    XLSX.writeFile(wb, 'bulk_rules.xlsx')
  }

  const statusBadge = (s: BulkRow['status']) => ({
    pending: 'bg-slate-100 border-slate-200 text-slate-500',
    running: 'bg-blue-50 border-blue-200 text-blue-700',
    done:    'bg-emerald-50 border-emerald-200 text-emerald-700',
    failed:  'bg-red-50 border-red-200 text-red-700',
  }[s])

  const STEPS = [
    { id: 'input',    label: '1 · Input Data'     },
    { id: 'map',      label: '2 · Map Columns'    },
    { id: 'generate', label: '3 · Generate Rules' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className="px-6 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center gap-4 shrink-0">
        {/* Step breadcrumb */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
              <span className={clsx('text-xs font-medium px-2.5 py-1 rounded-full',
                step === s.id ? 'bg-cyan-100 text-cyan-700 border border-cyan-200' : 'text-slate-400')}>
                {s.label}
              </span>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* Controls on generate step */}
        {step === 'generate' && (
          <div className="flex items-center gap-2 flex-wrap">
            <select value={language} onChange={e => setLanguage(e.target.value as RuleLanguage)}
              className="h-8 bg-white border border-slate-200 rounded-lg px-2 text-xs text-slate-800 focus:outline-none">
              {(Object.keys(LANG_LABELS) as RuleLanguage[]).map(l => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
            </select>

            {/* Concurrency selector */}
            <div className="flex items-center gap-1.5 h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-[10px] text-slate-500 font-medium">Workers</span>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => !running && setConcurrency(n)} disabled={running}
                    className={clsx('w-5 h-5 rounded text-[10px] font-bold transition-colors',
                      concurrency === n
                        ? 'bg-cyan-500 text-white'
                        : 'bg-white border border-slate-200 text-slate-500 hover:border-cyan-300 hover:text-cyan-600',
                      running && 'opacity-50 cursor-not-allowed')}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Export dropdown */}
            {totalDone > 0 && (
              <div className="relative">
                <button onClick={() => setExportOpen(o => !o)}
                  className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Export <ChevronDown className="w-3 h-3" />
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-40 panel-elevated rounded-xl border border-slate-200 shadow-lg overflow-hidden">
                      {[
                        { label: 'Excel (.xlsx)', fn: exportXLSX, icon: '📊' },
                        { label: 'CSV',           fn: exportCSV,  icon: '📄' },
                        { label: 'JSON',          fn: exportJSON, icon: '{ }' },
                        { label: 'Text (.txt)',   fn: exportTXT,  icon: '📝' },
                      ].map(opt => (
                        <button key={opt.label} onClick={() => { opt.fn(); setExportOpen(false) }}
                          className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                          <span className="text-sm">{opt.icon}</span> {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {!running ? (
              <button onClick={handleGenerate} disabled={!apiKey || !selected.size} className="btn-primary text-xs py-1.5 px-4 disabled:opacity-40">
                <PlayCircle className="w-3.5 h-3.5" />
                {selected.size === rows.length
                  ? `Generate All (${rows.length})`
                  : `Generate Selected (${selected.size})`}
              </button>
            ) : (
              <button onClick={handleStop} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium hover:bg-red-100">
                <StopCircle className="w-3.5 h-3.5" /> Stop
              </button>
            )}
            <button onClick={handleReset} className="btn-ghost text-xs py-1.5 px-3"><RefreshCw className="w-3 h-3" /> Reset</button>
          </div>
        )}

        {/* File upload on input/map steps */}
        {step !== 'generate' && (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="btn-ghost text-xs py-1.5 px-3">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Upload File
            </button>
          </>
        )}
      </div>

      {/* Progress bar + worker slots */}
      {running && (
        <div className="px-6 py-2.5 bg-white border-b border-slate-200 shrink-0 space-y-2">
          {/* Top row: counts + active workers */}
          <div className="flex items-center justify-between text-xs text-slate-600">
            <div className="flex items-center gap-3">
              <span className="font-medium">Map-Reduce</span>
              <span className="text-slate-400">{doneCount + failedCount} / {selectedRows.length} complete</span>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-emerald-600 font-medium">{doneCount} done</span>
              {failedCount > 0 && <span className="text-red-500">{failedCount} failed</span>}
              <span className="text-slate-400">{pendingCount} pending</span>
              {/* Live worker pills */}
              <div className="flex items-center gap-1 ml-1">
                {Array.from({ length: concurrency }).map((_, i) => (
                  <div key={i} className={clsx('w-2 h-2 rounded-full transition-all duration-300',
                    i < activeWorkers ? 'bg-cyan-400 animate-pulse' : 'bg-slate-200')} />
                ))}
                <span className="text-[10px] text-slate-400 ml-0.5">{activeWorkers}/{concurrency} workers</span>
              </div>
            </div>
          </div>
          {/* Progress track — map phase fills cyan, reduce phase fills emerald */}
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${selectedRows.length > 0 ? (doneCount / selectedRows.length) * 100 : 0}%` }} />
            <div className="h-full bg-cyan-400 transition-all duration-300 ease-out"
              style={{ width: `${selectedRows.length > 0 ? (activeWorkers / selectedRows.length) * 15 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Step 1: Input */}
      {step === 'input' && (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="panel rounded-xl p-5">
              <p className="text-sm font-semibold text-slate-800 mb-1">Paste CSV / TSV Data</p>
              <p className="text-xs text-slate-500 mb-3">
                Paste any table with a header row — <strong>any number of columns</strong>. You'll map them in the next step.
              </p>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={8}
                placeholder={"Use Case Name,Log Source,Description,MITRE Technique,Priority\nBrute Force Login,Windows Security Event Log,Detects multiple failed logins,T1110,High\nMalware Execution,Sysmon,Detects suspicious process creation,T1059,Critical"}
                className="w-full font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
              {parseError && (
                <div className="flex gap-2 mt-2 p-2 rounded bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{parseError}
                </div>
              )}
              <div className="flex items-center justify-between mt-3">
                <p className="text-[11px] text-slate-400">CSV, TSV, or auto-detected delimiter</p>
                <button onClick={handlePasteParse} disabled={!pasteText.trim()} className="btn-primary disabled:opacity-40">
                  <Upload className="w-3.5 h-3.5" /> Parse &amp; Map Columns →
                </button>
              </div>
            </div>
            <div className="text-center text-xs text-slate-400">— or upload an .xlsx / .csv file using the button above —</div>
          </div>
        </div>
      )}

      {/* Step 2: Column Mapper */}
      {step === 'map' && sheet && (
        <div className="flex-1 overflow-hidden">
          <ColumnMapper sheet={sheet} onConfirm={handleConfirmMapping} onBack={() => setStep('input')} />
        </div>
      )}

      {/* Step 3: Generate */}
      {step === 'generate' && (
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              <p className="text-sm font-medium text-slate-700">No valid rows after applying mapping</p>
              <p className="text-xs text-slate-500">Check required column settings in the mapping step.</p>
              <button onClick={() => setStep('map')} className="btn-ghost text-xs mt-1">← Back to Column Mapper</button>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  {/* Select-all checkbox */}
                  <th className="px-3 py-2.5 w-10">
                    <div onClick={toggleAll}
                      className={clsx('w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors mx-auto',
                        allSelected ? 'bg-cyan-500 border-cyan-500' :
                        someSelected ? 'bg-cyan-200 border-cyan-400' :
                        'border-slate-300 bg-white hover:border-cyan-400')}>
                      {allSelected  && <Check className="w-2.5 h-2.5 text-white" />}
                      {someSelected && <div className="w-2 h-0.5 bg-cyan-600 rounded" />}
                    </div>
                  </th>
                  <th className="text-left px-2 py-2.5 font-semibold text-slate-600 w-8 text-[11px]">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600">Use Case Name</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600 hidden md:table-cell">Log Source</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600 hidden lg:table-cell">MITRE / Category</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600 w-24">Status</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600 w-16">Time</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600 w-20">Rule</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isChecked = selected.has(row.id)
                  return (
                  <tr key={row.id} onClick={() => toggleRow(row.id)}
                    className={clsx('border-b border-slate-100 cursor-pointer transition-colors',
                      isChecked ? 'bg-cyan-50/40 hover:bg-cyan-50' :
                      i % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-50')}>
                    {/* Row checkbox */}
                    <td className="px-3 py-2.5" onClick={e => { e.stopPropagation(); toggleRow(row.id) }}>
                      <div className={clsx('w-4 h-4 rounded border-2 flex items-center justify-center mx-auto transition-colors',
                        isChecked ? 'bg-cyan-500 border-cyan-500' : 'border-slate-300 bg-white')}>
                        {isChecked && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-slate-400 font-mono text-[11px]">{String(i + 1).padStart(2, '0')}</td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-800">{row.useCaseName}</p>
                      {row.error && <p className="text-red-600 mt-0.5 text-[11px]">{row.error}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 hidden md:table-cell">{row.logSource || '—'}</td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {row.category && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-50 border border-sky-200 text-sky-700">{row.category}</span>
                        )}
                        {row.mitreTacticId && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-50 border border-rose-200 text-rose-700 font-mono">{row.mitreTacticId}</span>
                        )}
                        {row.mitreTechniqueId && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-50 border border-orange-200 text-orange-700 font-mono">{row.mitreTechniqueId}</span>
                        )}
                        {!row.category && !row.mitreTacticId && !row.mitreTechniqueId && Object.entries(row.extraFields).slice(0, 1).map(([k, v]) => (
                          <span key={k} className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 border border-amber-200 text-amber-700">
                            <span className="opacity-60">{k}:</span> {v.length > 18 ? v.slice(0, 18) + '…' : v}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={clsx('chip border', statusBadge(row.status))}>
                        {row.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">{row.duration > 0 ? `${row.duration.toFixed(1)}s` : '—'}</td>
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      {row.status === 'done' && (
                        <button onClick={() => setViewRule(row)} className="btn-ghost py-0.5 px-2 text-[11px]">
                          <Eye className="w-3 h-3" /> View
                        </button>
                      )}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* View rule modal */}
      <AnimatePresence>
        {viewRule && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setViewRule(null) }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="panel-elevated rounded-2xl p-6 w-full max-w-3xl shadow-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-start justify-between mb-3 gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-bold text-slate-800 leading-snug">{viewRule.useCaseName}</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {LANG_LABELS[language]}{viewRule.logSource && ` · ${viewRule.logSource}`}
                  </p>
                  {/* MITRE + Category badges */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {viewRule.category && (
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-sky-50 border-sky-200 text-sky-700">{viewRule.category}</span>
                    )}
                    {viewRule.mitreTacticId && (
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700">
                        <span className="opacity-60">Tactic: </span>{viewRule.mitreTactic || ''} <span className="font-mono font-semibold">{viewRule.mitreTacticId}</span>
                      </span>
                    )}
                    {!viewRule.mitreTacticId && viewRule.mitreTactic && (
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700">{viewRule.mitreTactic}</span>
                    )}
                    {viewRule.mitreTechniqueId && (
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-orange-50 border-orange-200 text-orange-700">
                        <span className="opacity-60">Technique: </span>{viewRule.mitreTechnique || ''} <span className="font-mono font-semibold">{viewRule.mitreTechniqueId}</span>
                      </span>
                    )}
                    {!viewRule.mitreTechniqueId && viewRule.mitreTechnique && (
                      <span className="text-[11px] px-2 py-0.5 rounded border bg-orange-50 border-orange-200 text-orange-700">{viewRule.mitreTechnique}</span>
                    )}
                    {Object.entries(viewRule.extraFields).map(([k, v]) => (
                      <span key={k} className="text-[11px] px-2 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700">
                        <span className="opacity-60">{k}:</span> {v}
                      </span>
                    ))}
                  </div>
                </div>
                <button onClick={() => setViewRule(null)} className="btn-ghost py-1 px-2 shrink-0"><X className="w-4 h-4" /></button>
              </div>
              <pre className="flex-1 font-mono text-xs text-slate-800 bg-slate-50 rounded-lg p-4 overflow-auto leading-relaxed border border-slate-200 whitespace-pre-wrap">
                {viewRule.generatedRule}
              </pre>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => navigator.clipboard.writeText(viewRule.generatedRule)} className="btn-ghost px-3">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
                <button onClick={() => setViewRule(null)} className="btn-primary px-4"><Check className="w-3.5 h-3.5" /> Done</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Integration Doc Tab ───────────────────────────────────────────────────────

function IntDocTab({ apiKey }: { apiKey: string }) {
  const [form, setForm] = useState<IntDocParams>({
    sourceSystem: '', destinationSystem: '', integrationMethod: '',
    keySteps: '', configFields: '', additionalNotes: '',
  })
  const [output, setOutput]         = useState('')
  const [streaming, setStreaming]   = useState(false)
  const [error, setError]           = useState('')
  const [showMethodSugg, setShowMethodSugg] = useState(false)
  const { copied, copy } = useCopyState()

  function set(k: keyof IntDocParams, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleGenerate() {
    if (!form.sourceSystem.trim() || !form.destinationSystem.trim()) return
    setStreaming(true); setOutput(''); setError('')
    let full = ''
    await streamIntDocGeneration(apiKey, form, {
      onToken: t => { full += t; setOutput(full) },
      onDone: () => setStreaming(false),
      onError: e => { setError(e); setStreaming(false) },
    })
  }

  function handleDownload() {
    if (!output) return
    const blob = new Blob([output], { type: 'text/markdown' })
    const name = `${form.sourceSystem}_to_${form.destinationSystem}_Integration.md`.replace(/\s+/g, '_')
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  }

  const filteredMethods = INTEGRATION_METHOD_SUGGESTIONS
    .filter(m => !form.integrationMethod || m.toLowerCase().includes(form.integrationMethod.toLowerCase()))
    .slice(0, 6)

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left form */}
      <div className="w-80 shrink-0 flex flex-col border-r border-slate-200 overflow-y-auto">
        <div className="p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-800 mb-0.5">Integration Doc Generator</p>
            <p className="text-xs text-slate-500">Generate a professional step-by-step integration guide.</p>
          </div>
          <div>
            <label className="section-label block mb-1.5">Source System *</label>
            <input value={form.sourceSystem} onChange={e => set('sourceSystem', e.target.value)}
              placeholder="e.g. Palo Alto Firewall, Vercel, Nginx"
              className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
          </div>
          <div>
            <label className="section-label block mb-1.5">Destination System *</label>
            <input value={form.destinationSystem} onChange={e => set('destinationSystem', e.target.value)}
              placeholder="e.g. Splunk, Microsoft Sentinel, Elastic"
              className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
          </div>
          <div className="relative">
            <label className="section-label block mb-1.5">Integration Method *</label>
            <input value={form.integrationMethod}
              onChange={e => { set('integrationMethod', e.target.value); setShowMethodSugg(true) }}
              onFocus={() => setShowMethodSugg(true)}
              onBlur={() => setTimeout(() => setShowMethodSugg(false), 150)}
              placeholder="e.g. Splunk HEC, Syslog, REST API"
              className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
            {showMethodSugg && filteredMethods.length > 0 && (
              <div className="absolute z-10 w-full mt-1 panel-elevated rounded-lg border border-slate-200 overflow-hidden shadow-lg">
                {filteredMethods.map(m => (
                  <button key={m} onMouseDown={() => { set('integrationMethod', m); setShowMethodSugg(false) }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 border-b border-slate-100 last:border-0">{m}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="section-label block mb-1.5">Key Steps / Notes <span className="text-slate-400">(optional)</span></label>
            <textarea value={form.keySteps} onChange={e => set('keySteps', e.target.value)} rows={3}
              placeholder="e.g. Enable API token, Configure source endpoint, Set index…"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
          </div>
          <div>
            <label className="section-label block mb-1.5">Configuration Fields <span className="text-slate-400">(optional)</span></label>
            <textarea value={form.configFields} onChange={e => set('configFields', e.target.value)} rows={4}
              placeholder={"URL: https://host:8088\nToken: your_hec_token\nIndex: main\nPort: 514"}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
          </div>
          <div>
            <label className="section-label block mb-1.5">Additional Notes <span className="text-slate-400">(optional)</span></label>
            <textarea value={form.additionalNotes} onChange={e => set('additionalNotes', e.target.value)} rows={2}
              placeholder="Security notes, environment specifics, prerequisites…"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400" />
          </div>
          {error && <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}</div>}
          {!apiKey ? <NoKeyBanner /> : (
            <button onClick={handleGenerate}
              disabled={streaming || !form.sourceSystem.trim() || !form.destinationSystem.trim() || !form.integrationMethod.trim()}
              className="w-full btn-primary justify-center py-2.5 disabled:opacity-40">
              {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {streaming ? 'Generating…' : 'Generate Doc'}
            </button>
          )}
        </div>
      </div>

      {/* Right output */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600">Integration Guide</span>
            {form.sourceSystem && form.destinationSystem && (
              <span className="text-xs text-slate-400">
                {form.sourceSystem} → {form.destinationSystem}
                {form.integrationMethod ? ` · ${form.integrationMethod}` : ''}
              </span>
            )}
            {streaming && <span className="chip bg-cyan-50 border border-cyan-200 text-cyan-700">Generating…</span>}
          </div>
          {output && (
            <div className="flex items-center gap-1">
              <button onClick={() => copy(output)} className="btn-ghost py-0.5 px-2 text-[11px]">
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied' : 'Copy MD'}
              </button>
              <button onClick={handleDownload} className="btn-ghost py-0.5 px-2 text-[11px]">
                <Download className="w-3 h-3" /> Download .md
              </button>
            </div>
          )}
        </div>
        <div className={clsx('flex-1 overflow-auto p-6', streaming && 'bg-gradient-to-b from-white to-slate-50/50')}>
          {!apiKey ? <NoKeyBanner /> : (
            <>
              {!output && !streaming && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-slate-400">
                  <FileText className="w-10 h-10 text-slate-300" />
                  <p className="text-sm">Fill in the form and click <strong className="text-slate-600">Generate Doc</strong> to create your integration guide.</p>
                </div>
              )}
              {(output || streaming) && (
                <div className="max-w-3xl">
                  <MarkdownDoc text={output} />
                  {streaming && <span className="inline-block w-1.5 h-5 ml-0.5 bg-cyan-500 animate-pulse align-middle rounded-sm" />}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── AI Assistant Tab ──────────────────────────────────────────────────────────

function AssistantTab({ apiKey, convertedResult, generatedResult }: {
  apiKey: string; convertedResult: SharedResult; generatedResult: SharedResult
}) {
  const [contextSource, setContextSource] = useState<'convert' | 'generate' | 'custom'>('convert')
  const [customRule, setCustomRule]       = useState('')
  const [language, setLanguage]           = useState<RuleLanguage>('kql')
  const [instruction, setInstruction]     = useState('')
  const [history, setHistory]             = useState<ChatMessage[]>([])
  const [streaming, setStreaming]         = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')
  const [currentRule, setCurrentRule]     = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const { copied, copy } = useCopyState()

  const activeResult = contextSource === 'convert' ? convertedResult : contextSource === 'generate' ? generatedResult : { code: customRule, language }
  const displayRule  = currentRule || activeResult.code

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [history, currentResponse])
  useEffect(() => {
    if (contextSource === 'convert') setLanguage(convertedResult.language || 'kql')
    else if (contextSource === 'generate') setLanguage(generatedResult.language || 'kql')
  }, [contextSource, convertedResult.language, generatedResult.language])

  async function handleSend() {
    if (!instruction.trim() || !displayRule || streaming) return
    const userMsg: ChatMessage = { role: 'user', content: instruction }
    setHistory(h => [...h, userMsg]); setInstruction(''); setStreaming(true); setCurrentResponse('')
    let full = ''
    await streamAssistantChat(apiKey, { language, currentRule: displayRule, instruction: instruction.trim(), history }, {
      onToken: t => { full += t; setCurrentResponse(full) },
      onDone: f => {
        setStreaming(false)
        const { updatedRule } = parseAssistantOutput(f)
        if (updatedRule) setCurrentRule(updatedRule)
        setHistory(h => [...h, { role: 'assistant', content: f }]); setCurrentResponse('')
      },
      onError: e => { setStreaming(false); setHistory(h => [...h, { role: 'assistant', content: `Error: ${e}` }]); setCurrentResponse('') },
    })
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left context */}
      <div className="w-80 shrink-0 flex flex-col border-r border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <p className="section-label mb-2">Load Context From</p>
          <div className="flex flex-col gap-1.5">
            {(['convert', 'generate', 'custom'] as const).map(src => (
              <button key={src} onClick={() => setContextSource(src)}
                className={clsx('text-left px-3 py-2 rounded-lg text-xs font-medium border transition-all',
                  contextSource === src ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}>
                {src === 'convert' ? `Convert Result ${convertedResult.code ? '✓' : '(empty)'}` :
                 src === 'generate' ? `Generator Result ${generatedResult.code ? '✓' : '(empty)'}` : 'Custom / Paste Rule'}
              </button>
            ))}
          </div>
          {contextSource === 'custom' && (
            <textarea value={customRule} onChange={e => setCustomRule(e.target.value)} rows={5} placeholder="Paste your rule here…"
              className="mt-2 w-full font-mono text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 resize-none focus:outline-none" />
          )}
        </div>
        <div className="p-4 border-b border-slate-200">
          <label className="section-label block mb-1.5">Rule Language</label>
          <select value={language} onChange={e => setLanguage(e.target.value as RuleLanguage)}
            className="w-full h-8 bg-white border border-slate-200 rounded-lg px-2 text-xs text-slate-800 focus:outline-none">
            {(Object.keys(LANG_LABELS) as RuleLanguage[]).map(l => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
          </select>
        </div>
        <div className="flex-1 flex flex-col p-4 gap-2 overflow-hidden">
          <div className="flex items-center justify-between">
            <p className="section-label">Current Rule</p>
            {displayRule && (
              <button onClick={() => copy(displayRule)} className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1">
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          <pre className="flex-1 font-mono text-[11px] text-slate-700 bg-slate-50 rounded-lg p-3 overflow-auto leading-relaxed border border-slate-200 whitespace-pre-wrap min-h-[120px]">
            {displayRule || <span className="text-slate-400 italic">No rule loaded yet</span>}
          </pre>
          {history.length > 0 && (
            <button onClick={() => { setHistory([]); setCurrentRule('') }} className="text-[11px] text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Reset conversation
            </button>
          )}
        </div>
      </div>
      {/* Right chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!apiKey ? <NoKeyBanner /> : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {history.length === 0 && !streaming && (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Rule Refinement Assistant</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">Load a rule from another tab, then describe the change you need.</p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center mt-1">
                    {['Add time window filter', 'Exclude whitelisted IPs', 'Add MITRE ATT&CK tags', 'Tune threshold to reduce noise'].map(hint => (
                      <button key={hint} onClick={() => setInstruction(hint)} className="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50">{hint}</button>
                    ))}
                  </div>
                </div>
              )}
              {history.map((msg, i) => {
                const { updatedRule, changes } = msg.role === 'assistant' ? parseAssistantOutput(msg.content) : { updatedRule: '', changes: [] }
                return (
                  <div key={i} className={clsx('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-lg bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5 text-violet-600" />
                      </div>
                    )}
                    <div className={clsx('max-w-[85%] rounded-xl px-4 py-3 text-xs', msg.role === 'user' ? 'bg-cyan-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm')}>
                      {msg.role === 'user' ? <p className="leading-relaxed">{msg.content}</p> : (
                        <div className="space-y-3">
                          {updatedRule && (
                            <div>
                              <p className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1"><FileCode2 className="w-3 h-3" /> Updated Rule</p>
                              <pre className="font-mono text-[11px] text-slate-800 bg-slate-50 rounded-lg p-3 overflow-auto leading-relaxed border border-slate-200 whitespace-pre-wrap max-h-60">{updatedRule}</pre>
                            </div>
                          )}
                          {changes.length > 0 && (
                            <div>
                              <p className="font-semibold text-slate-700 mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Changes Made</p>
                              <ul className="space-y-0.5">{changes.map((c, j) => <li key={j} className="flex gap-2 text-slate-600"><span className="text-emerald-500 shrink-0">•</span>{c}</li>)}</ul>
                            </div>
                          )}
                          {!updatedRule && !changes.length && <p className="leading-relaxed">{msg.content}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {streaming && currentResponse && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-lg bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-violet-600 animate-pulse" />
                  </div>
                  <div className="max-w-[85%] bg-white border border-slate-200 rounded-xl rounded-tl-sm px-4 py-3 text-xs text-slate-800">
                    <p className="leading-relaxed whitespace-pre-wrap">{currentResponse}</p>
                    <span className="inline-block w-1 h-3.5 ml-0.5 bg-violet-500 animate-pulse align-middle" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="border-t border-slate-200 p-4 bg-white">
              <div className="flex gap-3 items-end">
                <textarea value={instruction} onChange={e => setInstruction(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend() }}
                  placeholder="Describe the change you want… (Ctrl+Enter to send)" rows={2} disabled={streaming}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-400 disabled:opacity-50" />
                <button onClick={handleSend} disabled={streaming || !instruction.trim() || !displayRule}
                  className="h-10 w-10 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white flex items-center justify-center disabled:opacity-40 shrink-0">
                  {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Field Mappings Tab ────────────────────────────────────────────────────────

const MAP_CATEGORIES = ['All', ...Array.from(new Set(FIELD_MAPPINGS.map(m => m.cat)))]

function FieldMappingsTab() {
  const [search, setSearch]     = useState('')
  const [category, setCategory] = useState('All')
  const filtered = FIELD_MAPPINGS.filter(m => {
    const q = search.toLowerCase()
    return (!q || m.splunk.toLowerCase().includes(q) || m.sentinel.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q))
      && (category === 'All' || m.cat === category)
  })
  function downloadCsv() {
    const rows = FIELD_MAPPINGS.map(m => `"${m.cat}","${m.splunk}","${m.sentinel}","${m.aql}","${m.desc}"`).join('\n')
    const blob = new Blob([`Category,Splunk CIM,Sentinel ASIM,QRadar AQL,Description\n${rows}`], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'siem-field-mappings.csv'; a.click()
  }
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fields…"
          className="h-8 bg-slate-50 border border-slate-200 rounded-lg px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none w-52" />
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="h-8 bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs text-slate-700 focus:outline-none">
          {MAP_CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} / {FIELD_MAPPINGS.length}</span>
        <button onClick={downloadCsv} className="btn-ghost text-xs py-1 px-3"><Download className="w-3.5 h-3.5" /> CSV</button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600 w-28">Category</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Splunk CIM</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Sentinel / KQL</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600 hidden lg:table-cell">QRadar AQL</th>
              <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Description</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => (
              <tr key={i} className={clsx('border-b border-slate-100 hover:bg-slate-50', i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50')}>
                <td className="px-4 py-2.5"><span className="chip bg-slate-100 border border-slate-200 text-slate-600">{m.cat}</span></td>
                <td className="px-4 py-2.5 font-mono text-cyan-700 font-medium">{m.splunk}</td>
                <td className="px-4 py-2.5 font-mono text-violet-700">{m.sentinel}</td>
                <td className="px-4 py-2.5 font-mono text-emerald-700 hidden lg:table-cell">{m.aql}</td>
                <td className="px-4 py-2.5 text-slate-600">{m.desc}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-slate-400 italic">No mappings match</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Custom Rules Tab ──────────────────────────────────────────────────────────

const RULE_CATEGORIES = ['Field Mapping', 'Function', 'Operator', 'Aggregation', 'Time', 'Filter', 'Other']

function CustomRulesTab({ rules, onSave }: { rules: CustomRule[]; onSave: (r: CustomRule[]) => void }) {
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<CustomRule | null>(null)
  const [form, setForm]           = useState<Omit<CustomRule, 'id'>>({ name: '', description: '', pattern: '', replacement: '', appliesTo: 'both', category: 'Field Mapping' })

  function openAdd() { setEditing(null); setForm({ name: '', description: '', pattern: '', replacement: '', appliesTo: 'both', category: 'Field Mapping' }); setShowForm(true) }
  function openEdit(r: CustomRule) { setEditing(r); setForm({ name: r.name, description: r.description, pattern: r.pattern, replacement: r.replacement, appliesTo: r.appliesTo, category: r.category }); setShowForm(true) }
  function handleSaveForm() {
    if (!form.name.trim() || !form.pattern.trim()) return
    if (editing) onSave(rules.map(r => r.id === editing.id ? { ...r, ...form } : r))
    else onSave([...rules, { id: Date.now().toString(), ...form }])
    setShowForm(false)
  }
  const applyBadge = (v: string) => ({ spl: 'bg-blue-50 border-blue-200 text-blue-700', aql: 'bg-emerald-50 border-emerald-200 text-emerald-700', both: 'bg-violet-50 border-violet-200 text-violet-700' }[v] ?? '')
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Custom Translation Rules</p>
          <p className="text-xs text-slate-500 mt-0.5">Injected into the AI prompt during conversion to handle org-specific fields.</p>
        </div>
        <button onClick={openAdd} className="btn-primary ml-auto"><Plus className="w-3.5 h-3.5" /> Add Rule</button>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center"><BookOpen className="w-5 h-5 text-slate-400" /></div>
            <div><p className="text-sm font-semibold text-slate-700">No custom rules yet</p><p className="text-xs text-slate-500 mt-1">Add rules to guide AI when translating org-specific field names.</p></div>
            <button onClick={openAdd} className="btn-primary"><Plus className="w-3.5 h-3.5" /> Add First Rule</button>
          </div>
        ) : (
          <div className="grid gap-3">
            {rules.map(r => (
              <div key={r.id} className="panel rounded-xl p-4 flex gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-800">{r.name}</span>
                    <span className={clsx('chip border', applyBadge(r.appliesTo))}>{r.appliesTo === 'both' ? 'SPL + AQL' : r.appliesTo.toUpperCase()}</span>
                    <span className="chip bg-slate-100 border border-slate-200 text-slate-500">{r.category}</span>
                  </div>
                  {r.description && <p className="text-xs text-slate-500 mb-2">{r.description}</p>}
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 rounded">{r.pattern}</span>
                    <ArrowRightLeft className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded">{r.replacement}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(r)} className="btn-ghost py-1 px-2"><Edit3 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => onSave(rules.filter(x => x.id !== r.id))} className="btn-ghost py-1 px-2 hover:!text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="panel-elevated rounded-2xl p-6 w-full max-w-lg shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-slate-800">{editing ? 'Edit Rule' : 'New Custom Rule'}</h2>
                <button onClick={() => setShowForm(false)} className="btn-ghost py-1 px-2"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="section-label block mb-1">Rule Name *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full h-8 bg-slate-50 border border-slate-200 rounded-lg px-3 text-sm text-slate-800 focus:outline-none" />
                  </div>
                  <div>
                    <label className="section-label block mb-1">Category</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full h-8 bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs text-slate-800 focus:outline-none">
                      {RULE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="section-label block mb-1">Description</label>
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What does this rule do?"
                    className="w-full h-8 bg-slate-50 border border-slate-200 rounded-lg px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="section-label block mb-1">Source Pattern *</label>
                    <input value={form.pattern} onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))} placeholder="e.g. my_field"
                      className="w-full h-8 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs font-mono text-slate-800 focus:outline-none" />
                  </div>
                  <div>
                    <label className="section-label block mb-1">Target Replacement *</label>
                    <input value={form.replacement} onChange={e => setForm(f => ({ ...f, replacement: e.target.value }))} placeholder="e.g. CustomField"
                      className="w-full h-8 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs font-mono text-slate-800 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="section-label block mb-1">Applies To</label>
                  <div className="flex gap-2">
                    {(['spl', 'aql', 'both'] as const).map(v => (
                      <button key={v} onClick={() => setForm(f => ({ ...f, appliesTo: v }))}
                        className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                          form.appliesTo === v ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}>
                        {v === 'both' ? 'SPL + AQL' : v.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setShowForm(false)} className="btn-ghost px-4">Cancel</button>
                <button onClick={handleSaveForm} disabled={!form.name.trim() || !form.pattern.trim()}
                  className="btn-primary px-4 disabled:opacity-40">
                  <Check className="w-3.5 h-3.5" />{editing ? 'Save Changes' : 'Add Rule'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

const TABS: { id: QueryTab; label: string; icon: React.ReactNode }[] = [
  { id: 'convert',   label: 'Convert Query',    icon: <ArrowRightLeft className="w-3.5 h-3.5" /> },
  { id: 'generate',  label: 'Rule Generator',   icon: <Wand2 className="w-3.5 h-3.5" /> },
  { id: 'bulk',      label: 'Bulk Generator',   icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'intdoc',    label: 'Integration Doc',  icon: <FileText className="w-3.5 h-3.5" /> },
  { id: 'assistant', label: 'AI Assistant',     icon: <Bot className="w-3.5 h-3.5" /> },
  { id: 'mappings',  label: 'Field Mappings',   icon: <Table2 className="w-3.5 h-3.5" /> },
  { id: 'custom',    label: 'Custom Rules',      icon: <Settings2 className="w-3.5 h-3.5" /> },
]

export default function QueryTranslatorView() {
  const [activeTab, setActiveTab]       = useState<QueryTab>('convert')
  const apiKey = useStore(s => s.apiKey)
  const [convertedResult, setConvertedResult] = useState<SharedResult>({ code: '', language: 'kql' })
  const [generatedResult, setGeneratedResult] = useState<SharedResult>({ code: '', language: 'kql' })
  const [customRules, setCustomRules]   = useState<CustomRule[]>(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_RULES_KEY) || '[]') } catch { return [] }
  })

  function saveCustomRules(rules: CustomRule[]) { setCustomRules(rules); localStorage.setItem(CUSTOM_RULES_KEY, JSON.stringify(rules)) }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="shrink-0 px-6 py-3.5 border-b border-slate-200 bg-white flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-50 border border-cyan-200 flex items-center justify-center">
            <ArrowRightLeft className="w-4 h-4 text-cyan-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">Query Translator</h1>
            <p className="text-[11px] text-slate-500 leading-tight">SPL · AQL · Sigma · KQL — AI-powered SIEM detection engineering</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className={clsx('flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border',
            apiKey ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700')}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', apiKey ? 'bg-emerald-500' : 'bg-amber-500')} />
            {apiKey ? 'Groq Connected' : 'No API Key — set in top bar'}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="shrink-0 px-4 border-b border-slate-200 bg-white flex items-center gap-0.5 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={clsx('nav-tab py-3 whitespace-nowrap', activeTab === tab.id && 'active')}>
            {tab.icon}{tab.label}
            {tab.id === 'custom' && customRules.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-cyan-100 text-cyan-700 text-[10px] font-bold">{customRules.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="h-full">
            {activeTab === 'convert'   && <ConvertTab apiKey={apiKey} customRules={customRules} onResult={setConvertedResult} />}
            {activeTab === 'generate'  && <RuleGeneratorTab apiKey={apiKey} onResult={setGeneratedResult} />}
            {activeTab === 'bulk'      && <BulkGeneratorTab apiKey={apiKey} />}
            {activeTab === 'intdoc'    && <IntDocTab apiKey={apiKey} />}
            {activeTab === 'assistant' && <AssistantTab apiKey={apiKey} convertedResult={convertedResult} generatedResult={generatedResult} />}
            {activeTab === 'mappings'  && <FieldMappingsTab />}
            {activeTab === 'custom'    && <CustomRulesTab rules={customRules} onSave={saveCustomRules} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
