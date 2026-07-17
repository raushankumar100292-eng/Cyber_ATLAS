const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

export interface StreamCallbacks {
  onToken: (token: string) => void
  onDone: (full: string) => void
  onError: (err: string) => void
}

async function streamGroq(
  apiKey: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  callbacks: StreamCallbacks,
  temperature = 0.2,
) {
  let response: Response
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: maxTokens, stream: true }),
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
      for (const line of chunk.split('\n').filter(l => l.startsWith('data: '))) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') { callbacks.onDone(full); return }
        try {
          const json = JSON.parse(data) as { choices: { delta: { content?: string } }[] }
          const token = json.choices[0]?.delta?.content ?? ''
          if (token) { full += token; callbacks.onToken(token) }
        } catch { /* partial chunk */ }
      }
    }
  } catch (e) { callbacks.onError(`Stream error: ${String(e)}`); return }
  callbacks.onDone(full)
}

// ── Field mappings injected into conversion prompts ───────────────────────────

const FIELD_MAPPING_CONTEXT = `
Common field mappings (Splunk CIM → Sentinel ASIM → QRadar AQL):
_time → TimeGenerated | host → Computer | sourcetype → SourceSystem
src_ip → SrcIpAddr / SourceIP | dest_ip → DstIpAddr / DestinationIP
src_port → SrcPortNumber | dest_port → DstPortNumber
protocol → NetworkProtocol | bytes_in → ReceivedBytes | bytes_out → SentBytes
user/src_user → AccountName / SubjectUserName | dest_user → TargetUserName
domain → SubjectDomainName | action → EventResult
process → CommandLine | process_name → Process | parent_process → ParentProcessName
pid → ProcessId | file_path → FilePath | file_name → FileName | file_hash → FileHash
url → RequestURL | uri_path → FilePath | http_method → RequestMethod
http_status → EventResultDetails | user_agent → HttpUserAgent
EventCode → EventID | registry_key_name → RegistryKey | registry_value_name → RegistryValueName
query (DNS) → DnsQuery | answer (DNS) → DnsResponseName
src_user (email) → SenderFromAddress | recipient → RecipientEmailAddress | subject → EmailSubject
`

// ── Conversion ────────────────────────────────────────────────────────────────

export type ConversionDirection =
  | 'spl-to-kql' | 'aql-to-kql' | 'kql-to-spl'
  | 'kql-to-aql' | 'sigma-to-kql' | 'sigma-to-spl'

export const DIRECTION_META: Record<ConversionDirection, { source: string; target: string; sourceLang: string; targetLang: string }> = {
  'spl-to-kql':   { source: 'Splunk SPL',      target: 'KQL (Sentinel)',  sourceLang: 'spl',   targetLang: 'kql'   },
  'aql-to-kql':   { source: 'QRadar AQL',      target: 'KQL (Sentinel)',  sourceLang: 'aql',   targetLang: 'kql'   },
  'kql-to-spl':   { source: 'KQL (Sentinel)',   target: 'Splunk SPL',      sourceLang: 'kql',   targetLang: 'spl'   },
  'kql-to-aql':   { source: 'KQL (Sentinel)',   target: 'QRadar AQL',      sourceLang: 'kql',   targetLang: 'aql'   },
  'sigma-to-kql': { source: 'Sigma YAML',       target: 'KQL (Sentinel)',  sourceLang: 'sigma', targetLang: 'kql'   },
  'sigma-to-spl': { source: 'Sigma YAML',       target: 'Splunk SPL',      sourceLang: 'sigma', targetLang: 'spl'   },
}

