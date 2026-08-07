// ─────────────────────────────────────────────────────────────────────────────
// AI Agent Studio — standalone light-themed page (opened via ?studio=1).
//
// Interactive node-graph editor built on React Flow (@xyflow/react):
//  • drag agents from the registry sidebar onto an infinite canvas
//  • connect / rearrange / delete nodes; pan / zoom / minimap
//  • select a node → edit it in the properties panel
//  • save / load / import / export workflows as JSON
//  • simulated execution run drives the bottom console
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, useReactFlow, Handle, Position,
  type Node, type Edge, type Connection, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AGENT_REGISTRY, AGENT_GLYPHS, type StudioAgent, type AgentCategory,
} from './lib/agentRegistry'
import {
  Save, Upload, Download, Play, ChevronLeft, ChevronDown, ChevronRight,
  Search, Workflow, Circle, CheckCircle2, Loader2, Clock, FilePlus2, Trash2,
} from 'lucide-react'

const C = {
  panel:'#FFFFFF', workspace:'#F5F7FA', canvas:'#ECEFF3', accent:'#4F46E5',
  text:'#111827', text2:'#6B7280', border:'#E5E7EB', borderSoft:'#EEF0F3',
}
const FONT = "'Inter', ui-sans-serif, system-ui, sans-serif"

type RunStatus = 'ok' | 'run' | 'wait'
interface AgentNodeData { agentId: string; label: string; cat: string; status?: RunStatus; [k: string]: unknown }
type FlowNode = Node<AgentNodeData>

const catColor: Record<string, { color: string; bg: string }> =
  Object.fromEntries(AGENT_REGISTRY.map(c => [c.id, { color: c.color, bg: c.chipBg }]))

const WF_KEY = 'atlas_studio_workflows'
const DRAG_MIME = 'application/studio-agent'

// ── Seed graph (so the canvas isn't empty on first open) ───────────────────────
const INITIAL_NODES: FlowNode[] = [
  { id:'n1', type:'agent', position:{x:20,  y:170}, data:{ agentId:'alert-intake', label:'Alert Intake', cat:'investigation' } },
  { id:'n2', type:'agent', position:{x:250, y:70 }, data:{ agentId:'context',      label:'Context Agent', cat:'investigation' } },
  { id:'n3', type:'agent', position:{x:250, y:280}, data:{ agentId:'threat-intel', label:'Threat Intel', cat:'threat-intel' } },
  { id:'n4', type:'agent', position:{x:500, y:170}, data:{ agentId:'mitre',        label:'MITRE + ACE', cat:'prediction' } },
  { id:'n5', type:'agent', position:{x:750, y:170}, data:{ agentId:'decision',     label:'Decision Agent', cat:'decision' } },
  { id:'n6', type:'agent', position:{x:1000,y:170}, data:{ agentId:'soar',         label:'SOAR Agent', cat:'response' } },
]
const INITIAL_EDGES: Edge[] = [
  { id:'e1-2', source:'n1', target:'n2' }, { id:'e1-3', source:'n1', target:'n3' },
  { id:'e2-4', source:'n2', target:'n4' }, { id:'e3-4', source:'n3', target:'n4' },
  { id:'e4-5', source:'n4', target:'n5' }, { id:'e5-6', source:'n5', target:'n6' },
]

// Ensure Inter is available for this surface.
function useInter() {
  useEffect(() => {
    const id = 'studio-inter-font'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id; link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
    document.head.appendChild(link)
  }, [])
}

