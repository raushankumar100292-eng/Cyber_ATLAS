// ─────────────────────────────────────────────────────────────────────────────
// Industry Knowledge Base — the curated moat.
//
// Maps each supported industry to its real-world security posture: the threat
// actors that target it, the log sources it typically runs, and the MITRE ATT&CK
// techniques most relevant to its threat profile. This is grounded reference data
// (ATT&CK technique IDs + sector threat intelligence), NOT LLM guessing — it is
// the baseline the analysis compares a client's uploaded coverage against.
//
// Keys match the `value` field of the industry selector in UploadPanel.
// Technique IDs are enterprise ATT&CK so they join against uploaded coverage
// (sub-technique ids like T1566.001 match their base T1566 and vice-versa).
// ─────────────────────────────────────────────────────────────────────────────

export interface IndustryTechnique {
  id: string      // MITRE ATT&CK (enterprise) technique id, e.g. 'T1566'
  name: string
  tactic: string  // MITRE tactic name
  why: string     // why it matters for THIS sector (short, grounded)
}

export interface IndustryProfile {
  key: string
  label: string
  summary: string           // one-line sector posture
  threatProfile: string     // 2–3 sentences: who targets it and why
  topThreatActors: string[] // named actor types / groups relevant to the sector
  logSources: string[]      // log sources a mature SOC in this sector should run
  priorityTactics: string[] // MITRE tactics most relevant to the sector
  techniques: IndustryTechnique[]
}