export async function streamConversion(
  apiKey: string,
  direction: ConversionDirection,
  query: string,
  customRulesText: string,
  callbacks: StreamCallbacks,
) {
  const { source, target } = DIRECTION_META[direction]
  const system = `You are an expert security detection engineer specializing in SIEM query translation.
Convert ${source} queries to ${target} with full semantic accuracy.

${FIELD_MAPPING_CONTEXT}

${customRulesText ? `Custom Translation Rules:\n${customRulesText}` : ''}

Respond EXACTLY in this format — nothing else:

\`\`\`
[TRANSLATED QUERY HERE]
\`\`\`

CONFIDENCE: [HIGH|MEDIUM|LOW]
REASON: [One sentence]

WARNINGS:
- [Issue or note, one per line. Write "None" if no warnings.]`

  await streamGroq(apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: `Convert this ${source} query:\n\n${query}` },
  ], 2048, callbacks)
}

// ── Rule Generation ───────────────────────────────────────────────────────────

export type RuleLanguage = 'kql' | 'spl' | 'aql' | 'sigma' | 'yara-l'

export const LANG_LABELS: Record<RuleLanguage, string> = {
  kql: 'KQL (Microsoft Sentinel)',
  spl: 'Splunk SPL',
  aql: 'IBM QRadar AQL',
  sigma: 'Sigma YAML',
  'yara-l': 'YARA-L (Chronicle)',
}

export interface RuleGenParams {
  useCaseName: string
  description: string
  logSource: string
  detectionCategory: string
  language: RuleLanguage
}

export async function streamRuleGeneration(
  apiKey: string,
  params: RuleGenParams,
  callbacks: StreamCallbacks,
) {
  const system = `You are a senior detection engineer. Generate production-ready ${LANG_LABELS[params.language]} detection rules.
Include: title, description, author, date, MITRE ATT&CK tags, tuning comments, realistic field names.
Output ONLY the rule in a single code block — no prose.`

  const user = `Generate a ${LANG_LABELS[params.language]} detection rule:
Use Case: ${params.useCaseName}
Description: ${params.description}
Log Source: ${params.logSource}
Detection Category: ${params.detectionCategory}

Include MITRE technique ID in comments/metadata. Make it production-ready with realistic thresholds and whitelist examples.`

  await streamGroq(apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 3000, callbacks)
}

// ── Rule Metadata ─────────────────────────────────────────────────────────────

export interface RuleMetadata {
  mitreId: string
  mitreTactic: string
  severity: string
  priority: string
  falsePositives: string[]
  investigationSteps: string[]
  responseActions: string[]
}

export async function streamRuleMetadata(
  apiKey: string,
  rule: string,
  language: RuleLanguage,
  callbacks: StreamCallbacks,
) {
  const system = `You are a detection engineering analyst. Analyze detection rules and output structured metadata as valid JSON only.`
  const user = `Analyze this ${LANG_LABELS[language]} rule and respond with ONLY this JSON (no markdown, no prose):
${rule}

{
  "mitreId": "T1XXX.XXX",
  "mitreTactic": "Tactic Name",
  "severity": "High",
  "priority": "P2",
  "falsePositives": ["example1", "example2"],
  "investigationSteps": ["step1", "step2", "step3"],
  "responseActions": ["action1", "action2"]
}`

  await streamGroq(apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 800, callbacks, 0.1)
}

// ── Integration Doc Generator ────────────────────────────────────────────────

export interface IntDocParams {
  sourceSystem: string
  destinationSystem: string
  integrationMethod: string
  keySteps?: string
  configFields?: string
  additionalNotes?: string
}

export async function streamIntDocGeneration(
  apiKey: string,
  params: IntDocParams,
  callbacks: StreamCallbacks,
) {
  const system = `You are a senior integration engineer writing professional technical documentation.
Generate a step-by-step integration guide in clean Markdown. Structure every guide exactly like this:

# {Source} to {Destination} Integration
## Via {Method}

---

## Step 1: Prerequisites
- bullet
- bullet

## Step 2: [Meaningful Title]
Short description paragraph.
- bullet
- bullet

If configuration values are needed, add a table:
| Field | Value / Example |
|-------|----------------|
| key   | value          |

Continue for 4–6 total steps. Always end with:
## Step N: Testing & Validation
How to verify the integration is working correctly.

Rules:
- Use real, specific values and realistic examples
- Be concise but complete
- No introductory prose before the # heading
- Markdown only — no JSON, no raw text blocks`

  const user = `Source System: ${params.sourceSystem}
Destination System: ${params.destinationSystem}
Integration Method: ${params.integrationMethod}
${params.keySteps ? `Key Steps / Notes: ${params.keySteps}` : ''}
${params.configFields ? `Configuration Fields:\n${params.configFields}` : ''}
${params.additionalNotes ? `Additional Notes: ${params.additionalNotes}` : ''}

Generate the integration guide now.`

  await streamGroq(apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], 3000, callbacks)
}