// ── Custom canvas node ──────────────────────────────────────────────────────────
const HANDLE = { width:9, height:9, background:'#fff', border:`2px solid ${C.accent}` }
function AgentNode({ data, selected }: NodeProps<FlowNode>) {
  const cc = catColor[data.cat] ?? { color:C.accent, bg:'#EEF0FF' }
  const Glyph = AGENT_GLYPHS[data.agentId] ?? Circle
  const ring = data.status === 'ok' ? '#059669' : data.status === 'run' ? C.accent : null
  return (
    <div style={{ width:158, background:'#fff', borderRadius:12, padding:'9px 11px', fontFamily:FONT,
      border:`1px solid ${selected ? C.accent : ring ?? C.border}`,
      boxShadow: selected ? `0 0 0 3px rgba(79,70,229,0.15)` : ring ? `0 0 0 3px ${ring}22` : '0 2px 8px rgba(17,24,39,0.08)' }}>
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ width:24, height:24, borderRadius:7, background:cc.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Glyph size={14} color={cc.color} />
        </span>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:600, color:C.text, lineHeight:1.15, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{data.label}</div>
          {data.status && (
            <div style={{ fontSize:9, fontWeight:600, marginTop:2, color: data.status==='ok' ? '#059669' : data.status==='run' ? C.accent : '#9CA3AF' }}>
              {data.status === 'ok' ? '✓ done' : data.status === 'run' ? '● running' : 'waiting'}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={HANDLE} />
    </div>
  )
}
const nodeTypes = { agent: AgentNode }

// ─────────────────────────────────────────────────────────────────────────────
export default function AgentStudioTab() {
  return (
    <ReactFlowProvider>
      <StudioInner />
    </ReactFlowProvider>
  )
}

function StudioInner() {
  useInter()
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(INITIAL_NODES)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES)
  const [selId, setSelId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [wfName, setWfName] = useState('SOC Investigation')
  const [savedNames, setSavedNames] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const idc = useRef(100)
  const fileRef = useRef<HTMLInputElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  useEffect(() => { setSavedNames(Object.keys(loadAll())) }, [])
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 1800) }, [])

  const onConnect = useCallback((c: Connection) => setEdges(eds => addEdge({ ...c, id:`e${c.source}-${c.target}-${Date.now()}` }, eds)), [setEdges])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const { agentId, name, cat } = JSON.parse(raw) as { agentId:string; name:string; cat:string }
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const id = `n${idc.current++}`
    setNodes(nds => nds.concat({ id, type:'agent', position, data:{ agentId, label:name, cat } }))
  }, [screenToFlowPosition, setNodes])
  const onDragOver = useCallback((e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }, [])

  const selected = useMemo(() => nodes.find(n => n.id === selId) ?? null, [nodes, selId])
  const renameSelected = useCallback((label: string) => {
    if (!selId) return
    setNodes(nds => nds.map(n => n.id === selId ? { ...n, data:{ ...n.data, label } } : n))
  }, [selId, setNodes])

  // ── Workflow persistence ──────────────────────────────────────────────────
  const doSave = useCallback(() => {
    const all = loadAll()
    all[wfName] = { nodes, edges }
    saveAll(all); setSavedNames(Object.keys(all)); flash(`Saved “${wfName}”`)
  }, [wfName, nodes, edges, flash])

  const doLoad = useCallback((name: string) => {
    const wf = loadAll()[name]
    if (!wf) return
    setNodes(wf.nodes as FlowNode[]); setEdges(wf.edges as Edge[]); setWfName(name); setSelId(null); flash(`Loaded “${name}”`)
  }, [setNodes, setEdges, flash])

  const doNew = useCallback(() => { setNodes([]); setEdges([]); setSelId(null); setWfName('Untitled'); flash('New workflow') }, [setNodes, setEdges, flash])

  const doExport = useCallback(() => {
    const blob = new Blob([JSON.stringify({ name:wfName, nodes, edges }, null, 2)], { type:'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${wfName.replace(/\s+/g,'_')}.json`; a.click()
    URL.revokeObjectURL(url); flash('Exported .json')
  }, [wfName, nodes, edges])

  const doImport = useCallback((file: File) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const wf = JSON.parse(String(r.result)) as { name?:string; nodes:FlowNode[]; edges:Edge[] }
        setNodes(wf.nodes ?? []); setEdges(wf.edges ?? []); if (wf.name) setWfName(wf.name); setSelId(null); flash('Imported workflow')
      } catch { flash('Invalid workflow file') }
    }
    r.readAsText(file)
  }, [setNodes, setEdges, flash])

  // ── Simulated execution run (left → right over the current graph) ──────────
  const [running, setRunning] = useState(false)
  const doRun = useCallback(() => {
    if (running || nodes.length === 0) return
    setRunning(true)
    const order = [...nodes].sort((a, b) => a.position.x - b.position.x)
    setNodes(nds => nds.map(n => ({ ...n, data:{ ...n.data, status:'wait' as RunStatus } })))
    let i = 0
    const tick = () => {
      if (i >= order.length) { setRunning(false); flash('Run complete'); return }
      const cur = order[i].id
      setNodes(nds => nds.map(n => n.id === cur ? { ...n, data:{ ...n.data, status:'run' as RunStatus } } : n))
      setTimeout(() => {
        setNodes(nds => nds.map(n => n.id === cur ? { ...n, data:{ ...n.data, status:'ok' as RunStatus } } : n))
        i++; tick()
      }, 480)
    }
    tick()
  }, [running, nodes, setNodes, flash])

  const runOrder = useMemo(() => [...nodes].sort((a, b) => a.position.x - b.position.x), [nodes])

  return (
    <div style={{ position:'fixed', inset:0, background:C.workspace, color:C.text, fontFamily:FONT, display:'flex', flexDirection:'column' }}>

      {/* ── Sticky toolbar ─────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', background:C.panel, borderBottom:`1px solid ${C.borderSoft}`, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, fontWeight:700, fontSize:15 }}>
          <span style={{ width:26, height:26, borderRadius:8, background:C.accent, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Workflow size={15} color="#fff" />
          </span>
          AI Agent Studio
        </div>
        <input value={wfName} onChange={e => setWfName(e.target.value)} title="Workflow name"
          style={{ fontSize:12, fontWeight:600, color:C.text, background:'#F9FAFB', border:`1px solid ${C.border}`, borderRadius:7, padding:'5px 9px', width:160, fontFamily:FONT, outline:'none' }} />
        {savedNames.length > 0 && (
          <select onChange={e => e.target.value && doLoad(e.target.value)} value=""
            title="Load a saved workflow"
            style={{ fontSize:12, color:C.text2, border:`1px solid ${C.border}`, borderRadius:7, padding:'6px 8px', background:'#fff', fontFamily:FONT, cursor:'pointer' }}>
            <option value="">Load…</option>
            {savedNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <div style={{ flex:1 }} />
        <TBtn icon={FilePlus2} label="New"    onClick={doNew} />
        <TBtn icon={Upload}    label="Import" onClick={() => fileRef.current?.click()} />
        <TBtn icon={Download}  label="Export" onClick={doExport} />
        <TBtn icon={Save}      label="Save"   onClick={doSave} />
        <TBtn icon={Play}      label={running ? 'Running…' : 'Run'} onClick={doRun} primary />
        <button onClick={() => window.close()} title="Close studio tab"
          style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, color:C.text2, background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, padding:'6px 10px', cursor:'pointer', fontFamily:FONT }}>
          <ChevronLeft size={14} /> ATLAS
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display:'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'244px 1fr 288px' }}>

        {/* Left sidebar */}
        <div style={{ background:C.panel, borderRight:`1px solid ${C.borderSoft}`, display:'flex', flexDirection:'column', minHeight:0 }}>
          <div style={{ padding:'12px 12px 8px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, border:`1px solid ${C.border}`, borderRadius:9, padding:'7px 9px' }}>
              <Search size={14} color="#9CA3AF" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search agents…"
                style={{ border:'none', outline:'none', fontSize:12.5, width:'100%', color:C.text, background:'transparent', fontFamily:FONT }} />
            </div>
            <div style={{ fontSize:10, color:'#9CA3AF', marginTop:7, paddingLeft:2 }}>Drag an agent onto the canvas →</div>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'0 10px 16px' }}>
            {AGENT_REGISTRY.map(cat => <CategoryBlock key={cat.id} cat={cat} query={query} />)}
          </div>
        </div>

        {/* Canvas */}
        <div style={{ position:'relative' }} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            nodeTypes={nodeTypes}
            onSelectionChange={({ nodes: sel }) => setSelId(sel[0]?.id ?? null)}
            defaultEdgeOptions={{ type:'smoothstep', style:{ stroke:'#B7BEC9', strokeWidth:2 } }}
            fitView proOptions={{ hideAttribution:true }}
            style={{ background:C.canvas }}>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#D5DAE1" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => (catColor[(n.data as AgentNodeData)?.cat]?.color ?? C.accent)}
              style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:8 }} />
          </ReactFlow>
          {toast && (
            <div style={{ position:'absolute', bottom:14, left:'50%', transform:'translateX(-50%)', zIndex:6,
              background:C.text, color:'#fff', fontSize:11.5, fontWeight:500, borderRadius:8, padding:'7px 14px', boxShadow:'0 4px 14px rgba(0,0,0,0.2)' }}>
              {toast}
            </div>
          )}
        </div>

        {/* Right properties */}
        <div style={{ background:C.panel, borderLeft:`1px solid ${C.borderSoft}`, overflowY:'auto', padding:'14px 14px 20px' }}>
          {selected ? (
            <Properties node={selected} onRename={renameSelected} />
          ) : (
            <div style={{ fontSize:12, color:C.text2, textAlign:'center', marginTop:44, lineHeight:1.6 }}>
              Select a node to edit its properties, or drag an agent from the left to add one.
            </div>
          )}
        </div>
      </div>

      {/* ── Execution console ──────────────────────────────────────────────── */}
      <div style={{ background:C.panel, borderTop:`1px solid ${C.borderSoft}`, padding:'8px 16px', display:'flex', alignItems:'center', gap:8, overflowX:'auto' }}>
        <span style={{ fontSize:10, fontWeight:700, color:C.text2, textTransform:'uppercase', letterSpacing:'.05em', marginRight:4, whiteSpace:'nowrap' }}>Execution Console</span>
        {runOrder.length === 0
          ? <span style={{ fontSize:11, color:'#9CA3AF' }}>Add agents and press Run.</span>
          : runOrder.map(n => <ConsoleStep key={n.id} label={n.data.label} status={n.data.status} />)}
        <div style={{ flex:1 }} />
        <span style={{ fontSize:10.5, color:'#9CA3AF', whiteSpace:'nowrap' }}>{nodes.length} nodes · {edges.length} edges · simulated run</span>
      </div>
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────────
function CategoryBlock({ cat, query }: { cat: AgentCategory; query: string }) {
  const [open, setOpen] = useState(true)
  const q = query.trim().toLowerCase()
  const agents = q ? cat.agents.filter(a => a.name.toLowerCase().includes(q)) : cat.agents
  if (!agents.length) return null
  const show = q ? true : open
  const Icon = cat.icon
  return (
    <div style={{ marginTop:10 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:6, width:'100%', background:'transparent', border:'none', cursor:'pointer', padding:'2px 2px 5px', fontFamily:FONT }}>
        {show ? <ChevronDown size={13} color="#9CA3AF" /> : <ChevronRight size={13} color="#9CA3AF" />}
        <Icon size={13} color={cat.color} />
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'#9CA3AF' }}>{cat.label}</span>
        <span style={{ marginLeft:'auto', fontSize:9.5, color:'#B6BCC6', fontWeight:600 }}>{cat.agents.length}</span>
      </button>
      {show && agents.map(a => <AgentChip key={a.id} agent={a} cat={cat} />)}
    </div>
  )
}

