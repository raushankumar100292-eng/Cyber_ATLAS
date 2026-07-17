import type { UseCaseEntry, UseCaseAnalysis, CoverageDataset } from './types'
import type { DeltaDoc, DeltaResult } from './delta'
import { buildDeltaPrompt } from './delta'

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

function buildPrompt(
  coverage: CoverageDataset,
  useCases: UseCaseEntry[],
  analysis: UseCaseAnalysis,
): string {
  const tacticLines = analysis.tacticBreakdown
    .map(t => `  - ${t.tacticName}: ${t.count} detection(s)`)
    .join('\n')

  const categoryLines = analysis.categoryBreakdown
    .map(c => `  - ${c.category}: ${c.count}`)
    .join('\n')

  const logLines = analysis.logSourceBreakdown
    .slice(0, 8)
    .map(l => `  - ${l.source}: ${l.count}`)
    .join('\n')

  const gapText = analysis.topGaps.length > 0
    ? analysis.topGaps.join(', ')
    : 'None — all major tactics covered'

  // Sample use case names for context
  const sampleUseCases = useCases
    .slice(0, 10)
    .map(u => `  - ${u.useCaseName} (${u.tacticName} → ${u.techniqueName})`)
    .join('\n')

  return `You are a senior cybersecurity analyst reviewing MITRE ATT&CK framework coverage for a Security Operations Center.

## Coverage Dataset
- **Dataset name**: ${coverage.name}
- **Total detection use cases**: ${analysis.total}
- **Techniques/sub-techniques covered**: ${analysis.techniquesCovered}
- **Tactics with active coverage**: ${analysis.tacticsFullyCovered} out of 14 MITRE ATT&CK tactics

## Coverage by Tactic
${tacticLines || '  (no tactic breakdown available)'}

## Detection Categories
${categoryLines || '  (no category data)'}

## Log Sources
${logLines || '  (no log source data)'}

## Coverage Gaps (tactics with zero coverage)
${gapText}

## Sample Detection Use Cases
${sampleUseCases || '  (use case format not detected)'}

---

Based on this data, provide a structured security analysis using exactly this format:

## Executive Summary
Write 2–3 sentences summarising the organisation's overall MITRE ATT&CK coverage posture and maturity level.

## Key Strengths
List 3 specific areas where the coverage is strong, citing actual tactics or techniques from the data.

## Critical Gaps
List the top 3 highest-priority coverage gaps, explaining the business risk of each.

## Recommendations
Provide 4 specific, actionable next steps to improve coverage, referencing actual MITRE tactics/techniques.

## Risk Rating
State: **High / Medium / Low** — then one sentence explaining the rating based on the gaps found.

Be concise, specific, and technical. Use ATT&CK tactic/technique IDs where relevant.`
}

export interface GroqStreamCallbacks {
  onToken: (token: string) => void
  onDone: (full: string) => void
  onError: (err: string) => void
}

export async function analyzeWithGroq(
  apiKey: string,
  coverage: CoverageDataset,
  useCases: UseCaseEntry[],
  analysis: UseCaseAnalysis,
  callbacks: GroqStreamCallbacks,
) {
  const prompt = buildPrompt(coverage, useCases, analysis)

  let response: Response
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a senior cybersecurity analyst specialising in MITRE ATT&CK framework analysis. Provide clear, structured, actionable security insights.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1200,
        stream: true,
      }),
    })
  } catch (e) {
    callbacks.onError(`Network error: ${String(e)}`)
    return
  }

  if (!response.ok) {
    try {
      const err = await response.json() as { error?: { message?: string } }
      callbacks.onError(err.error?.message ?? `Groq API error ${response.status}`)
    } catch {
      callbacks.onError(`Groq API error ${response.status}`)
    }
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          callbacks.onDone(full)
          return
        }
        try {
          const json = JSON.parse(data) as {
            choices: { delta: { content?: string } }[]
          }
          const token = json.choices[0]?.delta?.content ?? ''
          if (token) {
            full += token
            callbacks.onToken(token)
          }
        } catch {
          // partial JSON chunk — skip
        }
      }
    }
  } catch (e) {
    callbacks.onError(`Stream error: ${String(e)}`)
    return
  }

  callbacks.onDone(full)
}

