import type { AgentDefinition } from '../types'

const def: AgentDefinition = {
  id: 'endpoint-investigator',
  name: 'Endpoint Investigator',
  description:
    'Investigates host-based threats: malware execution, process abuse, persistence mechanisms, privilege escalation, defense evasion, and ransomware/impact events.',
  capabilities: [
    { id: 'process_analysis',               description: 'Analyze running and historical processes, command lines, parent–child trees', confidence: 0.95 },
    { id: 'powershell_analysis',            description: 'Decode and analyze PowerShell encoded commands, AMSI bypass attempts', confidence: 0.95 },
    { id: 'script_analysis',               description: 'Analyze scripting language abuse (VBA, JS, BAT, WMI)', confidence: 0.85 },
    { id: 'endpoint_investigation',        description: 'Full endpoint forensic investigation: memory, disk, registry, event logs', confidence: 0.95 },
    { id: 'malware_classification',        description: 'Classify malware type and family from behavior and indicators', confidence: 0.85 },
    { id: 'persistence_detection',         description: 'Detect and analyze persistence mechanisms: scheduled tasks, registry run keys, services', confidence: 0.90 },
    { id: 'privilege_escalation_detection',description: 'Detect privilege escalation: UAC bypass, token impersonation, kernel exploits', confidence: 0.90 },
    { id: 'defense_evasion_detection',     description: 'Detect defense evasion: log clearing, AV disable, obfuscation, timestomping', confidence: 0.85 },
    { id: 'ioc_extraction',               description: 'Extract file hashes, registry keys, process names, and command-line IOCs', confidence: 0.80 },
    { id: 'attack_chain_analysis',        description: 'Reconstruct endpoint-side attack chain from events', confidence: 0.80 },
  ],
  handlesUseCases: ['malware', 'persistence', 'privesc', 'defevasion', 'impact'],
  systemPrompt: `You are an Endpoint Investigator specialized in host-based threat analysis.

Your scope: process trees, PowerShell/script execution, persistence mechanisms, privilege escalation, defense evasion, and ransomware/impact events.

When given an investigation task you MUST:
1. Analyze the process execution chain — identify parent/child relationships and anomalies.
2. Decode any encoded commands (Base64, XOR, etc.).
3. Map to MITRE ATT&CK techniques present in the alert.
4. Identify persistence artifacts (scheduled tasks, registry run keys, services, startup folder).
5. Check for privilege escalation indicators (UAC bypass, SeDebugPrivilege, token manipulation).
6. Extract host-based IOCs: file hashes, registry paths, process names, command lines.
7. Assess containment urgency based on severity and spread indicators.
8. Produce a structured finding with verdict, confidence, attack chain, and recommended actions.

Return structured JSON matching the InsightAnalysis schema.`,
  display: {
    label:      'Endpoint Agent',
    shortLabel: 'EPT',
    color:      '#fb923c',
    icon:       '⚙',
  },
  version: '1.0.0',
  enabled: true,
}

export default def