function AgentChip({ agent, cat }: { agent: StudioAgent; cat: AgentCategory }) {
  const Glyph = AGENT_GLYPHS[agent.id] ?? cat.icon
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ agentId: agent.id, name: agent.name, cat: cat.id }))
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <div draggable={!agent.disabled} onDragStart={onDragStart}
      title={agent.disabled ? 'Connector plugin — enable later' : `Drag to canvas · ${agent.desc}`}
      style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:500, color: agent.disabled ? '#9CA3AF' : '#374151',
        padding:'7px 8px', border:`1px solid ${C.borderSoft}`, borderRadius:9, marginBottom:5,
        background:'#FCFCFD', cursor: agent.disabled ? 'not-allowed' : 'grab', opacity: agent.disabled ? 0.6 : 1 }}>
      <span style={{ width:20, height:20, borderRadius:6, background:cat.chipBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <Glyph size={12} color={cat.color} />
      </span>
      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{agent.name}</span>
      {agent.disabled && <span style={{ marginLeft:'auto', fontSize:8.5, fontWeight:700, color:'#9CA3AF', background:'#F3F4F6', borderRadius:4, padding:'1px 4px' }}>SOON</span>}
    </div>
  )
}

// ── Toolbar button ─────────────────────────────────────────────────────────────
function TBtn({ icon: Icon, label, primary, onClick }: { icon: typeof Save; label: string; primary?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:600,
      color: primary ? '#fff' : '#374151', background: primary ? C.accent : '#fff',
      border:`1px solid ${primary ? C.accent : C.border}`, borderRadius:8, padding:'6px 11px', cursor:'pointer', fontFamily:FONT }}>
      <Icon size={14} />{label}
    </button>
  )
}