// ── Per-tactic gap suggestions ────────────────────────────────────────────────

export interface TacticCoverageSummary {
  tacticName: string
  tacticId: string
  pct: number
  full:      { id: string; name: string }[]
  partial:   { id: string; name: string }[]
  uncovered: { id: string; name: string }[]
  useCases:  { name: string; techniqueId: string; techniqueName: string; logSource: string }[]
}

function buildTacticSuggestionsPrompt(s: TacticCoverageSummary): string {
  const fullLines      = s.full.map(t      => `  - ${t.id}: ${t.name} [FULL]`).join('\n')
  const partialLines   = s.partial.map(t   => `  - ${t.id}: ${t.name} [PARTIAL]`).join('\n')
  const uncoveredLines = s.uncovered.map(t => `  - ${t.id}: ${t.name}`).join('\n')
  const ucLines        = s.useCases.slice(0, 20).map(u =>
    `  - "${u.name}" → ${u.techniqueId} ${u.techniqueName} (${u.logSource})`
  ).join('\n')

  return `You are a senior SOC architect. Your task is to recommend specific detection improvements for one MITRE ATT&CK tactic.

## Tactic Under Review
**${s.tacticName}** (${s.tacticId})
Current coverage: **${s.pct}%** — ${s.full.length} full, ${s.partial.length} partial, ${s.uncovered.length} not covered (${s.full.length + s.partial.length + s.uncovered.length} total techniques)

## Covered Techniques
${fullLines || '  (none)'}

## Partial Coverage
${partialLines || '  (none)'}

## NOT Covered (Priority Gaps)
${uncoveredLines || '  (none — tactic is fully covered!)'}

## Client's Existing Use Cases for this Tactic
${ucLines || '  (no use cases yet — this is a zero-coverage tactic)'}

---

Provide targeted recommendations to reach 100% coverage. Use this exact format:

## Quick Wins
List 2–3 techniques the client can cover immediately using their existing log sources. Cite the log source and suggest a use case name.

## Priority Gaps
List the 3 highest-risk uncovered techniques. For each state: why it matters, recommended detection approach, and a suggested use case name.

## New Use Cases to Build
For each priority gap provide a ready-to-implement template:
**Use Case Name:** [Descriptive name]
**Log Source:** [Specific source, e.g., Windows Security Event Log, EDR, Firewall]
**Technique:** [ID – Name]
**Detection Logic:** [One-sentence description of what to detect]

## Upgrade Partials to Full
For each partial-coverage technique, list one specific improvement to reach full coverage.

## 100% Roadmap
3 prioritised steps to close all gaps for this tactic, ordered by impact.

Be concise and specific. Reference ATT&CK technique IDs. Tailor suggestions to the client's existing log sources where possible.`
}

export async function suggestTacticCoverage(
  apiKey: string,
  summary: TacticCoverageSummary,
  callbacks: GroqStreamCallbacks,
) {
  const prompt = buildTacticSuggestionsPrompt(summary)

  let response: Response
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a senior SOC architect specialising in MITRE ATT&CK detection engineering. Provide concise, specific, immediately actionable recommendations. Always cite technique IDs.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.25,
        max_tokens: 1400,
        stream: true,
      }),
    })
  } catch (e) {
    callbacks.onError(`Network error: ${String(e)}`)
    return
  }

  if (!response.ok) {
    try {
      const err = await response.json() as { error?: { message?: string } }
      callbacks.onError(err.error?.message ?? `Groq API error ${response.status}`)
    } catch {
      callbacks.onError(`Groq API error ${response.status}`)
    }
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') { callbacks.onDone(full); return }
        try {
          const json = JSON.parse(data) as { choices: { delta: { content?: string } }[] }
          const token = json.choices[0]?.delta?.content ?? ''
          if (token) { full += token; callbacks.onToken(token) }
        } catch { /* partial chunk */ }
      }
    }
  } catch (e) {
    callbacks.onError(`Stream error: ${String(e)}`)
    return
  }

  callbacks.onDone(full)
}

