// Converts the official MITRE ATLAS YAML distribution into a typed JSON dataset
// consumed by the app. Run with: npm run data
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const raw = readFileSync(resolve(root, 'atlas_raw.yaml'), 'utf8')
const doc = yaml.load(raw)

const matrix = doc.matrices[0]
const rawTactics = matrix.tactics ?? []
const rawTechniques = matrix.techniques ?? []
const rawMitigations = matrix.mitigations ?? []
const rawCaseStudies = doc['case-studies'] ?? []

const clean = (s) =>
  typeof s === 'string' ? s.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() : s

// ---- Tactics (preserve matrix order = kill-chain order) ----
const tactics = rawTactics.map((t, i) => ({
  id: t.id,
  name: t.name,
  description: clean(t.description),
  order: i,
  attackRef: t['ATT&CK-reference']?.id ?? null,
  attackUrl: t['ATT&CK-reference']?.url ?? null,
}))

// ---- Techniques (split top-level vs subtechniques) ----
const techniques = rawTechniques.map((t) => ({
  id: t.id,
  name: t.name,
  description: clean(t.description),
  tactics: t.tactics ?? [],
  parent: t.specializes ?? null,
  isSubtechnique: Boolean(t.specializes),
  maturity: t.maturity ?? null,
  attackRef: t['ATT&CK-reference']?.id ?? null,
  attackUrl: t['ATT&CK-reference']?.url ?? null,
}))

// Subtechniques inherit their parent's tactic assignment
const techById = new Map(techniques.map((t) => [t.id, t]))
for (const t of techniques) {
  if (t.isSubtechnique && t.parent && (!t.tactics || t.tactics.length === 0)) {
    t.tactics = techById.get(t.parent)?.tactics ?? []
  }
}

// ---- Mitigations + reverse index technique -> mitigation ----
const mitigations = rawMitigations.map((m) => ({
  id: m.id,
  name: m.name,
  description: clean(m.description),
  categories: m.category ?? [],
  techniques: (m.techniques ?? []).map((x) => ({ id: x.id, use: clean(x.use) })),
}))

const mitigationsByTechnique = new Map()
for (const m of mitigations) {
  for (const link of m.techniques) {
    if (!mitigationsByTechnique.has(link.id)) mitigationsByTechnique.set(link.id, [])
    mitigationsByTechnique.get(link.id).push({ id: m.id, name: m.name, use: link.use })
  }
}

// ---- Case studies ----
const caseStudies = rawCaseStudies.map((c) => ({
  id: c.id,
  name: c.name,
  summary: clean(c.summary),
  incidentDate: c['incident-date'] ?? null,
  target: c.target ?? null,
  actor: c.actor ?? null,
  type: c['case-study-type'] ?? null,
  procedure: (c.procedure ?? []).map((p) => ({
    tactic: p.tactic,
    technique: p.technique,
    description: clean(p.description),
  })),
  references: (c.references ?? []).map((r) => ({ title: clean(r.title), url: r.url ?? null })),
}))

// technique -> case studies index + procedure counts
const caseStudiesByTechnique = new Map()
for (const c of caseStudies) {
  const seen = new Set()
  for (const p of c.procedure) {
    if (!p.technique || seen.has(p.technique)) continue
    seen.add(p.technique)
    if (!caseStudiesByTechnique.has(p.technique)) caseStudiesByTechnique.set(p.technique, [])
    caseStudiesByTechnique.get(p.technique).push({ id: c.id, name: c.name })
  }
}

// Attach counts + linked data onto techniques
for (const t of techniques) {
  t.mitigations = mitigationsByTechnique.get(t.id) ?? []
  t.caseStudies = caseStudiesByTechnique.get(t.id) ?? []
}

// technique -> subtechniques
const subsByParent = new Map()
for (const t of techniques) {
  if (t.parent) {
    if (!subsByParent.has(t.parent)) subsByParent.set(t.parent, [])
    subsByParent.get(t.parent).push(t.id)
  }
}
for (const t of techniques) {
  t.subtechniques = subsByParent.get(t.id) ?? []
}

// tactic -> top-level techniques
const techniquesByTactic = {}
for (const tac of tactics) techniquesByTactic[tac.id] = []
for (const t of techniques) {
  if (t.isSubtechnique) continue
  for (const tacId of t.tactics) {
    if (techniquesByTactic[tacId]) techniquesByTactic[tacId].push(t.id)
  }
}

const dataset = {
  meta: {
    id: doc.id,
    name: doc.name,
    version: doc.version,
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/mitre-atlas/atlas-data',
  },
  stats: {
    tactics: tactics.length,
    techniques: techniques.filter((t) => !t.isSubtechnique).length,
    subtechniques: techniques.filter((t) => t.isSubtechnique).length,
    mitigations: mitigations.length,
    caseStudies: caseStudies.length,
  },
  tactics,
  techniques,
  mitigations,
  caseStudies,
  index: { techniquesByTactic },
}

const outDir = resolve(root, 'src/data')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'atlas.json'), JSON.stringify(dataset, null, 0))

console.log('ATLAS dataset written:', JSON.stringify(dataset.stats, null, 2))
