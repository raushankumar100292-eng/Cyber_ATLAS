import type { AgentDefinition } from '../types'

const def: AgentDefinition = {
  id: 'network-investigator',
  name: 'Network Investigator',
  description:
    'Investigates network-layer threats: C2 beaconing, data exfiltration, lateral movement, port scanning, DNS tunneling, and protocol abuse.',
  capabilities: [
    { id: 'network_traffic_analysis',   description: 'Analyze packet flows, NetFlow/IPFIX, connection metadata', confidence: 0.95 },
    { id: 'dns_analysis',              description: 'Detect DNS tunneling, DGA domains, C2-over-DNS, suspicious query patterns', confidence: 0.92 },
    { id: 'c2_detection',              description: 'Detect C2 beaconing: jitter, interval regularity, JA3/JA3S matching', confidence: 0.92 },
    { id: 'exfiltration_detection',    description: 'Detect large outbound transfers, DNS exfil, cloud upload anomalies', confidence: 0.90 },
    { id: 'lateral_movement_detection',description: 'Trace host-to-host lateral movement: RDP chains, SMB traversal, PtH', confidence: 0.88 },
    { id: 'port_scan_detection',       description: 'Identify network reconnaissance: SYN sweeps, service enumeration, masscan/nmap signatures', confidence: 0.92 },
    { id: 'ioc_extraction',           description: 'Extract IP addresses, domain names, URL indicators from network traffic', confidence: 0.85 },
    { id: 'attack_chain_analysis',    description: 'Reconstruct network-side attack chain from flow/log data', confidence: 0.78 },
  ],
  handlesUseCases: ['c2', 'exfil', 'lateral', 'recon'],
  systemPrompt: `You are a Network Investigator specialized in network-layer threat analysis.

Your scope: C2 communications, data exfiltration, lateral movement, reconnaissance scanning, DNS abuse, and protocol anomalies.

When given an investigation task you MUST:
1. Analyze source/destination IPs, ports, and protocols for anomalies.
2. Check for C2 beaconing patterns: regular intervals, jitter, unusual User-Agents or JA3 hashes.
3. Inspect DNS queries for tunneling (high entropy, long subdomains, unusual record types).
4. Assess data volume and direction for exfiltration indicators.
5. Trace lateral movement paths using authentication logs and SMB/RDP connections.
6. Identify scanning patterns: sequential host or port sweeps.
7. Extract network IOCs: IPs, domains, URLs, port/protocol combinations.
8. Map observed techniques to MITRE ATT&CK.
9. Produce a structured finding with verdict, confidence, attack chain, and network-level remediation.

Return structured JSON matching the InsightAnalysis schema.`,
  display: {
    label:      'Network Agent',
    shortLabel: 'NET',
    color:      '#00e5ff',
    icon:       '◎',
  },
  version: '1.0.0',
  enabled: true,
}

export default def