// ── AI Assistant ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantParams {
  language: RuleLanguage
  currentRule: string
  instruction: string
  history: ChatMessage[]
}

// ── Prompt Engineering ────────────────────────────────────────────────────────

export type RephraseStyle = 'clearer' | 'concise' | 'detailed' | 'formal' | 'chain-of-thought' | 'few-shot'

export const REPHRASE_STYLE_META: Record<RephraseStyle, { label: string; description: string }> = {
  'clearer':          { label: 'Clearer',           description: 'Improve clarity and remove ambiguity'          },
  'concise':          { label: 'Concise',            description: 'Shorten without losing meaning'                },
  'detailed':         { label: 'Detailed',           description: 'Expand with more context and specifics'        },
  'formal':           { label: 'Formal',             description: 'Professional tone, precise language'           },
  'chain-of-thought': { label: 'Chain-of-Thought',   description: 'Add step-by-step reasoning instructions'      },
  'few-shot':         { label: 'Few-Shot Ready',     description: 'Restructure to include example slots'          },
}

export async function streamRephrasePrompt(
  apiKey: string,
  params: { prompt: string; style: RephraseStyle; context?: string },
  callbacks: StreamCallbacks,
) {
  const styleGuide: Record<RephraseStyle, string> = {
    'clearer':          'Rewrite to be unambiguous and easy to understand. Remove vague terms, define what you want clearly.',
    'concise':          'Condense the prompt to its essential intent. Remove redundancy and unnecessary filler.',
    'detailed':         'Expand with richer context: specify format, constraints, tone, output structure, and any relevant background.',
    'formal':           'Rewrite in a professional, precise tone. Avoid colloquialisms. Use structured language.',
    'chain-of-thought': 'Restructure so the AI is asked to reason step-by-step before giving its final answer. Add "Think through this step by step:" phrasing.',
    'few-shot':         'Restructure to include 1-2 clearly labelled example slots (Example 1: ..., Example 2: ...) followed by the actual task.',
  }
  const system = `You are an expert prompt engineer who specialises in crafting high-quality LLM prompts.
Your task: rephrase the user's prompt using the following style guideline.

Style: ${REPHRASE_STYLE_META[params.style].label}
Guideline: ${styleGuide[params.style]}

Rules:
- Preserve the original intent exactly — only change structure/wording/depth
- Output ONLY the rephrased prompt with no preamble, labels, or explanation
- Do not wrap in quotes or markdown code blocks
${params.context ? `\nAdditional context about what the prompt is for: ${params.context}` : ''}`

  await streamGroq(apiKey, [
    { role: 'system', content: system },
    { role: 'user',   content: params.prompt },
  ], 2000, callbacks, 0.4)
}

export async function streamAssistantChat(
  apiKey: string,
  params: AssistantParams,
  callbacks: StreamCallbacks,
) {
  const system = `You are an expert detection engineering assistant specializing in ${LANG_LABELS[params.language]}.
When modifying a rule, respond in this exact format:

## Updated Rule
\`\`\`
[COMPLETE updated rule — not a diff, the full rule]
\`\`\`

## Changes Made
- [Bullet list of specific changes and reasoning]`

  await streamGroq(apiKey, [
    { role: 'system', content: system },
    ...params.history,
    {
      role: 'user',
      content: `Current rule:\n\`\`\`\n${params.currentRule}\n\`\`\`\n\nInstruction: ${params.instruction}`,
    },
  ], 3000, callbacks)
}
