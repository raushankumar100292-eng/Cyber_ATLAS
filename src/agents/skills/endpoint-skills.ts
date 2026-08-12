import type { SkillDefinition } from './types'

const AGENT = 'endpoint-investigator'

export const endpointSkills: SkillDefinition[] = [
  {
    id: 'endpoint:process-analysis',
    agentId: AGENT,
    name: 'Process Analysis',
    description: 'Inspect process names and execution context for LOLBins, masquerading, and suspicious parent-child patterns.',
    capabilities: ['process_analysis', 'endpoint_investigation'],
    investigationGuidance: 'Check source process against known-suspicious list. Flag LOLBins. Note whether parent is benign system process.',
    evidencePatterns: ['lolbin', 'masquerad', 'parent process', 'child process', 'rundll32', 'regsvr32', 'mshta', 'certutil'],
  },
  {
    id: 'endpoint:powershell-analysis',
    agentId: AGENT,
    name: 'PowerShell / Script Analysis',
    description: 'Detect obfuscated PowerShell, AMSI bypass, and encoded command execution.',
    capabilities: ['powershell_analysis', 'script_analysis'],
    investigationGuidance: 'Scan for -EncodedCommand, Invoke-Expression, AMSI disable patterns. Encoded commands = high-confidence evasion.',
    evidencePatterns: ['powershell', '-enc', 'encodedcommand', 'invoke-expression', 'iex', 'bypass', 'amsi', 'downloadstring', 'frombase64string', 'reflection'],
  },
  {
    id: 'endpoint:ransomware-analysis',
    agentId: AGENT,
    name: 'Ransomware Analysis',
    description: 'Identify ransomware: file extension changes, shadow copy deletion, recovery destruction.',
    capabilities: ['malware_classification', 'endpoint_investigation'],
    investigationGuidance: 'Look for .locked/.encrypted, vssadmin delete shadows, bcdedit /set recoveryenabled no. Two+ indicators = high-confidence ransomware.',
    evidencePatterns: ['.locked', '.encrypted', 'shadow cop', 'vssadmin', 'bcdedit', 'ransom', 'decrypt', 'wbadmin'],
  },
  {
    id: 'endpoint:malware-classification',
    agentId: AGENT,
    name: 'Malware / Injection Classification',
    description: 'Classify fileless execution, code injection, and process hollowing behavior.',
    capabilities: ['malware_classification'],
    investigationGuidance: 'Identify: DLL injection, reflective loading, process hollowing, shellcode. Confirm with EDR.',
    evidencePatterns: ['dll injection', 'reflective', 'shellcode', 'hollowing', 'process injection', 'fileless'],
  },
  {
    id: 'endpoint:persistence-analysis',
    agentId: AGENT,
    name: 'Persistence Detection',
    description: 'Detect scheduled tasks, registry run keys, and service creation for persistence.',
    capabilities: ['persistence_detection', 'endpoint_investigation'],
    investigationGuidance: 'Check schtasks, registry HKLM/HKCU run keys, new service creation, startup folder modifications.',
    evidencePatterns: ['scheduled task', 'schtasks', 'run key', 'hklm', 'hkcu', 'autostart', 'startup folder', 'new service', 'sc create', 'at.exe'],
  },
  {
    id: 'endpoint:privilege-escalation-analysis',
    agentId: AGENT,
    name: 'Privilege Escalation Analysis',
    description: 'Detect UAC bypass and token manipulation techniques.',
    capabilities: ['privilege_escalation_detection'],
    investigationGuidance: 'Look for UAC bypass LOLBins (fodhelper, eventvwr, sdclt), SeDebugPrivilege, token impersonation.',
    evidencePatterns: ['uac bypass', 'fodhelper', 'eventvwr', 'sdclt', 'token impersonation', 'sedebugprivilege', 'seimpersonateprivilege', 'bypassuac', 'elevated'],
  },
  {
    id: 'endpoint:defense-evasion-analysis',
    agentId: AGENT,
    name: 'Defense Evasion Analysis',
    description: 'Detect log clearing, AV disabling, and obfuscation techniques.',
    capabilities: ['defense_evasion_detection'],
    investigationGuidance: 'Scan for wevtutil log clear, AMSI bypass, Defender disable, base64/XOR encoding patterns.',
    evidencePatterns: ['log cleared', 'wevtutil', 'event id 1102', 'amsi bypass', 'defender disabled', 'real-time protection', 'obfuscat', 'base64', 'xor encoded'],
  },
]