export async function analyzeWorkNotesWithGroq(
  apiKey: string,
  docA: DeltaDoc,
  docB: DeltaDoc,
  delta: DeltaResult,
  workNotes: string,
  callbacks: GroqStreamCallbacks,
) {
  const changedSample = delta.rows
    .filter(r => r.status === 'changed').slice(0, 12)
    .map(r =>
      `  Key=${r.key} | Changed fields: ${r.changedFields.map(f => `${f}: "${r.rowA?.[f] ?? ''}" → "${r.rowB?.[f] ?? ''}"`).join(' | ')}`
    ).join('\n')

  const addedSample = delta.rows
    .filter(r => r.status === 'added').slice(0, 8)
    .map(r => `  Key=${r.key}: ${delta.compareFields.map(f => `${f}="${r.rowB?.[f] ?? ''}"`).join(', ')}`)
    .join('\n')

  const removedSample = delta.rows
    .filter(r => r.status === 'removed').slice(0, 8)
    .map(r => `  Key=${r.key}: ${delta.compareFields.map(f => `${f}="${r.rowA?.[f] ?? ''}"`).join(', ')}`)
    .join('\n')

  const prompt = `You are a senior data analyst reviewing changes between two Excel documents.

## Documents
- Document A (Baseline): ${docA.fileName} — ${docA.rows.length} rows
- Document B (Updated): ${docB.fileName} — ${docB.rows.length} rows
- Key Field: ${delta.keyField}
- Compared Fields: ${delta.compareFields.join(', ')}

## Delta Statistics
- Changed Records: ${delta.stats.changed}
- Added Records: ${delta.stats.added}
- Removed Records: ${delta.stats.removed}
- Unchanged Records: ${delta.stats.unchanged}
- Total Records Analysed: ${delta.rows.length}

## Sample Changed Records
${changedSample || '  (none)'}

## Sample Added Records
${addedSample || '  (none)'}

## Sample Removed Records
${removedSample || '  (none)'}

## Analyst Work Notes
${workNotes}

---

Analyse the delta data in the context of the analyst's work notes above and provide a structured report:

## Executive Summary
2–3 sentences summarising what changed between the two documents and the context from the work notes.

## Key Observations
List 4–5 specific findings about the changes, referencing actual field names, key values, and work note context.

## Risk & Impact Assessment
Assess the significance of the changes (additions/removals/modifications). What is the operational impact?

## Action Items
Prioritised list of actions based on this analysis. Format each as:
- **[High/Medium/Low]** Action → Owner/Team

## Recommendations
3–5 follow-up recommendations based on the combined delta and work notes analysis.

Be specific. Reference actual field names and key values from the data. Tie every insight back to the work notes context.`

  let response: Response
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are a senior data analyst. Provide structured, actionable analysis of document changes. Be specific and reference the actual data.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1600,
        stream: true,
      }),
    })
  } catch (e) {
    callbacks.onError(`Network error: ${String(e)}`)
    return
  }

  if (!response.ok) {
    try {
      const err = await response.json() as { error?: { message?: string } }
      callbacks.onError(err.error?.message ?? `Groq API error ${response.status}`)
    } catch { callbacks.onError(`Groq API error ${response.status}`) }
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') { callbacks.onDone(full); return }
        try {
          const json = JSON.parse(data) as { choices: { delta: { content?: string } }[] }
          const token = json.choices[0]?.delta?.content ?? ''
          if (token) { full += token; callbacks.onToken(token) }
        } catch { /* partial chunk */ }
      }
    }
  } catch (e) {
    callbacks.onError(`Stream error: ${String(e)}`)
    return
  }
  callbacks.onDone(full)
}

