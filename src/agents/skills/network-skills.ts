import type { SkillDefinition } from './types'

const AGENT = 'network-investigator'

export const networkSkills: SkillDefinition[] = [
  {
    id: 'network:connection-analysis',
    agentId: AGENT,
    name: 'Connection Metadata Analysis',
    description: 'Analyze source/destination IPs, ports, and public vs. private exposure.',
    capabilities: ['network_traffic_analysis'],
    investigationGuidance: 'Extract src/dst IPs and port. Flag public destinations. Note high-risk ports. IP reputation requires external tool.',
    evidencePatterns: ['outbound', 'inbound', 'connection', 'traffic', 'port'],
  },
  {
    id: 'network:c2-analysis',
    agentId: AGENT,
    name: 'C2 Communication Analysis',
    description: 'Detect C2 beaconing, known C2 ports, and non-standard HTTPS tunnels.',
    capabilities: ['c2_detection', 'network_traffic_analysis'],
    investigationGuidance: 'Beacon/jitter/interval = strong indicators. Known C2 ports: 4444, 1337, 31337. Non-standard HTTPS (8080, 8443) = suspicious. Two indicators = confirmed.',
    evidencePatterns: ['beacon', 'jitter', 'interval', 'c2', 'ja3', 'command and control', 'long-lived', 'keep-alive', 'heartbeat', 'callback'],
  },
  {
    id: 'network:dns-analysis',
    agentId: AGENT,
    name: 'DNS Tunneling / DGA Analysis',
    description: 'Detect DNS tunneling and algorithmically-generated domain names.',
    capabilities: ['dns_analysis', 'c2_detection'],
    investigationGuidance: 'Long hostname labels (>20 chars) = possible DGA. Suspicious TLDs (.xyz, .tk, .ru). DNS keywords in evidence = OBSERVED. TLD/label = INFERRED.',
    evidencePatterns: ['dns', 'nxdomain', 'tunnel', 'high entropy', 'dga', 'subdomain', 'base64 query', 'long query'],
  },
  {
    id: 'network:exfiltration-analysis',
    agentId: AGENT,
    name: 'Data Exfiltration Analysis',
    description: 'Detect large data transfers and exfiltration patterns.',
    capabilities: ['exfiltration_detection', 'network_traffic_analysis'],
    investigationGuidance: 'Look for GB/MB volume references, bulk/mass transfer keywords, outbound data to public IPs. Confirm volume with SIEM NetFlow.',
    evidencePatterns: ['exfil', 'gb', 'mb transferred', 'large', 'outbound', 'upload', 'bulk', 'data transfer'],
  },
  {
    id: 'network:lateral-movement-analysis',
    agentId: AGENT,
    name: 'Lateral Movement Detection',
    description: 'Detect RDP, SMB, pass-the-hash, and PsExec lateral movement patterns.',
    capabilities: ['lateral_movement_detection', 'network_traffic_analysis', 'credential_analysis'],
    investigationGuidance: 'RDP (port 3389), SMB admin shares (IPC$), PsExec, WMIC remote. Pass-the-hash via NTLM relay.',
    evidencePatterns: ['rdp', '3389', 'pass-the-hash', 'pth', 'lateral', 'psexec', 'wmic', 'smb', 'admin share', 'ipc$'],
  },
  {
    id: 'network:port-scan-analysis',
    agentId: AGENT,
    name: 'Network Reconnaissance / Port Scan',
    description: 'Detect nmap/masscan port scanning and network enumeration.',
    capabilities: ['port_scan_detection', 'network_traffic_analysis'],
    investigationGuidance: 'Scan/sweep/enumerate keywords, nmap/masscan tool names, references to large port counts.',
    evidencePatterns: ['scan', 'sweep', 'enumerate', 'discovery', 'masscan', 'nmap', '1,024 port'],
  },
]
