/**
 * Downloads MITRE ATT&CK Enterprise STIX data and converts it to the
 * same JSON schema as atlas.json so the whole app works unchanged.
 *
 * Usage: node scripts/build-attck.mjs
 */

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../src/data/attck.json')

// Canonical tactic order as shown on attack.mitre.org/tactics/enterprise/
const TACTIC_ORDER = [
  'reconnaissance',
  'resource-development',
  'initial-access',
  'execution',
  'persistence',
  'privilege-escalation',
  'defense-evasion',
  'credential-access',
  'discovery',
  'lateral-movement',
  'collection',
  'command-and-control',
  'exfiltration',
  'impact',
  // v17 additions (included if present in the STIX data)
  'stealth',
  'defense-impairment',
]

// Try latest first, fall back to v16.1
const URLS = [
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack-17.0.json',
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack-16.1.json',
]

async function download() {
  for (const url of URLS) {
    console.log(`⬇  Trying ${url} ...`)
    const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!resp.ok) { console.warn(`   HTTP ${resp.status} — skipping`); continue }
    console.log('   Parsing (this may take a few seconds) ...')
    const stix = await resp.json()
    console.log(`   Downloaded: ${stix.objects?.length ?? 0} STIX objects`)
    return stix
  }
  throw new Error('All download URLs failed.')
}

function extId(obj) {
  return obj.external_references?.find(r => r.source_name === 'mitre-attack')?.external_id ?? null
}
function extUrl(obj) {
  return obj.external_references?.find(r => r.source_name === 'mitre-attack')?.url ?? null
}
function stripCitations(text) {
  return (text ?? '').replace(/\s*\(Citation:[^)]*\)/g, '').trim()
}

const stix = await download()
const objects = stix.objects

// ── TACTICS ──────────────────────────────────────────────────────────────────
const shortNameToId = new Map()

const tactics = objects
  .filter(o => o.type === 'x-mitre-tactic' && !o.revoked && !o.x_mitre_deprecated)
  .map(t => {
    const id = extId(t) ?? t.x_mitre_shortname
    shortNameToId.set(t.x_mitre_shortname, id)
    const order = TACTIC_ORDER.indexOf(t.x_mitre_shortname)
    return {
      id,
      name: t.name,
      description: stripCitations(t.description),
      order: order === -1 ? 900 + TACTIC_ORDER.length : order,
      attackRef: extId(t),
      attackUrl: extUrl(t),
    }
  })
  .sort((a, b) => a.order - b.order)
  .map((t, i) => ({ ...t, order: i }))

console.log(`✓ ${tactics.length} tactics`)

// ── TECHNIQUES ────────────────────────────────────────────────────────────────
const rawTechs = objects.filter(
  o => o.type === 'attack-pattern' && !o.revoked && !o.x_mitre_deprecated
)

const techniqueMap = new Map()

rawTechs.forEach(t => {
  const id = extId(t)
  if (!id) return
  const isSub = t.x_mitre_is_subtechnique ?? false
  const tacticIds = (t.kill_chain_phases ?? [])
    .filter(p => p.kill_chain_name === 'mitre-attack')
    .map(p => shortNameToId.get(p.phase_name))
    .filter(Boolean)

  techniqueMap.set(id, {
    id,
    name: t.name,
    description: stripCitations(t.description),
    tactics: tacticIds,
    parent: isSub ? id.split('.')[0] : null,
    isSubtechnique: isSub,
    maturity: null,
    attackRef: extId(t),
    attackUrl: extUrl(t),
    mitigations: [],
    caseStudies: [],
    subtechniques: [],
  })
})

// Link sub-techniques to parents
techniqueMap.forEach(tech => {
  if (tech.isSubtechnique && tech.parent) {
    const parent = techniqueMap.get(tech.parent)
    if (parent && !parent.subtechniques.includes(tech.id)) {
      parent.subtechniques.push(tech.id)
    }
  }
})
// Sort subtechnique lists
techniqueMap.forEach(tech => tech.subtechniques.sort())

const techniques = Array.from(techniqueMap.values()).sort((a, b) => a.id.localeCompare(b.id))

// ── MITIGATIONS ───────────────────────────────────────────────────────────────
const rawMits = objects.filter(
  o => o.type === 'course-of-action' && !o.revoked && !o.x_mitre_deprecated
)
const mitStixToExtId = new Map()
rawMits.forEach(m => { const id = extId(m); if (id) mitStixToExtId.set(m.id, id) })
const techStixToExtId = new Map()
rawTechs.forEach(t => { const id = extId(t); if (id) techStixToExtId.set(t.id, id) })

// Build per-technique mitigation links from 'mitigates' relationships
const techMitLinks = new Map() // techExtId → [{id, name, use}]
objects
  .filter(o => o.type === 'relationship' && o.relationship_type === 'mitigates' && !o.revoked)
  .forEach(rel => {
    const mitExtId = mitStixToExtId.get(rel.source_ref)
    const techExtId = techStixToExtId.get(rel.target_ref)
    if (!mitExtId || !techExtId) return
    const mitObj = rawMits.find(m => extId(m) === mitExtId)
    if (!techMitLinks.has(techExtId)) techMitLinks.set(techExtId, [])
    techMitLinks.get(techExtId).push({
      id: mitExtId,
      name: mitObj?.name ?? mitExtId,
      use: stripCitations(rel.description),
    })
  })

techniques.forEach(tech => {
  tech.mitigations = (techMitLinks.get(tech.id) ?? []).slice(0, 12)
})

const mitigations = rawMits.map(m => ({
  id: extId(m) ?? m.id,
  name: m.name,
  description: stripCitations(m.description),
  categories: [],
  techniques: [],
})).filter(m => m.id)

console.log(`✓ ${techniques.filter(t => !t.isSubtechnique).length} techniques, ${techniques.filter(t => t.isSubtechnique).length} sub-techniques`)
console.log(`✓ ${mitigations.length} mitigations`)

// ── INDEX ─────────────────────────────────────────────────────────────────────
const techniquesByTactic = {}
tactics.forEach(tac => {
  techniquesByTactic[tac.id] = techniques
    .filter(t => !t.isSubtechnique && t.tactics.includes(tac.id))
    .map(t => t.id)
})

// ── ASSEMBLE ──────────────────────────────────────────────────────────────────
const topLevel = techniques.filter(t => !t.isSubtechnique)
const subLevel  = techniques.filter(t => t.isSubtechnique)
const version   = stix.spec_version ? `STIX ${stix.spec_version}` : (extId(objects.find(o => o.type === 'x-mitre-collection')) ?? '16.1')

const dataset = {
  meta: {
    id: 'enterprise-attack',
    name: 'MITRE ATT&CK Enterprise',
    version,
    generatedAt: new Date().toISOString(),
    source: 'https://attack.mitre.org/tactics/enterprise/',
  },
  stats: {
    tactics: tactics.length,
    techniques: topLevel.length,
    subtechniques: subLevel.length,
    mitigations: mitigations.length,
    caseStudies: 0,
  },
  tactics,
  techniques,
  mitigations,
  caseStudies: [],
  index: { techniquesByTactic },
}

writeFileSync(OUT, JSON.stringify(dataset))
console.log(`\n✅  Written → ${OUT}`)
console.log(`   ${tactics.length} tactics | ${topLevel.length} techniques | ${subLevel.length} sub-techniques | ${mitigations.length} mitigations`)
