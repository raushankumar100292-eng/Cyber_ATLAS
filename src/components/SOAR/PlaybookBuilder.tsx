import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Zap, Loader2, Download, Copy, Check,
  GitBranch, AlertTriangle, ChevronRight, Sparkles,
  Upload, FileText, RotateCcw, RotateCw, Archive,
  FileCode2, Info,
} from 'lucide-react'
import JSZip from 'jszip'
import { generatePlaybookFlow } from '../../lib/groq'
import type { PlaybookFlow, FlowNode, FlowEdge } from '../../lib/groq'

// ── Layout constants (overlap-free) ──────────────────────────────────────────
const NODE_W    = 190
const NODE_H    = 76
const V_LEVEL_H = 150   // vertical mode: y-distance between levels  (> NODE_H)
const H_LEVEL_H = 290   // horizontal mode: x-distance between levels (> NODE_W)
const V_GAP     = 60    // vertical mode: x-gap between siblings
const H_GAP     = 22    // horizontal mode: y-gap between siblings
const PAD_X     = 56
const PAD_Y     = 50

interface LayoutResult {
  positions: Map<string, { x: number; y: number }>
  svgW: number
  svgH: number
}

function computeLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  horizontal: boolean,
): LayoutResult {
  if (!nodes.length) return { positions: new Map(), svgW: 640, svgH: 340 }

  const children = new Map(nodes.map(n => [n.id, [] as string[]]))
  for (const e of edges) children.get(e.from)?.push(e.to)

  const hasParent = new Set(edges.map(e => e.to))
  const root = nodes.find(n => n.type === 'trigger') ?? nodes.find(n => !hasParent.has(n.id)) ?? nodes[0]

  const levels = new Map<string, number>()
  function dfs(id: string, lvl: number) {
    if ((levels.get(id) ?? -1) >= lvl) return
    levels.set(id, lvl)
    for (const c of children.get(id) ?? []) dfs(c, lvl + 1)
  }
  dfs(root.id, 0)
  for (const n of nodes) if (!levels.has(n.id)) levels.set(n.id, 0)

  const byLevel = new Map<number, string[]>()
  for (const [id, lvl] of levels) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(id)
  }

  const maxPerLevel = Math.max(...[...byLevel.values()].map(v => v.length), 1)
  const numLevels   = Math.max(...[...levels.values()], 0) + 1
  const positions   = new Map<string, { x: number; y: number }>()

  if (horizontal) {
    const svgW = PAD_X * 2 + numLevels * H_LEVEL_H
    const svgH = PAD_Y * 2 + maxPerLevel * (NODE_H + H_GAP)
    for (const [lvl, ids] of byLevel) {
      const totalH = ids.length * NODE_H + (ids.length - 1) * H_GAP
      const startY = (svgH - totalH) / 2
      ids.forEach((id, i) => positions.set(id, {
        x: PAD_X + lvl * H_LEVEL_H,
        y: startY + i * (NODE_H + H_GAP),
      }))
    }
    return { positions, svgW, svgH }
  } else {
    const svgW = Math.max(maxPerLevel * (NODE_W + V_GAP) + PAD_X * 2, 640)
    const svgH = PAD_Y * 2 + numLevels * V_LEVEL_H
    for (const [lvl, ids] of byLevel) {
      const totalW = ids.length * NODE_W + (ids.length - 1) * V_GAP
      const startX = (svgW - totalW) / 2
      ids.forEach((id, i) => positions.set(id, {
        x: startX + i * (NODE_W + V_GAP),
        y: PAD_Y + lvl * V_LEVEL_H,
      }))
    }
    return { positions, svgW, svgH }
  }
}