// ── The knowledge base ─────────────────────────────────────────────────────────
export const INDUSTRY_KB: Record<string, IndustryProfile> = {
  financial: {
    key: 'financial',
    label: 'Financial Services & Banking',
    summary: 'High-value target for financially motivated crime and fraud; heavily regulated (PCI-DSS, SOX).',
    threatProfile:
      'Banks and financial institutions face relentless financially-motivated attacks — ransomware, business email compromise, and direct theft via payment/SWIFT systems. Nation-state actors also target them for economic espionage and sanctions evasion.',
    topThreatActors: ['FIN7', 'FIN8', 'Lazarus Group', 'TA505', 'Cobalt Group', 'Carbanak'],
    logSources: ['Windows Security / AD', 'EDR', 'Core banking app logs', 'SWIFT / payment gateway logs', 'Web proxy', 'Firewall / netflow', 'DLP', 'Identity provider (SSO/MFA)'],
    priorityTactics: ['Initial Access', 'Credential Access', 'Collection', 'Exfiltration', 'Impact'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Primary vector for BEC and credential theft against finance staff.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Stolen banking/admin creds enable fraud and wire manipulation.' },
      { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', why: 'Credential stuffing against customer and employee portals.' },
      { id: 'T1114', name: 'Email Collection', tactic: 'Collection', why: 'BEC actors harvest mailboxes to hijack payment threads.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware crews prioritise banks for high ransoms.' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', why: 'Theft of cardholder / account data.' },
      { id: 'T1071', name: 'Application Layer Protocol', tactic: 'Command and Control', why: 'C2 blends into heavy HTTPS/API traffic.' },
      { id: 'T1567', name: 'Exfiltration Over Web Service', tactic: 'Exfiltration', why: 'Data pushed to attacker cloud storage to evade DLP.' },
    ],
  },

  healthcare: {
    key: 'healthcare',
    label: 'Healthcare & Life Sciences',
    summary: 'PHI-rich and availability-critical; ransomware directly endangers patient care (HIPAA).',
    threatProfile:
      'Hospitals and life-science firms are prime ransomware targets because downtime threatens patient safety, pressuring fast payment. Legacy medical devices and flat networks widen the attack surface; IP theft of research/clinical-trial data draws nation-state interest.',
    topThreatActors: ['Ryuk / Conti operators', 'ALPHV/BlackCat', 'APT41', 'Lazarus Group', 'Vice Society'],
    logSources: ['Windows Security / AD', 'EDR', 'EHR / EMR audit logs', 'Medical device (IoMT) telemetry', 'VPN / remote access', 'Email gateway', 'Firewall / netflow', 'DNS'],
    priorityTactics: ['Initial Access', 'Lateral Movement', 'Impact', 'Exfiltration'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Top entry vector into clinical networks.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware halting care is the defining sector threat.' },
      { id: 'T1490', name: 'Inhibit System Recovery', tactic: 'Impact', why: 'Actors delete backups to force ransom payment.' },
      { id: 'T1210', name: 'Exploitation of Remote Services', tactic: 'Lateral Movement', why: 'Flat networks + legacy devices enable rapid spread.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Shared clinical logins are widely abused.' },
      { id: 'T1005', name: 'Data from Local System', tactic: 'Collection', why: 'PHI harvested from endpoints and shares.' },
      { id: 'T1071', name: 'Application Layer Protocol', tactic: 'Command and Control', why: 'C2 over common protocols on under-monitored subnets.' },
    ],
  },

  technology: {
    key: 'technology',
    label: 'Technology & Software',
    summary: 'Targeted for source code, cloud infrastructure, and as a supply-chain pivot to customers.',
    threatProfile:
      'Software and cloud firms are attacked for source code, secrets, and access that can be weaponised downstream into supply-chain compromises. Cloud misconfigurations, exposed CI/CD, and developer credential theft are the dominant risks.',
    topThreatActors: ['APT29 (Cozy Bear)', 'Lapsus$', 'Scattered Spider', 'APT41'],
    logSources: ['Cloud audit (CloudTrail/Azure/GCP)', 'CI/CD pipeline logs', 'Source control (Git) audit', 'Identity provider (SSO/MFA)', 'EDR', 'Kubernetes / container logs', 'Secrets manager access', 'Web proxy'],
    priorityTactics: ['Initial Access', 'Credential Access', 'Persistence', 'Exfiltration'],
    techniques: [
      { id: 'T1195', name: 'Supply Chain Compromise', tactic: 'Initial Access', why: 'Tech vendors are pivots into their entire customer base.' },
      { id: 'T1552', name: 'Unsecured Credentials', tactic: 'Credential Access', why: 'Secrets in code/CI are a leading breach cause.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Developer/cloud creds grant broad access.' },
      { id: 'T1098', name: 'Account Manipulation', tactic: 'Persistence', why: 'Adding keys/OAuth grants for durable cloud access.' },
      { id: 'T1528', name: 'Steal Application Access Token', tactic: 'Credential Access', why: 'OAuth token theft bypasses MFA in SaaS.' },
      { id: 'T1567', name: 'Exfiltration Over Web Service', tactic: 'Exfiltration', why: 'Source code pushed to attacker-controlled repos.' },
      { id: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', why: 'Abuse of build agents and cloud shells.' },
    ],
  },

  retail: {
    key: 'retail',
    label: 'Retail & E-Commerce',
    summary: 'Payment-card and PII target; web-skimming (Magecart) and POS malware dominate (PCI-DSS).',
    threatProfile:
      'Retail is hunted for payment-card data via POS malware and web-skimming of e-commerce checkout. Seasonal traffic spikes are exploited for fraud and DDoS extortion, and third-party plugins expand the attack surface.',
    topThreatActors: ['Magecart groups', 'FIN7', 'FIN6', 'Carbanak'],
    logSources: ['E-commerce app / web server logs', 'POS terminal logs', 'WAF / CDN', 'Payment gateway logs', 'EDR', 'Web proxy', 'Firewall / netflow', 'DNS'],
    priorityTactics: ['Initial Access', 'Collection', 'Exfiltration', 'Impact'],
    techniques: [
      { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', why: 'Checkout/plugin exploits inject card skimmers.' },
      { id: 'T1059.007', name: 'JavaScript', tactic: 'Execution', why: 'Magecart skimmers run in the browser at checkout.' },
      { id: 'T1005', name: 'Data from Local System', tactic: 'Collection', why: 'POS RAM scraping of card data.' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', why: 'Scraped card data beaconed to attacker infra.' },
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Entry into corporate/POS management networks.' },
      { id: 'T1498', name: 'Network Denial of Service', tactic: 'Impact', why: 'DDoS extortion during peak shopping periods.' },
    ],
  },

  manufacturing: {
    key: 'manufacturing',
    label: 'Manufacturing & Industrial',
    summary: 'IT/OT convergence; ransomware and IP theft with physical-process risk.',
    threatProfile:
      'Manufacturers face ransomware that halts production lines and nation-state IP theft. IT/OT convergence exposes legacy control systems (PLCs/SCADA) that were never designed for connectivity, making lateral movement from IT to OT the critical concern.',
    topThreatActors: ['LockBit operators', 'APT41', 'Sandworm', 'ALPHV/BlackCat'],
    logSources: ['Windows Security / AD', 'EDR', 'OT/ICS network monitoring', 'Historian / SCADA logs', 'Firewall (IT/OT boundary)', 'VPN / remote access', 'Email gateway', 'Netflow'],
    priorityTactics: ['Initial Access', 'Lateral Movement', 'Impact', 'Collection'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'IT foothold that pivots toward OT.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware stopping production drives payment.' },
      { id: 'T1210', name: 'Exploitation of Remote Services', tactic: 'Lateral Movement', why: 'IT→OT pivot across weak segmentation.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Engineering/vendor accounts reach OT.' },
      { id: 'T1133', name: 'External Remote Services', tactic: 'Initial Access', why: 'Exposed remote maintenance into plant networks.' },
      { id: 'T1005', name: 'Data from Local System', tactic: 'Collection', why: 'Theft of designs and process IP.' },
      { id: 'T1489', name: 'Service Stop', tactic: 'Impact', why: 'Stopping control services disrupts operations.' },
    ],
  },

  government: {
    key: 'government',
    label: 'Government & Public Sector',
    summary: 'Espionage and disruption target for nation-states and hacktivists.',
    threatProfile:
      'Government bodies are targeted for espionage, citizen data, and disruption. Nation-state APTs pursue long-dwell intrusions into sensitive systems, while hacktivists and ransomware crews attack public services for impact and notoriety.',
    topThreatActors: ['APT28 (Fancy Bear)', 'APT29', 'APT31', 'Turla', 'MuddyWater'],
    logSources: ['Windows Security / AD', 'EDR', 'Email gateway', 'VPN / remote access', 'Web proxy', 'DNS', 'Firewall / netflow', 'Identity provider (SSO/MFA)'],
    priorityTactics: ['Initial Access', 'Persistence', 'Defense Evasion', 'Exfiltration'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Spearphishing is the classic APT entry vector.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Credential theft enables quiet, long-dwell access.' },
      { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', why: 'Public services and VPNs are exploited for entry.' },
      { id: 'T1505.003', name: 'Web Shell', tactic: 'Persistence', why: 'Web shells persist on public-facing servers.' },
      { id: 'T1070', name: 'Indicator Removal', tactic: 'Defense Evasion', why: 'APTs clear logs to extend dwell time.' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', why: 'Slow, stealthy espionage exfiltration.' },
    ],
  },

  energy: {
    key: 'energy',
    label: 'Energy & Utilities',
    summary: 'Critical infrastructure; OT/ICS sabotage risk from nation-state actors.',
    threatProfile:
      'Energy and utilities are strategic critical-infrastructure targets where nation-state actors seek destructive OT/ICS capability. The concern is not just data theft but physical disruption of grid, pipeline, and water operations.',
    topThreatActors: ['Sandworm (ELECTRUM)', 'XENOTIME', 'Dragonfly (Energetic Bear)', 'VOLTZITE'],
    logSources: ['OT/ICS network monitoring', 'Historian / SCADA logs', 'Windows Security / AD', 'EDR', 'Firewall (IT/OT boundary)', 'VPN / remote access', 'Netflow', 'Physical access logs'],
    priorityTactics: ['Initial Access', 'Lateral Movement', 'Impact', 'Persistence'],
    techniques: [
      { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', why: 'Internet-exposed OT/remote assets are entry points.' },
      { id: 'T1133', name: 'External Remote Services', tactic: 'Initial Access', why: 'Vendor/remote access into control networks.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Engineering credentials bridge IT and OT.' },
      { id: 'T1210', name: 'Exploitation of Remote Services', tactic: 'Lateral Movement', why: 'Movement toward control systems.' },
      { id: 'T1498', name: 'Network Denial of Service', tactic: 'Impact', why: 'Disruption of operational communications.' },
      { id: 'T1489', name: 'Service Stop', tactic: 'Impact', why: 'Halting control services for sabotage.' },
    ],
  },

  telecom: {
    key: 'telecom',
    label: 'Telecommunications',
    summary: 'Espionage target for call/data interception and as a pivot into subscribers.',
    threatProfile:
      'Telecoms are prized by nation-states for mass interception (call records, location, SMS/2FA) and as a pivot into downstream subscribers. SS7/roaming abuse, SIM-swap fraud, and long-dwell APT access to core network elements are hallmark threats.',
    topThreatActors: ['APT41', 'Salt Typhoon', 'LightBasin (UNC1945)', 'Scattered Spider'],
    logSources: ['Core network element logs', 'RADIUS / AAA logs', 'Windows Security / AD', 'EDR', 'Firewall / netflow', 'DNS', 'Identity provider (SSO/MFA)', 'CDR (call detail records)'],
    priorityTactics: ['Initial Access', 'Persistence', 'Collection', 'Exfiltration'],
    techniques: [
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Operator/admin creds reach core network elements.' },
      { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', why: 'Exposed OSS/BSS and edge systems.' },
      { id: 'T1556', name: 'Modify Authentication Process', tactic: 'Credential Access', why: 'Tampering with AAA enables SIM-swap / interception.' },
      { id: 'T1074', name: 'Data Staged', tactic: 'Collection', why: 'Staging bulk subscriber/call data before exfil.' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', why: 'Exfil of intercepted records.' },
      { id: 'T1090', name: 'Proxy', tactic: 'Command and Control', why: 'Actors relay through telecom infra to hide origin.' },
    ],
  },

  insurance: {
    key: 'insurance',
    label: 'Insurance',
    summary: 'PII/financial-data rich; BEC, ransomware, and claims fraud dominate.',
    threatProfile:
      'Insurers hold deep PII, health, and financial data, making them ransomware and BEC targets. Claims and policy platforms are abused for fraud, and large third-party/broker ecosystems widen exposure.',
    topThreatActors: ['ALPHV/BlackCat', 'FIN7', 'TA505', 'Scattered Spider'],
    logSources: ['Windows Security / AD', 'EDR', 'Claims / policy app logs', 'Email gateway', 'Web proxy', 'DLP', 'Identity provider (SSO/MFA)', 'Firewall / netflow'],
    priorityTactics: ['Initial Access', 'Credential Access', 'Collection', 'Impact'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Entry for BEC and ransomware.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Broker/agent credential abuse enables fraud.' },
      { id: 'T1114', name: 'Email Collection', tactic: 'Collection', why: 'Mailbox access drives claims/payment fraud.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware against data-rich insurers.' },
      { id: 'T1567', name: 'Exfiltration Over Web Service', tactic: 'Exfiltration', why: 'PII exfil to cloud to dodge DLP.' },
      { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', why: 'Credential stuffing on customer portals.' },
    ],
  },

  education: {
    key: 'education',
    label: 'Education & Research',
    summary: 'Open networks and research IP; ransomware and espionage against universities.',
    threatProfile:
      'Universities run open, decentralised networks with transient users, making them soft targets for ransomware and cryptomining. Research institutions also face nation-state IP theft of scientific and defense-adjacent research.',
    topThreatActors: ['Vice Society', 'APT31', 'Mustang Panda', 'Silent Librarian (TA407)'],
    logSources: ['Windows Security / AD', 'EDR', 'VPN / remote access', 'Email gateway', 'Web proxy', 'DNS', 'Wireless / NAC logs', 'Research data store audit'],
    priorityTactics: ['Initial Access', 'Credential Access', 'Impact', 'Exfiltration'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Credential phishing against staff/students.' },
      { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', why: 'Password spraying on open portals.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware against under-resourced IT.' },
      { id: 'T1496', name: 'Resource Hijacking', tactic: 'Impact', why: 'Cryptomining on campus compute.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Reused student/staff creds.' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', why: 'Research IP theft.' },
    ],
  },

  transport: {
    key: 'transport',
    label: 'Transportation & Logistics',
    summary: 'Availability-critical operations; ransomware disrupts supply chains.',
    threatProfile:
      'Transport and logistics depend on continuous operations, so ransomware that halts ports, fleets, or scheduling systems causes cascading supply-chain impact. OT in ports/rail and sprawling third-party networks add risk.',
    topThreatActors: ['LockBit operators', 'ALPHV/BlackCat', 'APT41'],
    logSources: ['Windows Security / AD', 'EDR', 'Logistics / TMS app logs', 'OT / port systems monitoring', 'VPN / remote access', 'Email gateway', 'Firewall / netflow', 'GPS / telematics logs'],
    priorityTactics: ['Initial Access', 'Lateral Movement', 'Impact', 'Exfiltration'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Entry into corporate and operations networks.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware halting logistics operations.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Partner/vendor account abuse.' },
      { id: 'T1133', name: 'External Remote Services', tactic: 'Initial Access', why: 'Exposed remote access to operational sites.' },
      { id: 'T1210', name: 'Exploitation of Remote Services', tactic: 'Lateral Movement', why: 'Spread across flat operational networks.' },
      { id: 'T1490', name: 'Inhibit System Recovery', tactic: 'Impact', why: 'Backup destruction to force payment.' },
    ],
  },

  media: {
    key: 'media',
    label: 'Media & Entertainment',
    summary: 'Content-IP theft, account/piracy fraud, and reputational disruption.',
    threatProfile:
      'Media firms face theft of pre-release content/IP, credential abuse of streaming and subscriber accounts, and hacktivist defacement/DDoS. High-profile brands attract disruptive and extortion-driven attacks.',
    topThreatActors: ['Lapsus$', 'ALPHV/BlackCat', 'hacktivist collectives'],
    logSources: ['Windows Security / AD', 'EDR', 'CMS / production system logs', 'CDN / streaming logs', 'Identity provider (SSO/MFA)', 'Web proxy', 'WAF', 'DNS'],
    priorityTactics: ['Initial Access', 'Credential Access', 'Collection', 'Impact'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Entry into production and corporate systems.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Abuse of production and subscriber accounts.' },
      { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', why: 'Credential stuffing of streaming accounts.' },
      { id: 'T1005', name: 'Data from Local System', tactic: 'Collection', why: 'Theft of unreleased content/IP.' },
      { id: 'T1498', name: 'Network Denial of Service', tactic: 'Impact', why: 'DDoS against streaming/live events.' },
      { id: 'T1567', name: 'Exfiltration Over Web Service', tactic: 'Exfiltration', why: 'Leaked content pushed to file-sharing.' },
    ],
  },

  professional: {
    key: 'professional',
    label: 'Professional Services',
    summary: 'Trusted third party holding client data; a supply-chain pivot target.',
    threatProfile:
      'Law, consulting, and accounting firms hold sensitive client data and are trusted third parties, making them attractive as supply-chain pivots and BEC/ransomware targets. Client confidentiality raises the stakes of any breach.',
    topThreatActors: ['FIN7', 'ALPHV/BlackCat', 'TA505', 'Scattered Spider'],
    logSources: ['Windows Security / AD', 'EDR', 'Email gateway', 'Document management system logs', 'Web proxy', 'Identity provider (SSO/MFA)', 'DLP', 'VPN / remote access'],
    priorityTactics: ['Initial Access', 'Credential Access', 'Collection', 'Exfiltration'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Primary vector for BEC and intrusion.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Compromised staff creds reach client data.' },
      { id: 'T1114', name: 'Email Collection', tactic: 'Collection', why: 'Mailbox access drives BEC and data theft.' },
      { id: 'T1213', name: 'Data from Information Repositories', tactic: 'Collection', why: 'Client documents harvested from DMS/SharePoint.' },
      { id: 'T1567', name: 'Exfiltration Over Web Service', tactic: 'Exfiltration', why: 'Client data exfil to cloud storage.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware leveraging client-confidentiality pressure.' },
    ],
  },

  defense: {
    key: 'defense',
    label: 'Defense & Aerospace',
    summary: 'Prime nation-state espionage target for classified and military IP.',
    threatProfile:
      'Defense and aerospace are top nation-state espionage targets for military technology, classified programs, and supply-chain access. Long-dwell APT campaigns, contractor/supply-chain compromise, and OT in manufacturing are the defining risks.',
    topThreatActors: ['APT28', 'APT29', 'APT31', 'APT41', 'Lazarus Group'],
    logSources: ['Windows Security / AD', 'EDR', 'CDS / cross-domain logs', 'Email gateway', 'VPN / remote access', 'Web proxy', 'DNS', 'OT / manufacturing monitoring'],
    priorityTactics: ['Initial Access', 'Persistence', 'Defense Evasion', 'Exfiltration'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'Targeted spearphishing of cleared personnel.' },
      { id: 'T1195', name: 'Supply Chain Compromise', tactic: 'Initial Access', why: 'Contractor/vendor compromise reaches primes.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Stolen creds enable stealthy long-dwell access.' },
      { id: 'T1505.003', name: 'Web Shell', tactic: 'Persistence', why: 'Persistence on exposed contractor infrastructure.' },
      { id: 'T1070', name: 'Indicator Removal', tactic: 'Defense Evasion', why: 'APTs erase evidence to extend dwell.' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', why: 'Slow exfiltration of classified IP.' },
    ],
  },

  other: {
    key: 'other',
    label: 'Other',
    summary: 'General enterprise baseline — the most common cross-sector techniques.',
    threatProfile:
      'A sector-agnostic baseline of the most prevalent enterprise threats: phishing-led intrusion, credential abuse, ransomware, and data exfiltration. Use this when no specific industry profile applies.',
    topThreatActors: ['Ransomware affiliates', 'Access brokers', 'Commodity malware operators'],
    logSources: ['Windows Security / AD', 'EDR', 'Email gateway', 'Web proxy', 'Firewall / netflow', 'DNS', 'VPN / remote access', 'Identity provider (SSO/MFA)'],
    priorityTactics: ['Initial Access', 'Execution', 'Credential Access', 'Impact'],
    techniques: [
      { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: 'The most common initial-access vector across all sectors.' },
      { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', why: 'Credential abuse is ubiquitous.' },
      { id: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', why: 'PowerShell/script abuse is near-universal.' },
      { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', why: 'Ransomware threatens every sector.' },
      { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', why: 'Password spraying / stuffing against exposed logins.' },
      { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', why: 'Common data-theft channel.' },
    ],
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Look up a profile by industry key; falls back to the generic baseline. */
export function getIndustryProfile(key: string | null | undefined): IndustryProfile | null {
  if (!key) return null
  return INDUSTRY_KB[key] ?? null
}

/** Base technique id (strip sub-technique), e.g. 'T1566.001' → 'T1566'. */
function baseTechnique(id: string): string {
  return id.split('.')[0].trim().toUpperCase()
}

export interface IndustryGapReport {
  profile: IndustryProfile
  covered: IndustryTechnique[]
  missing: IndustryTechnique[]
  coveragePct: number   // 0–100, share of the sector baseline the client covers
}

/**
 * Compare a client's covered technique IDs against the industry baseline.
 * A KB technique counts as covered if the client covers it or any of its
 * sub-techniques (base-id match, both directions).
 */
export function computeIndustryGaps(
  profile: IndustryProfile,
  coveredTechniqueIds: Iterable<string>,
): IndustryGapReport {
  const coveredBases = new Set<string>()
  for (const id of coveredTechniqueIds) {
    if (id) coveredBases.add(baseTechnique(id))
  }
  const covered: IndustryTechnique[] = []
  const missing: IndustryTechnique[] = []
  for (const t of profile.techniques) {
    if (coveredBases.has(baseTechnique(t.id))) covered.push(t)
    else missing.push(t)
  }
  const total = profile.techniques.length || 1
  return { profile, covered, missing, coveragePct: Math.round((covered.length / total) * 100) }
}

// ── Log-source gap analysis ─────────────────────────────────────────────────────
// Client log-source names never match the KB verbatim ("Windows Security / AD" vs
// "WinEventLog:Security"), so we compare on significant tokens with a small synonym
// map. Heuristic by design — good enough to flag likely-missing telemetry.
const LOGSOURCE_STOPWORDS = new Set(['and', 'the', 'log', 'logs', 'logging', 'via', 'for', 'data'])
const LOGSOURCE_SYNONYMS: Record<string, string> = {
  ad: 'directory', activedirectory: 'directory', windows: 'directory',
  edr: 'endpoint', xdr: 'endpoint', av: 'endpoint', antivirus: 'endpoint',
  proxy: 'web', waf: 'web', http: 'web', https: 'web',
  mail: 'email', o365: 'email', exchange: 'email',
  fw: 'firewall', netflow: 'network', flow: 'network', ids: 'network', ips: 'network',
  sso: 'identity', mfa: 'identity', idp: 'identity', okta: 'identity', azuread: 'identity', entra: 'identity',
  ot: 'ics', scada: 'ics', plc: 'ics', historian: 'ics',
  vpn: 'remote',
}

function tokenize(s: string): Set<string> {
  const out = new Set<string>()
  for (let tok of s.toLowerCase().split(/[^a-z0-9]+/)) {
    tok = tok.trim()
    if (!tok || tok.length < 2 || LOGSOURCE_STOPWORDS.has(tok)) continue
    out.add(LOGSOURCE_SYNONYMS[tok] ?? tok)
  }
  return out
}

export interface LogSourceGapReport {
  present: string[]
  missing: string[]
  coveragePct: number  // 0–100, share of expected sources the client appears to run
}

/**
 * Compare a client's observed log sources against the sector-expected list.
 * An expected source counts as present if it shares a significant token with any
 * client source (after synonym normalisation).
 */
export function computeLogSourceGaps(
  profile: IndustryProfile,
  clientSources: Iterable<string>,
): LogSourceGapReport {
  const clientTokenSets = [...clientSources].filter(Boolean).map(tokenize)
  const present: string[] = []
  const missing: string[] = []
  for (const expected of profile.logSources) {
    const expTokens = tokenize(expected)
    const found = clientTokenSets.some(cs => {
      for (const t of expTokens) if (cs.has(t)) return true
      return false
    })
    if (found) present.push(expected)
    else missing.push(expected)
  }
  const total = profile.logSources.length || 1
  return { present, missing, coveragePct: Math.round((present.length / total) * 100) }
}