export async function analyzeDeltaWithGroq(
  apiKey: string,
  docA: DeltaDoc,
  docB: DeltaDoc,
  delta: DeltaResult,
  callbacks: GroqStreamCallbacks,
) {
  const prompt = buildDeltaPrompt(docA, docB, delta)

  let response: Response
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a senior data analyst specialising in security dataset comparisons. Provide clear, structured, actionable insights about what has changed between two document versions.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1200,
        stream: true,
      }),
    })
  } catch (e) {
    callbacks.onError(`Network error: ${String(e)}`)
    return
  }

  if (!response.ok) {
    try {
      const err = await response.json() as { error?: { message?: string } }
      callbacks.onError(err.error?.message ?? `Groq API error ${response.status}`)
    } catch {
      callbacks.onError(`Groq API error ${response.status}`)
    }
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') { callbacks.onDone(full); return }
        try {
          const json = JSON.parse(data) as { choices: { delta: { content?: string } }[] }
          const token = json.choices[0]?.delta?.content ?? ''
          if (token) { full += token; callbacks.onToken(token) }
        } catch { /* partial chunk */ }
      }
    }
  } catch (e) {
    callbacks.onError(`Stream error: ${String(e)}`)
    return
  }

  callbacks.onDone(full)
}

export async function analyzeSingleFileWithGroq(
  apiKey: string,
  doc: DeltaDoc,
  keyField: string,
  viewFields: string[],
  callbacks: GroqStreamCallbacks,
) {
  const sampleRows = doc.rows.slice(0, 15).map(r => {
    const vals = viewFields.slice(0, 5).map(f => `${f}="${r[f] ?? ''}"`)
    return `  ${r[keyField] ?? '?'}: ${vals.join(', ')}`
  }).join('\n')

  const prompt = `You are a senior data analyst reviewing an Excel file.

## File Information
- **File**: ${doc.fileName}
- **Total Rows**: ${doc.rows.length}
- **Key/Identifier Field**: ${keyField}
- **Analyzed Columns**: ${viewFields.join(', ')}

## Sample Data (first 15 rows)
${sampleRows || '  (no data)'}

---

Provide a structured analysis using exactly this format:

## Executive Summary
2-3 sentences on the size, structure, and nature of this dataset.

## Data Quality Observations
Highlight any patterns, anomalies, or data quality issues you can infer from the sample.

## Key Insights
Top 3-5 notable observations about the data content, distribution, or patterns.

## Recommendations
3 specific, actionable next steps for working with this dataset.

Be concise, specific, and reference actual field names and values from the sample data.`

  let sfResponse: Response
  try {
    sfResponse = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [
        { role: 'system', content: 'You are a senior data analyst. Provide structured, actionable analysis of tabular data.' },
        { role: 'user', content: prompt },
      ], temperature: 0.3, max_tokens: 1200, stream: true }),
    })
  } catch (e) { callbacks.onError(`Network error: ${String(e)}`); return }
  if (!sfResponse.ok) {
    try { const err = await sfResponse.json() as { error?: { message?: string } }; callbacks.onError(err.error?.message ?? `Groq API error ${sfResponse.status}`) }
    catch { callbacks.onError(`Groq API error ${sfResponse.status}`) }
    return
  }
  const sfReader = sfResponse.body!.getReader(); const sfDecoder = new TextDecoder(); let sfFull = ''
  try {
    while (true) {
      const { done: sfDone, value: sfVal } = await sfReader.read(); if (sfDone) break
      for (const line of sfDecoder.decode(sfVal, { stream: true }).split('\n').filter(l => l.startsWith('data: '))) {
        const d = line.slice(6).trim(); if (d === '[DONE]') { callbacks.onDone(sfFull); return }
        try { const t = (JSON.parse(d) as { choices: { delta: { content?: string } }[] }).choices[0]?.delta?.content ?? ''; if (t) { sfFull += t; callbacks.onToken(t) } } catch { /**/ }
      }
    }
  } catch (e) { callbacks.onError(`Stream error: ${String(e)}`); return }
  callbacks.onDone(sfFull)
}