// ── Node palette ─────────────────────────────────────────────────────────────
const NODE_STYLE: Record<FlowNode['type'], { fill: string; stroke: string; accent: string; label: string }> = {
  trigger:      { fill: '#e0f9ff', stroke: '#0891b2', accent: '#0891b2', label: 'Trigger' },
  action:       { fill: '#ede9fe', stroke: '#7c3aed', accent: '#7c3aed', label: 'Action' },
  condition:    { fill: '#fef9c3', stroke: '#ca8a04', accent: '#ca8a04', label: 'Condition' },
  notification: { fill: '#dcfce7', stroke: '#16a34a', accent: '#16a34a', label: 'Notification' },
  end:          { fill: '#fee2e2', stroke: '#dc2626', accent: '#dc2626', label: 'End' },
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
interface TooltipInfo {
  title: string
  rows: { label: string; value: string }[]
  accent: string
}

// ── Draggable Flow Diagram ────────────────────────────────────────────────────
interface FlowDiagramProps {
  flow: PlaybookFlow
  horizontal: boolean
  svgRef: React.RefObject<SVGSVGElement | null>
  positions: Map<string, { x: number; y: number }>
  onNodeMove: (id: string, pos: { x: number; y: number }) => void
}

function FlowDiagram({ flow, horizontal, svgRef, positions, onNodeMove }: FlowDiagramProps) {
  const [dragging, setDragging]   = useState<{ id: string; ox: number; oy: number; mx: number; my: number } | null>(null)
  const [tooltip, setTooltip]     = useState<TooltipInfo | null>(null)
  const [tipPos, setTipPos]       = useState({ x: 0, y: 0 })
  const containerRef              = useRef<HTMLDivElement>(null)

  // Dynamic SVG bounds based on current positions
  const { svgW, svgH } = useMemo(() => {
    let maxX = 640, maxY = 340
    for (const [, p] of positions) {
      maxX = Math.max(maxX, p.x + NODE_W + PAD_X)
      maxY = Math.max(maxY, p.y + NODE_H + PAD_Y)
    }
    return { svgW: maxX, svgH: maxY }
  }, [positions])

  function svgCoord(e: React.MouseEvent): { x: number; y: number } {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: e.clientX - rect.left + el.scrollLeft, y: e.clientY - rect.top + el.scrollTop }
  }

  function onMouseDown(nodeId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = svgCoord(e)
    const cur = positions.get(nodeId) ?? { x: 0, y: 0 }
    setDragging({ id: nodeId, ox: cur.x, oy: cur.y, mx: x, my: y })
    setTooltip(null)
  }

  function onMouseMove(e: React.MouseEvent) {
    const { x, y } = svgCoord(e)
    if (dragging) {
      const nx = Math.max(0, dragging.ox + x - dragging.mx)
      const ny = Math.max(0, dragging.oy + y - dragging.my)
      onNodeMove(dragging.id, { x: nx, y: ny })
    } else {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setTipPos({ x: e.clientX - rect.left + 16, y: e.clientY - rect.top + 16 })
      }
    }
  }

  function onMouseUp() { setDragging(null) }

  // ── Edge geometry ────────────────────────────────────────────────────────
  function edgePath(e: FlowEdge) {
    const s = positions.get(e.from), d = positions.get(e.to)
    if (!s || !d) return ''
    if (horizontal) {
      const x1 = s.x + NODE_W, y1 = s.y + NODE_H / 2
      const x2 = d.x,          y2 = d.y + NODE_H / 2
      const cx = Math.max((x2 - x1) * 0.5, 40)
      return `M ${x1} ${y1} C ${x1+cx} ${y1} ${x2-cx} ${y2} ${x2} ${y2}`
    } else {
      const x1 = s.x + NODE_W / 2, y1 = s.y + NODE_H
      const x2 = d.x + NODE_W / 2, y2 = d.y
      const cy = Math.max((y2 - y1) * 0.5, 40)
      return `M ${x1} ${y1} C ${x1} ${y1+cy} ${x2} ${y2-cy} ${x2} ${y2}`
    }
  }

  function midPt(e: FlowEdge) {
    const s = positions.get(e.from), d = positions.get(e.to)
    if (!s || !d) return { x: 0, y: 0 }
    return horizontal
      ? { x: (s.x + NODE_W + d.x) / 2, y: (s.y + NODE_H / 2 + d.y + NODE_H / 2) / 2 }
      : { x: (s.x + d.x + NODE_W) / 2, y: (s.y + NODE_H + d.y) / 2 }
  }

  function edgeColor(e: FlowEdge) {
    return e.label === 'Yes' ? '#16a34a' : e.label === 'No' ? '#dc2626' : '#94a3b8'
  }

  function wrapLabel(text: string, max = 22) {
    if (text.length <= max) return [text]
    const words = text.split(' ')
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w }
      else cur = (cur + ' ' + w).trim()
    }
    if (cur) lines.push(cur)
    return lines.slice(0, 2)
  }

  function buildNodeTooltip(node: FlowNode): TooltipInfo {
    const rows: { label: string; value: string }[] = [{ label: 'Type', value: NODE_STYLE[node.type].label }]
    if (node.tool)        rows.push({ label: 'Tool',  value: node.tool })
    if (node.description) rows.push({ label: 'Info',  value: node.description.slice(0, 120) + (node.description.length > 120 ? '…' : '') })
    return { title: node.label, rows, accent: NODE_STYLE[node.type].accent }
  }

  function buildEdgeTooltip(edge: FlowEdge): TooltipInfo {
    const f = flow.nodes.find(n => n.id === edge.from)
    const t = flow.nodes.find(n => n.id === edge.to)
    const rows = [
      { label: 'From', value: f?.label ?? edge.from },
      { label: 'To',   value: t?.label ?? edge.to   },
      ...(edge.label ? [{ label: 'Condition', value: edge.label }] : []),
    ]
    const accent = edge.label === 'Yes' ? '#16a34a' : edge.label === 'No' ? '#dc2626' : '#64748b'
    return { title: edge.label ? `Branch: ${edge.label}` : 'Flow connection', rows, accent }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', overflow: 'auto', cursor: dragging ? 'grabbing' : 'default', userSelect: 'none' }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { onMouseUp(); setTooltip(null) }}>

      <svg ref={svgRef} width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: 'block', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <defs>
          {['default', 'yes', 'no'].map(k => (
            <marker key={k} id={`pb-arr-${k}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0,10 3.5,0 7"
                fill={k === 'yes' ? '#16a34a' : k === 'no' ? '#dc2626' : '#94a3b8'} />
            </marker>
          ))}
          <pattern id="pb-grid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#e2e8f0" />
          </pattern>
        </defs>

        {/* Background */}
        <rect width={svgW} height={svgH} fill="#f8fafc" />
        <rect width={svgW} height={svgH} fill="url(#pb-grid)" />

        {/* Edges */}
        {flow.edges.map(e => {
          const color = edgeColor(e)
          const mid   = midPt(e)
          const mId   = `pb-arr-${e.label === 'Yes' ? 'yes' : e.label === 'No' ? 'no' : 'default'}`
          return (
            <g key={e.id} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setTooltip(buildEdgeTooltip(e))}
              onMouseLeave={() => setTooltip(null)}>
              <path d={edgePath(e)} fill="none" stroke="transparent" strokeWidth="12" />
              <path d={edgePath(e)} fill="none" stroke={color} strokeWidth="1.8"
                strokeDasharray={e.label ? undefined : '5 3'} strokeOpacity="0.7"
                markerEnd={`url(#${mId})`} />
              {e.label && (
                <g transform={`translate(${mid.x},${mid.y})`}>
                  <rect x="-18" y="-11" width="36" height="22" rx="6" fill="white" stroke={color} strokeWidth="1" />
                  <text textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill={color}>{e.label}</text>
                </g>
              )}
            </g>
          )
        })}

        {/* Nodes */}
        {flow.nodes.map(node => {
          const pos   = positions.get(node.id)
          if (!pos) return null
          const s       = NODE_STYLE[node.type]
          const lines   = wrapLabel(node.label)
          const isRound = node.type === 'trigger' || node.type === 'end'
          const isDragging = dragging?.id === node.id

          return (
            <g key={node.id} transform={`translate(${pos.x},${pos.y})`}
              style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              onMouseDown={ev => onMouseDown(node.id, ev)}
              onMouseEnter={() => !dragging && setTooltip(buildNodeTooltip(node))}
              onMouseLeave={() => setTooltip(null)}>
              {/* Drop shadow */}
              <rect x="2" y="3" width={NODE_W} height={NODE_H}
                rx={isRound ? 38 : 10} fill="rgba(0,0,0,0.06)" />
              {/* Body */}
              <rect x="0" y="0" width={NODE_W} height={NODE_H}
                rx={isRound ? 38 : 10}
                fill={isDragging ? 'white' : s.fill}
                stroke={s.stroke}
                strokeWidth={isDragging ? 2.5 : 1.5} />
              {/* Left accent bar (non-round nodes) */}
              {!isRound && (
                <rect x="0" y="10" width="4" height={NODE_H - 20} rx="2" fill={s.stroke} />
              )}
              {/* Type chip */}
              <rect x="12" y="10" width={s.label.length * 6 + 10} height="15" rx="4"
                fill={s.stroke} opacity="0.12" />
              <text x="17" y="20.5" fontSize="8.5" fontWeight="700" fill={s.accent}
                style={{ letterSpacing: '0.05em' }}>
                {s.label.toUpperCase()}
              </text>
              {/* Node label */}
              {lines.map((line, i) => (
                <text key={i}
                  x={NODE_W / 2} y={lines.length === 1 ? 46 : 39 + i * 16}
                  fontSize="12.5" fontWeight="600" fill="#1e293b"
                  textAnchor="middle" dominantBaseline="middle">
                  {line}
                </text>
              ))}
              {/* Tool badge */}
              {node.tool && (
                <text x={NODE_W - 10} y={NODE_H - 9}
                  fontSize="8" fill={s.accent} textAnchor="end" opacity="0.7">
                  {node.tool}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Hover tooltip */}
      {tooltip && !dragging && (
        <div style={{ position: 'absolute', left: tipPos.x, top: tipPos.y, zIndex: 60, pointerEvents: 'none', maxWidth: 250 }}>
          <div style={{ background: 'white', border: `1.5px solid ${tooltip.accent}30`, borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.14)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tooltip.accent, marginBottom: 6 }}>{tooltip.title}</div>
            {tooltip.rows.map(r => (
              <div key={r.label} style={{ display: 'flex', gap: 8, marginBottom: 3, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', paddingTop: 1 }}>{r.label}</span>
                <span style={{ fontSize: 11.5, color: '#334155', lineHeight: 1.4 }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Export converters ─────────────────────────────────────────────────────────
function toChronicle(flow: PlaybookFlow): unknown {
  return {
    playbook: {
      id: `pb-${Date.now()}`, name: flow.name, description: flow.description,
      category: 'Security Response', is_enabled: true,
      trigger: { type: 'ALERT', description: flow.trigger, filter: { confidence: 'HIGH' } },
      steps: flow.nodes.map(node => {
        const out = flow.edges.filter(e => e.from === node.id)
        return {
          id: node.id, name: node.label, description: node.description,
          type: ({ trigger:'START', action:'ACTION', condition:'CONDITION', notification:'NOTIFICATION', end:'END' } as Record<string,string>)[node.type] ?? 'ACTION',
          integration: node.tool ?? 'custom',
          action_name: node.label.toLowerCase().replace(/[^a-z0-9]+/g,'_'),
          timeout_seconds: 300,
          on_success: out.filter(e => e.label !== 'No').map(e => e.to),
          on_failure: out.filter(e => e.label === 'No').map(e => e.to),
        }
      }),
    },
  }
}

function toAzureLogicApp(flow: PlaybookFlow): unknown {
  const actions: Record<string,unknown> = {}
  for (const node of flow.nodes) {
    if (node.type === 'trigger') continue
    const inbound = flow.edges.filter(e => e.to === node.id)
    const runAfter: Record<string,string[]> = {}
    for (const e of inbound) {
      const src = flow.nodes.find(n => n.id === e.from)
      if (src && src.type !== 'trigger') runAfter[src.label.replace(/[^a-zA-Z0-9_]/g,'_')] = ['Succeeded']
    }
    const key = node.label.replace(/[^a-zA-Z0-9_]/g,'_')
    if (node.type === 'condition') {
      const yE = flow.edges.find(e => e.from === node.id && e.label === 'Yes')
      const nE = flow.edges.find(e => e.from === node.id && e.label === 'No')
      actions[key] = { type:'If', description:node.description, expression:{and:[{contains:["@variables('result')","true"]}]}, actions:yE?{[yE.to]:{type:'Compose',inputs:'true-path'}}:{}, else:{actions:nE?{[nE.to]:{type:'Compose',inputs:'false-path'}}:{}}, runAfter }
    } else {
      actions[key] = { type:'Http', description:node.description, inputs:{ method:'POST', uri:`https://api.${(node.tool??'integration').toLowerCase().replace(/\s+/g,'')}.com/v1/action`, headers:{'Content-Type':'application/json',Authorization:"@concat('Bearer ',variables('apiKey'))"}, body:{incident:'@triggerBody()',action:node.label} }, runAfter }
    }
  }
  return { '$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#', contentVersion:'1.0.0.0', parameters:{'$connections':{defaultValue:{},type:'Object'}}, triggers:{security_alert_received:{type:'Request',kind:'Http',description:flow.trigger,inputs:{schema:{type:'object',properties:{alertId:{type:'string'},severity:{type:'string'},description:{type:'string'}}}}}}, actions, outputs:{} }
}

function toSplunkSOAR(flow: PlaybookFlow): unknown {
  return { playbook_name:flow.name.toLowerCase().replace(/[^a-z0-9]+/g,'_'), display_name:flow.name, description:flow.description, category:'Security Response', tags:['soar','automated','response'], trigger:{type:'automated',description:flow.trigger}, blocks:flow.nodes.map(node=>{ const out=flow.edges.filter(e=>e.from===node.id); return { id:node.id, name:node.label.toLowerCase().replace(/[^a-z0-9]+/g,'_'), display_name:node.label, description:node.description, type:({trigger:'start',action:'action',condition:'decision',notification:'action',end:'end'} as Record<string,string>)[node.type]??'action', app:node.tool?node.tool.toLowerCase().replace(/\s+/g,'_'):'phantom', action:node.label.toLowerCase().replace(/[^a-z0-9]+/g,'_'), parameters:{}, paths:out.map(e=>({destination_id:e.to,filter:e.label??'',condition:e.label==='Yes'?'!= None':e.label==='No'?'== None':''})) } }) }
}

function toYaml(val: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean' || typeof val === 'number') return String(val)
  if (typeof val === 'string') {
    const need = /[:#\[\]{},|>&*?!@`'"\\]/.test(val) || val.includes('\n') || val.trim() !== val || val === '' || /^(true|false|null|\d.*)$/i.test(val)
    return need ? `"${val.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')}"` : val
  }
  if (Array.isArray(val)) {
    if (!val.length) return '[]'
    return val.map(item => `\n${pad}- ${toYaml(item,indent+1).trimStart()}`).join('')
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val as object)
    if (!keys.length) return '{}'
    return keys.map(k => { const v=(val as Record<string,unknown>)[k]; const s=toYaml(v,indent+1); return s.startsWith('\n')?`\n${pad}${k}:${s}`:`\n${pad}${k}: ${s}` }).join('')
  }
  return String(val)
}

function flowToYaml(flow: PlaybookFlow): string {
  return `# SOAR Playbook — ATLAS Command Center\n${toYaml({ name:flow.name, description:flow.description, trigger:flow.trigger, nodes:flow.nodes.map(n=>({id:n.id,type:n.type,label:n.label,...(n.description?{description:n.description}:{}),...(n.tool?{tool:n.tool}:{})})), edges:flow.edges.map(e=>({id:e.id,from:e.from,to:e.to,...(e.label?{label:e.label}:{})})) }).trimStart()}\n`
}

async function buildZip(flow: PlaybookFlow, svgEl: SVGSVGElement | null): Promise<Blob> {
  const zip    = new JSZip()
  const slug   = flow.name.toLowerCase().replace(/[^a-z0-9]+/g,'_')
  const folder = zip.folder(slug)!
  folder.file(`${slug}_chronicle.json`, JSON.stringify(toChronicle(flow),null,2))
  folder.file(`${slug}_azure.json`,     JSON.stringify(toAzureLogicApp(flow),null,2))
  folder.file(`${slug}_splunk.json`,    JSON.stringify(toSplunkSOAR(flow),null,2))
  folder.file(`${slug}_playbook.yaml`,  flowToYaml(flow))
  if (svgEl) folder.file(`${slug}_diagram.svg`, new XMLSerializer().serializeToString(svgEl))
  folder.file('README.md', [`# ${flow.name}`,``,`**Trigger:** ${flow.trigger}`,``,flow.description,``,`## Nodes`,flow.nodes.map(n=>`- **${n.label}** (\`${n.type}\`)${n.tool?` — ${n.tool}`:''}`).join('\n'),``,`## Files`,`- Chronicle JSON, Azure Logic Apps JSON, Splunk SOAR JSON`,`- YAML playbook definition`,`- SVG flow diagram`,``,`*Generated by ATLAS Command Center*`].join('\n'))
  return zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{level:6} })
}

const PLATFORMS = [
  { id:'chronicle' as const, label:'Google Chronicle SOAR', color:'#4285f4', bg:'#eff6ff', border:'#bfdbfe', convert:toChronicle,    desc:'Import-ready for Chronicle SOAR.' },
  { id:'azure'     as const, label:'Azure Logic Apps',      color:'#0078d4', bg:'#eff6ff', border:'#bae6fd', convert:toAzureLogicApp, desc:'ARM-compatible Logic App for Sentinel.' },
  { id:'splunk'    as const, label:'Splunk SOAR',           color:'#65a637', bg:'#f0fdf4', border:'#bbf7d0', convert:toSplunkSOAR,    desc:'Splunk SOAR (Phantom) playbook JSON.' },
]

async function extractFileText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'txt') return file.text()
  if (ext === 'pdf') {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href
    const pdf = await getDocument({ data: await file.arrayBuffer() }).promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pages.push((await p.getTextContent()).items.map((it:any)=>it.str??'').join(' '))
    }
    return pages.join('\n').trim()
  }
  if (ext === 'docx' || ext === 'doc') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.trim()
  }
  throw new Error(`Unsupported file type: .${ext}`)
}

// ── Saved playbook shape (passed to parent) ───────────────────────────────────
export interface GeneratedPlaybook {
  id: string
  name: string
  trigger: string
  description: string
  nodeCount: number
  createdAt: string
  flow: PlaybookFlow
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void
  apiKey: string
  onGenerated: (pb: GeneratedPlaybook) => void
}

export default function PlaybookBuilder({ onClose, apiKey, onGenerated }: Props) {
  const [phase, setPhase]       = useState<'input' | 'generating' | 'result'>('input')
  const [name, setName]         = useState('')
  const [planText, setPlanText] = useState('')
  const [flow, setFlow]         = useState<PlaybookFlow | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [platform, setPlatform] = useState<'chronicle'|'azure'|'splunk'>('chronicle')
  const [copied, setCopied]     = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [horizontal, setHorizontal] = useState(false)
  const [zipping, setZipping]   = useState(false)
  const [nodePositions, setNodePositions] = useState<Map<string,{x:number;y:number}>>(new Map())

  const svgRef      = useRef<SVGSVGElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading]       = useState(false)
  const [uploadedFile, setUploadedFile] = useState<string|null>(null)
  const [dragOver, setDragOver]         = useState(false)

  // Reset node positions whenever flow or orientation changes
  useEffect(() => {
    if (!flow) return
    const { positions } = computeLayout(flow.nodes, flow.edges, horizontal)
    setNodePositions(new Map(positions))
  }, [flow, horizontal])

  const handleNodeMove = useCallback((id: string, pos: { x: number; y: number }) => {
    setNodePositions(prev => { const next = new Map(prev); next.set(id, pos); return next })
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setUploading(true); setUploadedFile(file.name); setError(null)
    try { setPlanText(await extractFileText(file)) }
    catch (err) { setError(String(err)); setUploadedFile(null) }
    finally { setUploading(false) }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]; if (f) handleFile(f)
  }, [handleFile])

  const currentPlatform = PLATFORMS.find(p => p.id === platform)!
  const exportJson = useMemo(() => flow ? JSON.stringify(currentPlatform.convert(flow),null,2) : '', [flow,platform])

  const handleGenerate = useCallback(async () => {
    if (!planText.trim()) { setError('Please describe your response plan.'); return }
    if (!apiKey.trim())   { setError('Set your Groq API key on the SOAR home page.'); return }
    setError(null); setPhase('generating')
    await generatePlaybookFlow(apiKey.trim(), planText.trim(), {
      onDone: (f) => {
        if (name.trim()) f = { ...f, name: name.trim() }
        setFlow(f)
        setPhase('result')
        // Auto-save to parent immediately
        onGenerated({
          id: `gen-${Date.now()}`,
          name: f.name,
          trigger: f.trigger,
          description: f.description,
          nodeCount: f.nodes.length,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          flow: f,
        })
      },
      onError: (e) => { setError(e); setPhase('input') },
    })
  }, [planText, apiKey, name, onGenerated])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(exportJson)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }, [exportJson])

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename })
    document.body.appendChild(a); a.click()
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 2000)
  }

  const slug = flow?.name.toLowerCase().replace(/\s+/g,'_') ?? 'playbook'

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(8px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* ── White card container ───────────────────────────────────────────── */}
      <div className="flex-1 flex items-stretch justify-center py-6 px-6 overflow-hidden">
        <div className="w-full max-w-6xl flex flex-col rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'white', border: '1px solid #e2e8f0' }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b"
            style={{ borderColor: '#f1f5f9', background: 'white' }}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: '#fef9c3', border: '1px solid #fde68a' }}>
              <Zap className="w-4 h-4" style={{ color: '#d97706' }} />
            </div>
            <span className="text-sm font-semibold" style={{ color: '#1e293b' }}>Playbook Builder</span>
            {flow && <span className="text-xs font-mono ml-1" style={{ color: '#94a3b8' }}>· {flow.name}</span>}

            <div className="ml-auto flex items-center gap-2">
              {phase === 'result' && (
                <>
                  <button onClick={() => setHorizontal(h => !h)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:bg-slate-50"
                    style={{ color: '#7c3aed', borderColor: '#ede9fe' }}>
                    {horizontal ? <RotateCcw className="w-3.5 h-3.5" /> : <RotateCw className="w-3.5 h-3.5" />}
                    {horizontal ? 'Vertical' : 'Horizontal'}
                  </button>
                  <button onClick={() => { setPhase('input'); setFlow(null); setError(null) }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:bg-amber-50"
                    style={{ color: '#d97706', borderColor: '#fde68a', background: '#fef9c3' }}>
                    New Plan
                  </button>
                </>
              )}
              <button onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4" style={{ color: '#94a3b8' }} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            <AnimatePresence mode="wait">

              {/* ── Input phase ─────────────────────────────────────────────── */}
              {phase === 'input' && (
                <motion.div key="input" className="h-full overflow-y-auto flex items-start justify-center px-8 py-8"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="w-full max-w-xl space-y-5">

                    <div>
                      <h2 className="text-lg font-bold mb-1" style={{ color: '#0f172a' }}>
                        Describe your response plan
                      </h2>
                      <p className="text-sm" style={{ color: '#64748b' }}>
                        Explain what should happen in plain language — AI will build a flow diagram and generate platform-ready exports.
                      </p>
                    </div>

                    {!apiKey.trim() && (
                      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm"
                        style={{ background: '#fef9c3', border: '1px solid #fde68a', color: '#92400e' }}>
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                        Groq API key not set — enter it in the key field on the SOAR home page first.
                      </div>
                    )}

                    {error && (
                      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm"
                        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}
                      </div>
                    )}

                    {/* Name */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                        Playbook Name <span className="font-normal normal-case" style={{ color: '#94a3b8' }}>(optional)</span>
                      </label>
                      <input value={name} onChange={e => setName(e.target.value)}
                        placeholder="e.g. Ransomware Containment"
                        className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                        style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#1e293b' }}
                        onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#f59e0b' }}
                        onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = '#e2e8f0' }}
                      />
                    </div>

                    {/* File upload */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                        Upload Response Plan
                        <span className="font-normal normal-case ml-1" style={{ color: '#94a3b8' }}>— .pdf · .docx · .txt</span>
                      </label>
                      <div onDrop={handleDrop}
                        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onClick={() => !uploading && fileInputRef.current?.click()}
                        className="border-2 rounded-xl p-5 text-center cursor-pointer transition-all"
                        style={{
                          borderStyle: 'dashed',
                          borderColor: dragOver ? '#f59e0b' : uploadedFile ? '#34d399' : '#e2e8f0',
                          background:  dragOver ? '#fffbeb' : uploadedFile ? '#f0fdf4' : '#f8fafc',
                        }}>
                        {uploading ? (
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#f59e0b' }} />
                            <span className="text-sm" style={{ color: '#64748b' }}>Extracting text…</span>
                          </div>
                        ) : uploadedFile ? (
                          <div className="flex items-center justify-center gap-2">
                            <FileText className="w-4 h-4" style={{ color: '#16a34a' }} />
                            <span className="text-sm font-medium" style={{ color: '#1e293b' }}>{uploadedFile}</span>
                            <button onClick={e => { e.stopPropagation(); setUploadedFile(null); setPlanText('') }}
                              className="ml-1 p-0.5 rounded hover:bg-slate-100 transition-colors">
                              <X className="w-3.5 h-3.5" style={{ color: '#94a3b8' }} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-5 h-5 mx-auto mb-1.5" style={{ color: '#94a3b8' }} />
                            <p className="text-sm" style={{ color: '#64748b' }}>Drop document here, or click to browse</p>
                            <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>PDF · Word (.docx) · Plain text</p>
                          </>
                        )}
                      </div>
                      <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
                    </div>

                    {/* Plan text */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#64748b' }}>
                        Response Plan
                        <span className="font-normal normal-case ml-1" style={{ color: '#94a3b8' }}>— or paste / type directly</span>
                      </label>
                      <textarea value={planText} onChange={e => setPlanText(e.target.value)}
                        rows={8}
                        placeholder={`Describe your incident response workflow in plain language.\n\nExample: When we receive a phishing alert, extract all IOCs from the email. Check each URL against VirusTotal. If malicious, block in proxy and isolate endpoint via EDR. Quarantine the email, create a ServiceNow ticket, and notify the SOC via Slack.`}
                        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all resize-none leading-relaxed"
                        style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#1e293b' }}
                        onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = '#f59e0b' }}
                        onBlur={e  => { (e.target as HTMLTextAreaElement).style.borderColor = '#e2e8f0' }}
                      />
                    </div>

                    <button onClick={handleGenerate} disabled={!planText.trim() || !apiKey.trim()}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: '#f59e0b', color: 'white', boxShadow: '0 2px 8px rgba(245,158,11,0.30)' }}>
                      <Sparkles className="w-4 h-4" />Generate Flow Diagram
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── Generating phase ─────────────────────────────────────────── */}
              {phase === 'generating' && (
                <motion.div key="gen" className="h-full flex flex-col items-center justify-center gap-5"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{ background: '#fef9c3', border: '2px solid #fde68a' }}>
                    <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#d97706' }} />
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold mb-1" style={{ color: '#0f172a' }}>Building flow diagram…</div>
                    <div className="text-sm" style={{ color: '#64748b' }}>AI is parsing your plan and structuring the playbook</div>
                  </div>
                </motion.div>
              )}

              {/* ── Result phase ─────────────────────────────────────────────── */}
              {phase === 'result' && flow && (
                <motion.div key="result" className="h-full flex"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

                  {/* Flow diagram pane */}
                  <div className="flex-1 overflow-hidden flex flex-col" style={{ background: '#f8fafc', borderRight: '1px solid #e2e8f0' }}>
                    {/* Diagram header */}
                    <div className="px-5 py-3 border-b flex items-center gap-3 shrink-0"
                      style={{ borderColor: '#e2e8f0', background: 'white' }}>
                      <GitBranch className="w-4 h-4" style={{ color: '#d97706' }} />
                      <span className="text-sm font-semibold" style={{ color: '#1e293b' }}>{flow.name}</span>
                      <span className="text-[11px] font-mono" style={{ color: '#94a3b8' }}>
                        {flow.nodes.length} nodes · {flow.edges.length} edges
                      </span>
                      <div className="ml-auto flex items-center gap-3">
                        {/* Legend */}
                        {(['trigger','action','condition','notification','end'] as FlowNode['type'][]).map(t => (
                          <span key={t} className="flex items-center gap-1 text-[10px] font-semibold capitalize"
                            style={{ color: NODE_STYLE[t].accent }}>
                            <span className="w-2 h-2 rounded-sm" style={{ background: NODE_STYLE[t].accent, opacity: 0.7, display: 'inline-block' }} />
                            {t}
                          </span>
                        ))}
                        <span className="flex items-center gap-1 text-[10px]" style={{ color: '#94a3b8' }}>
                          <Info className="w-3 h-3" />drag nodes
                        </span>
                      </div>
                    </div>

                    {/* Diagram scroll area */}
                    <div className="flex-1 overflow-auto p-5">
                      <FlowDiagram
                        flow={flow}
                        horizontal={horizontal}
                        svgRef={svgRef}
                        positions={nodePositions}
                        onNodeMove={handleNodeMove}
                      />
                    </div>
                  </div>

                  {/* Export pane */}
                  <div className="w-[340px] shrink-0 flex flex-col overflow-hidden" style={{ background: 'white' }}>

                    {/* Platform selector */}
                    <div className="p-5 border-b" style={{ borderColor: '#f1f5f9' }}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: '#94a3b8' }}>
                        Export for Platform
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {PLATFORMS.map(p => (
                          <button key={p.id} onClick={() => { setPlatform(p.id); setShowJson(false) }}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                            style={{
                              background: platform === p.id ? p.bg : 'transparent',
                              border: `1.5px solid ${platform === p.id ? p.border : '#f1f5f9'}`,
                            }}>
                            <div className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: p.color, opacity: platform === p.id ? 1 : 0.3 }} />
                            <div className="flex-1">
                              <div className="text-xs font-semibold" style={{ color: platform === p.id ? p.color : '#64748b' }}>{p.label}</div>
                              {platform === p.id && <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>{p.desc}</div>}
                            </div>
                            {platform === p.id && <ChevronRight className="w-3.5 h-3.5" style={{ color: p.color }} />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Download buttons */}
                    <div className="p-5 border-b space-y-2" style={{ borderColor: '#f1f5f9' }}>
                      <div className="flex gap-2">
                        <button onClick={handleCopy}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all"
                          style={{ borderColor: copied ? '#bbf7d0' : '#e2e8f0', color: copied ? '#16a34a' : '#64748b', background: copied ? '#f0fdf4' : '#f8fafc' }}>
                          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copied ? 'Copied!' : 'Copy JSON'}
                        </button>
                        <button onClick={() => download(new Blob([exportJson],{type:'application/json'}), `${slug}_${platform}.json`)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all"
                          style={{ background: `${currentPlatform.bg}`, borderColor: currentPlatform.border, color: currentPlatform.color }}>
                          <Download className="w-3.5 h-3.5" />.json
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => download(new Blob([flowToYaml(flow)],{type:'text/yaml'}), `${slug}_playbook.yaml`)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all hover:bg-purple-50"
                          style={{ background: '#f5f3ff', borderColor: '#ddd6fe', color: '#7c3aed' }}>
                          <FileCode2 className="w-3.5 h-3.5" />.yaml
                        </button>
                        <button onClick={async () => { setZipping(true); try { download(await buildZip(flow,svgRef.current),`${slug}_playbook.zip`) } finally { setZipping(false) } }}
                          disabled={zipping}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all hover:bg-amber-50 disabled:opacity-60"
                          style={{ background: '#fef9c3', borderColor: '#fde68a', color: '#d97706' }}>
                          {zipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                          {zipping ? 'Zipping…' : '.zip (all)'}
                        </button>
                      </div>
                    </div>

                    {/* JSON preview toggle */}
                    <div className="px-5 py-3 border-b" style={{ borderColor: '#f1f5f9' }}>
                      <button onClick={() => setShowJson(v => !v)}
                        className="w-full flex items-center justify-between text-[11px] font-semibold transition-colors hover:opacity-70"
                        style={{ color: '#94a3b8' }}>
                        <span>Preview JSON</span>
                        <span className="font-mono text-[10px]">{showJson ? '▲ hide' : '▼ show'}</span>
                      </button>
                    </div>

                    {/* Content area */}
                    <div className="flex-1 overflow-auto">
                      {showJson ? (
                        <pre className="p-4 text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-all" style={{ color: '#475569' }}>
                          {exportJson}
                        </pre>
                      ) : (
                        <div className="p-5 space-y-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>Summary</div>
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#cbd5e1' }}>Trigger</div>
                            <p className="text-xs" style={{ color: '#475569' }}>{flow.trigger}</p>
                          </div>
                          <div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#cbd5e1' }}>Description</div>
                            <p className="text-xs" style={{ color: '#475569' }}>{flow.description}</p>
                          </div>
                          <div className="pt-2 border-t" style={{ borderColor: '#f1f5f9' }}>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#cbd5e1' }}>Node breakdown</div>
                            {(['trigger','action','condition','notification','end'] as FlowNode['type'][]).map(t => {
                              const count = flow.nodes.filter(n => n.type === t).length
                              if (!count) return null
                              return (
                                <div key={t} className="flex items-center justify-between mb-1">
                                  <span className="text-[11px] capitalize" style={{ color: NODE_STYLE[t].accent }}>{t}</span>
                                  <span className="text-[11px] font-mono" style={{ color: '#94a3b8' }}>{count}</span>
                                </div>
                              )
                            })}
                          </div>
                          <div className="pt-2 border-t" style={{ borderColor: '#f1f5f9' }}>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#cbd5e1' }}>.zip includes</div>
                            {['Chronicle JSON','Azure JSON','Splunk JSON','YAML','SVG diagram','README.md'].map(f => (
                              <div key={f} className="flex items-center gap-1.5 text-[11px] mb-1" style={{ color: '#94a3b8' }}>
                                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: '#f59e0b', display: 'inline-block' }} />{f}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