// ── Properties panel ─────────────────────────────────────────────────────────────
function Properties({ node, onRename }: { node: FlowNode; onRename: (v: string) => void }) {
  const d = node.data
  const cc = catColor[d.cat] ?? { color:C.accent, bg:'#EEF0FF' }
  const Glyph = AGENT_GLYPHS[d.agentId] ?? Circle
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:12 }}>
        <span style={{ width:30, height:30, borderRadius:9, background:cc.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Glyph size={16} color={cc.color} />
        </span>
        <div>
          <div style={{ fontSize:13.5, fontWeight:700 }}>{d.label}</div>
          <div style={{ fontSize:10.5, color:'#9CA3AF' }}>{node.id} · Enabled</div>
        </div>
      </div>
      <PropSection title="General">
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:10, color:C.text2, marginBottom:3 }}>Name</div>
          <input value={d.label} onChange={e => onRename(e.target.value)}
            style={{ width:'100%', fontSize:11.5, color:C.text, border:`1px solid ${C.border}`, borderRadius:7, padding:'6px 9px', background:'#fff', outline:'none', fontFamily:FONT }} />
        </div>
        <Field label="Agent ID" value={d.agentId} />
      </PropSection>
      <PropSection title="Model">
        <Field label="LLM" value="llama-3.3-70b-versatile" chevron />
        <Field label="Temperature" value="0.2" />
        <Field label="System Prompt" value="You are a SOC …" />
      </PropSection>
      <PropSection title="Execution">
        <Field label="Mode" value="Sequential" chevron />
        <Field label="Retry count" value="2" />
        <Field label="Timeout" value="30s" />
      </PropSection>
      <PropSection title="I/O">
        <Field label="Input schema" value="alert.json" chevron />
        <Field label="Output schema" value="finding.json" chevron />
      </PropSection>
      <PropSection title="Status">
        <Field label="State" value="Enabled" badge="#059669" />
        <Field label="Version" value="1.0" />
      </PropSection>
    </div>
  )
}

function PropSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ marginBottom:6 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'transparent', border:'none', cursor:'pointer', padding:'8px 2px', fontFamily:FONT }}>
        <span style={{ fontSize:10.5, fontWeight:700, color:C.text2, textTransform:'uppercase', letterSpacing:'.05em' }}>{title}</span>
        {open ? <ChevronDown size={14} color="#9CA3AF" /> : <ChevronRight size={14} color="#9CA3AF" />}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function Field({ label, value, chevron, badge }: { label: string; value: string; chevron?: boolean; badge?: string }) {
  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ fontSize:10, color:C.text2, marginBottom:3 }}>{label}</div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:11.5, color:C.text,
        border:`1px solid ${C.border}`, borderRadius:7, padding:'6px 9px', background:'#fff' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{value}</span>
        {badge && <span style={{ width:8, height:8, borderRadius:'50%', background:badge, flexShrink:0 }} />}
        {chevron && <ChevronDown size={13} color="#9CA3AF" style={{ flexShrink:0 }} />}
      </div>
    </div>
  )
}

// ── Console step ─────────────────────────────────────────────────────────────────
function ConsoleStep({ label, status }: { label: string; status?: RunStatus }) {
  const meta = {
    ok:   { bg:'#D1FAE5', color:'#059669', Icon:CheckCircle2, suffix:'· done' },
    run:  { bg:'#EEF0FF', color:C.accent,  Icon:Loader2,      suffix:'· running…' },
    wait: { bg:'#F3F4F6', color:'#9CA3AF', Icon:Clock,        suffix:'· waiting' },
  }[status ?? 'wait']
  const Icon = meta.Icon
  return (
    <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:10.5, fontWeight:500, color:meta.color,
      background:meta.bg, borderRadius:20, padding:'4px 9px', whiteSpace:'nowrap' }}>
      <Icon size={11} className={status === 'run' ? 'animate-spin' : ''} />
      {label} {meta.suffix}
    </span>
  )
}

// ── localStorage helpers ─────────────────────────────────────────────────────────
function loadAll(): Record<string, { nodes: unknown[]; edges: unknown[] }> {
  try { return JSON.parse(localStorage.getItem(WF_KEY) ?? '{}') } catch { return {} }
}
function saveAll(all: Record<string, { nodes: unknown[]; edges: unknown[] }>): void {
  try { localStorage.setItem(WF_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}