export async function analyzeSingleFileNotesWithGroq(
  apiKey: string,
  doc: DeltaDoc,
  keyField: string,
  viewFields: string[],
  workNotes: string,
  callbacks: GroqStreamCallbacks,
) {
  const sampleRows = doc.rows.slice(0, 10).map(r => {
    const vals = viewFields.slice(0, 4).map(f => `${f}="${r[f] ?? ''}"`)
    return `  ${r[keyField] ?? '?'}: ${vals.join(', ')}`
  }).join('\n')

  const prompt = `You are a senior data analyst reviewing an Excel file in the context of analyst work notes.

## File Information
- **File**: ${doc.fileName}
- **Total Rows**: ${doc.rows.length}
- **Key Field**: ${keyField}
- **Analyzed Columns**: ${viewFields.join(', ')}

## Sample Data
${sampleRows || '  (no data)'}

## Analyst Work Notes
${workNotes}

---

Analyze the data in the context of the analyst's work notes and provide a structured report:

## Executive Summary
2-3 sentences summarising the file content and the key points from the work notes.

## Key Observations
List 4-5 specific findings about the data, referencing actual field names and tying them to the work notes context.

## Risk & Impact Assessment
What is the significance of this data in light of the analyst's observations?

## Action Items
Prioritised list of actions based on this analysis. Format each as:
- **[High/Medium/Low]** Action to Owner/Team

## Recommendations
3-5 follow-up recommendations based on the combined data and work notes analysis.

Be specific. Reference actual field names and values from the data.`

  let snResponse: Response
  try {
    snResponse = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [
        { role: 'system', content: 'You are a senior data analyst. Provide structured, actionable analysis. Be specific and reference the actual data.' },
        { role: 'user', content: prompt },
      ], temperature: 0.3, max_tokens: 1600, stream: true }),
    })
  } catch (e) { callbacks.onError(`Network error: ${String(e)}`); return }
  if (!snResponse.ok) {
    try { const err = await snResponse.json() as { error?: { message?: string } }; callbacks.onError(err.error?.message ?? `Groq API error ${snResponse.status}`) }
    catch { callbacks.onError(`Groq API error ${snResponse.status}`) }
    return
  }
  const snReader = snResponse.body!.getReader(); const snDecoder = new TextDecoder(); let snFull = ''
  try {
    while (true) {
      const { done: snDone, value: snVal } = await snReader.read(); if (snDone) break
      for (const line of snDecoder.decode(snVal, { stream: true }).split('\n').filter(l => l.startsWith('data: '))) {
        const d = line.slice(6).trim(); if (d === '[DONE]') { callbacks.onDone(snFull); return }
        try { const t = (JSON.parse(d) as { choices: { delta: { content?: string } }[] }).choices[0]?.delta?.content ?? ''; if (t) { snFull += t; callbacks.onToken(t) } } catch { /**/ }
      }
    }
  } catch (e) { callbacks.onError(`Stream error: ${String(e)}`); return }
  callbacks.onDone(snFull)
}

// ── Rephrase work notes ────────────────────────────────────────────────────
export async function rephraseNotesWithGroq(
  apiKey: string,
  notes: string,
  callbacks: { onToken: (t: string) => void; onDone: (full: string) => void; onError: (err: string) => void },
): Promise<void> {
  const prompt = `You are a professional technical writer. Rephrase the analyst work notes below to be clearer, more structured, and professionally written. Preserve all original meaning and technical findings — only improve clarity, structure, and grammar. Do not add new information. Output the rephrased notes directly without any preamble.

Original notes:
${notes}`
  let rpFull = ''
  let rpRes: Response
  try {
    rpRes = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 800, stream: true }),
    })
  } catch (e) { callbacks.onError(`Network error: ${String(e)}`); return }
  if (!rpRes.ok) {
    try { const err = await rpRes.json() as { error?: { message?: string } }; callbacks.onError(err.error?.message ?? `Groq API error ${rpRes.status}`) }
    catch { callbacks.onError(`Groq API error ${rpRes.status}`) }
    return
  }
  const rpReader = rpRes.body!.getReader(); const rpDecoder = new TextDecoder()
  try {
    while (true) {
      const { done: rpDone, value: rpVal } = await rpReader.read(); if (rpDone) break
      for (const line of rpDecoder.decode(rpVal, { stream: true }).split('\n').filter(l => l.startsWith('data: '))) {
        const d = line.slice(6).trim(); if (d === '[DONE]') { callbacks.onDone(rpFull); return }
        try { const t = (JSON.parse(d) as { choices: { delta: { content?: string } }[] }).choices[0]?.delta?.content ?? ''; if (t) { rpFull += t; callbacks.onToken(t) } } catch { /**/ }
      }
    }
  } catch (e) { callbacks.onError(`Stream error: ${String(e)}`); return }
  callbacks.onDone(rpFull)
}

// ── Row-by-row structured analysis ──────────────────────────────────────────
export interface RowAnalysis {
  key: string
  analysis: string
  risk_level: 'High' | 'Medium' | 'Low' | 'None'
  flagged: boolean
  recommendation: string
}

export async function analyzeRowsWithGroq(
  apiKey: string,
  rows: Record<string, string>[],
  keyField: string,
  columns: string[],
  workNotes: string,
  callbacks: {
    onProgress: (current: number, total: number) => void
    onDone: (results: RowAnalysis[]) => void
    onError: (err: string) => void
  },
): Promise<void> {
  // ── Map-Reduce row analysis ────────────────────────────────────────────────
  // MAP  : split rows into small chunks → send each chunk to Groq in parallel
  // REDUCE: flatten ordered chunk results into a single RowAnalysis[]
  //
  // Guarantees: file always generates — failed chunks get placeholder rows.
  const CHUNK_SIZE  = 10   // small chunks → reliable JSON from model
  const CONCURRENCY = 4    // parallel API calls
  const MAX_RETRIES = 3

  const cappedRows = rows.slice(0, 500)
  const total = cappedRows.length
  if (total === 0) { callbacks.onProgress(0, 0); callbacks.onDone([]); return }

  // ── MAP phase: build chunk array ───────────────────────────────────────────
  const chunks: Record<string, string>[][] = []
  for (let i = 0; i < total; i += CHUNK_SIZE) chunks.push(cappedRows.slice(i, i + CHUNK_SIZE))

  let completed = 0
  const chunkResults: RowAnalysis[][] = new Array(chunks.length)

  async function processChunk(idx: number): Promise<void> {
    const chunk = chunks[idx]
    const allCols = [keyField, ...columns.filter(c => c !== keyField)]
    const chunkJson = chunk.map(r => {
      const obj: Record<string, string> = {}
      for (const col of allCols) obj[col] = r[col] ?? ''
      return obj
    })

    const prompt =
`You are a data analyst. Analyze each row below using the analyst context. Return ONLY a JSON array — no markdown, no code fences, no explanation.

ANALYST CONTEXT:
${workNotes}

KEY COLUMN: ${keyField}
COLUMNS: ${allCols.join(', ')}

ROWS (${chunk.length}):
${JSON.stringify(chunkJson, null, 2)}

Return exactly ${chunk.length} JSON objects:
[{"key":"<${keyField} value>","analysis":"<1-2 sentences specific to this row>","risk_level":"High|Medium|Low|None","flagged":true|false,"recommendation":"<actionable step>"}]`

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: 'system', content: 'Return ONLY a valid JSON array. No markdown. No code fences. No text outside the array.' },
              { role: 'user',   content: prompt },
            ],
            temperature: 0.1,
            max_tokens:  1800,
            stream:      false,
          }),
        })

        if (!res.ok) {
          if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 900 * (attempt + 1))); continue }
          throw new Error(`HTTP ${res.status}`)
        }

        const data    = await res.json() as { choices: { message: { content: string } }[] }
        let   content = data.choices?.[0]?.message?.content ?? ''
        // Strip markdown code fences if model wraps in ```json … ```
        content = content.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim()
        const match   = content.match(/\[[\s\S]*\]/)
        if (!match) throw new Error('No JSON array found in response')
        const parsed  = JSON.parse(match[0]) as RowAnalysis[]
        chunkResults[idx] = parsed
        completed += chunk.length
        callbacks.onProgress(Math.min(completed, total), total)
        return
      } catch {
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 700 * (attempt + 1)))
        }
      }
    }

    // ── Fallback after all retries: placeholder rows so file still generates ──
    chunkResults[idx] = chunk.map(r => ({
      key:            String(r[keyField] ?? ''),
      analysis:       'Analysis could not be completed for this row after retries.',
      risk_level:     'None' as const,
      flagged:        false,
      recommendation: 'Manual review required.',
    }))
    completed += chunk.length
    callbacks.onProgress(Math.min(completed, total), total)
  }

  // ── REDUCE phase: process chunks in parallel batches, preserve order ───────
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(
      chunks.slice(i, i + CONCURRENCY).map((_, j) => processChunk(i + j))
    )
  }

  callbacks.onProgress(total, total)
  callbacks.onDone(chunkResults.flat())
}

// ── Playbook Flow (SOAR Builder) ─────────────────────────────────────────────

export interface FlowNode {
  id: string
  type: 'trigger' | 'action' | 'condition' | 'notification' | 'end'
  label: string
  description: string
  tool?: string
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  label?: string
}

export interface PlaybookFlow {
  name: string
  description: string
  trigger: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export async function generatePlaybookFlow(
  apiKey: string,
  planText: string,
  callbacks: {
    onDone: (flow: PlaybookFlow) => void
    onError: (err: string) => void
  }
): Promise<void> {
  const systemPrompt = `You are a SOAR expert. Parse the security response plan and return a structured playbook as JSON only (no markdown, no explanation).

Return this exact JSON structure:
{
  "name": "short playbook name (3-5 words)",
  "description": "one-sentence description",
  "trigger": "what triggers this playbook",
  "nodes": [
    { "id": "n1", "type": "trigger", "label": "Alert Received", "description": "Brief what happens", "tool": "SIEM" },
    { "id": "n2", "type": "action", "label": "Extract IOCs", "description": "Brief what happens", "tool": "Toolname" },
    { "id": "n3", "type": "condition", "label": "Is Malicious?", "description": "Brief what happens", "tool": "VirusTotal" },
    { "id": "n4", "type": "action", "label": "Block Threat", "description": "Brief what happens", "tool": "Firewall" },
    { "id": "n5", "type": "notification", "label": "Notify SOC", "description": "Brief what happens", "tool": "Slack" },
    { "id": "n6", "type": "end", "label": "Close Case", "description": "Brief what happens", "tool": "ServiceNow" }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2" },
    { "id": "e2", "from": "n2", "to": "n3" },
    { "id": "e3", "from": "n3", "to": "n4", "label": "Yes" },
    { "id": "e4", "from": "n3", "to": "n5", "label": "No" },
    { "id": "e5", "from": "n4", "to": "n5" },
    { "id": "e6", "from": "n5", "to": "n6" }
  ]
}

Rules:
- Exactly 1 trigger node (first) and 1 end node (last)
- Condition nodes MUST have exactly 2 outgoing edges labeled "Yes" and "No"
- 6 to 14 nodes total, no cycles, labels max 4 words
- All node ids must be referenced consistently in edges`

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a playbook flow for:\n\n${planText}` },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      callbacks.onError(`Groq API error ${res.status}: ${errText}`)
      return
    }

    const data = await res.json()
    const content: string = data.choices?.[0]?.message?.content ?? ''
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()
    const flow = JSON.parse(cleaned) as PlaybookFlow
    callbacks.onDone(flow)
  } catch (err) {
    callbacks.onError(String(err))
  }
}

// ── Security Architect AI Assist (streaming) ─────────────────────────────────
export async function assistArchitectTask(
  apiKey: string,
  taskTitle: string,
  systemPrompt: string,
  userContext: string,
  callbacks: {
    onToken: (token: string) => void
    onDone: () => void
    onError: (err: string) => void
  }
): Promise<void> {
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        temperature: 0.4,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Task: ${taskTitle}\n\nContext provided:\n${userContext || '(No additional context provided — use general best practices)'}`,
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      callbacks.onError(`Groq API error ${res.status}: ${errText}`)
      return
    }

    const reader = res.body?.getReader()
    if (!reader) { callbacks.onError('No response body'); return }
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const trimmed = line.replace(/^data: /, '').trim()
        if (!trimmed || trimmed === '[DONE]') continue
        try {
          const json = JSON.parse(trimmed)
          const token = json.choices?.[0]?.delta?.content ?? ''
          if (token) callbacks.onToken(token)
        } catch { /* skip malformed */ }
      }
    }
    callbacks.onDone()
  } catch (err) {
    callbacks.onError(String(err))
  }
}
