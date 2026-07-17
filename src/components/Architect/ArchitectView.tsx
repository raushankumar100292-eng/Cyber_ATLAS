import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Compass, ShieldAlert, Server, Users, Wrench, Radar,
  FileText, GraduationCap, ChevronRight, ChevronDown,
  Sparkles, Loader2, Copy, Check,
  RotateCcw, ArrowRight, Lock,
} from 'lucide-react'
import { assistArchitectTask } from '../../lib/groq'
import { useStore } from '../../lib/store'

// ── Data ─────────────────────────────────────────────────────────────────────
interface ArchTask {
  id: string
  title: string
  description: string
  inputLabel: string
  inputPlaceholder: string
  systemPrompt: string
}

interface ArchCategory {
  id: string
  label: string
  icon: React.ElementType
  color: string
  accent: string
  tasks: ArchTask[]
}

const CATEGORIES: ArchCategory[] = [
  {
    id: 'strategy',
    label: 'Strategy & Architecture Design',
    icon: Compass,
    color: '#00e5ff',
    accent: 'rgba(0,229,255,0.08)',
    tasks: [
      {
        id: 'str-1',
        title: 'Define Enterprise Security Architecture Framework',
        description: 'Establish and maintain the overarching security architecture framework aligned with business objectives across all environments.',
        inputLabel: 'Organisation Context',
        inputPlaceholder: 'Industry, size, key business goals, existing technology stack, cloud strategy, regulatory environment…',
        systemPrompt: `You are a senior cybersecurity architect with 15+ years of experience. Help the user define a comprehensive enterprise security architecture framework. Cover: governance model, architecture principles, security domains, reference layers (business, data, application, technology), integration with enterprise architecture (TOGAF/SABSA), and alignment to business objectives. Be specific, practical, and structured. Use headers and bullet points. Reference relevant frameworks (SABSA, TOGAF, NIST CSF, ISO 27001).`,
      },
      {
        id: 'str-2',
        title: 'Design End-to-End Security Architecture',
        description: 'Design holistic security architectures for on-premises, cloud (AWS/Azure/GCP), and hybrid environments.',
        inputLabel: 'Environment Details',
        inputPlaceholder: 'Target environment (on-prem/cloud/hybrid), key workloads, existing controls, key risks, scale requirements…',
        systemPrompt: `You are a senior cybersecurity architect. Design a comprehensive end-to-end security architecture for the environment described. Cover: perimeter and network security, identity and access management, data protection, workload security, monitoring and detection, incident response integration, and zero-trust adoption path. Provide concrete architecture decisions with rationale. Include relevant tools and patterns for each layer.`,
      },
      {
        id: 'str-3',
        title: 'Develop Security Reference Architecture',
        description: 'Create reusable security reference architectures, patterns, and standards that project teams can adopt.',
        inputLabel: 'Scope & Requirements',
        inputPlaceholder: 'Target use case (e.g. web app, microservices, data pipeline, SaaS integration), constraints, preferred technology stack…',
        systemPrompt: `You are a senior security architect. Create a security reference architecture document with reusable patterns. Include: security pattern catalogue, reference diagrams description, control objectives per layer, technology-agnostic standards and guardrails, integration points, and adoption guidance for engineering teams. Structure as a formal reference document with clear sections.`,
      },
      {
        id: 'str-4',
        title: 'Build the Security Roadmap',
        description: 'Translate security strategy into a prioritised, time-bound roadmap of actionable technical initiatives.',
        inputLabel: 'Current State & Priorities',
        inputPlaceholder: 'Current maturity level, key gaps, budget constraints, timeline horizon, strategic priorities, top risks…',
        systemPrompt: `You are a cybersecurity architect and strategist. Build a comprehensive security roadmap. Organise initiatives into: Quick Wins (0–3 months), Short-Term (3–12 months), and Strategic (12–36 months). For each initiative include: objective, key deliverables, effort estimate (S/M/L), dependencies, success metrics, and risk reduction impact. Map initiatives to NIST CSF functions. Prioritise by risk reduction value vs. effort.`,
      },
      {
        id: 'str-5',
        title: 'Evaluate Emerging Technology',
        description: 'Assess emerging technologies and threat landscape shifts to proactively evolve the architecture.',
        inputLabel: 'Technology / Trend to Evaluate',
        inputPlaceholder: 'Technology, tool, or trend to assess (e.g. AI-assisted detection, post-quantum cryptography, confidential computing, SASE)…',
        systemPrompt: `You are a forward-looking cybersecurity architect. Evaluate the technology or trend described from a security architecture perspective. Cover: what it is and how it works, security opportunities it enables, security risks it introduces, architecture integration considerations, vendor landscape overview, adoption readiness assessment, and recommendation (adopt/pilot/watch/avoid). Be specific and actionable.`,
      },
    ],
  },
  {
    id: 'risk',
    label: 'Risk & Compliance',
    icon: ShieldAlert,
    color: '#f87171',
    accent: 'rgba(248,113,113,0.08)',
    tasks: [
      {
        id: 'risk-1',
        title: 'Architecture Risk Assessment & Threat Modeling',
        description: 'Conduct architecture-level risk assessments using STRIDE, PASTA, and MITRE ATT&CK mapping.',
        inputLabel: 'System or Component to Assess',
        inputPlaceholder: 'Describe the system, its components, data flows, trust boundaries, and the primary risk concerns…',
        systemPrompt: `You are a cybersecurity architect specialising in threat modeling and risk assessment. Conduct a structured threat model using STRIDE methodology. For each threat category (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege): identify specific threats, rate likelihood and impact (High/Medium/Low), map to MITRE ATT&CK techniques where applicable, and recommend mitigating controls. Conclude with a prioritised risk register and top 5 architecture recommendations.`,
      },
      {
        id: 'risk-2',
        title: 'Security Gap Analysis',
        description: 'Identify security gaps across the architecture and define compensating controls aligned to risk appetite.',
        inputLabel: 'Architecture & Scope',
        inputPlaceholder: 'Describe current architecture, existing controls, business risk appetite, regulatory requirements, and known weaknesses…',
        systemPrompt: `You are a senior security architect. Conduct a security gap analysis. Structure your output as: 1) Assessment methodology, 2) Gap findings table (Domain | Current State | Target State | Gap | Risk Rating | Priority), 3) Compensating controls for each gap, 4) Implementation roadmap, 5) Residual risk summary. Map findings to NIST CSF categories. Be specific and avoid generic statements.`,
      },
      {
        id: 'risk-3',
        title: 'Compliance Framework Mapping',
        description: 'Ensure architecture compliance with ISO 27001, NIST CSF, SOC 2, GDPR, PCI-DSS, HIPAA and other frameworks.',
        inputLabel: 'Regulatory Scope',
        inputPlaceholder: 'Which frameworks apply, industry/geography, data types handled, current compliance posture, audit timeline…',
        systemPrompt: `You are a security architect with deep compliance expertise. Map the architecture requirements to the specified compliance frameworks. Provide: 1) Framework crosswalk table showing overlapping controls, 2) Architecture controls required per framework domain, 3) Gaps needing remediation, 4) Evidence requirements for audit readiness, 5) Prioritised compliance roadmap. Highlight areas where a single control satisfies multiple frameworks.`,
      },
      {
        id: 'risk-4',
        title: 'Define Security Policies & Standards',
        description: 'Define and enforce security policies, technical standards, baselines, and architecture guardrails.',
        inputLabel: 'Policy Domain & Scope',
        inputPlaceholder: 'Domain (e.g. cloud security, endpoint, access control, data classification), target audience, technology stack, current policy gaps…',
        systemPrompt: `You are a security architect and policy author. Draft a comprehensive security policy and accompanying technical standard for the domain specified. Include: policy statement, scope, principles, specific requirements (must/should/may), technical configuration baselines, exception process, enforcement mechanisms, review cadence, and accountability matrix (RACI). Format as a formal policy document. Be specific enough to be actionable.`,
      },
      {
        id: 'risk-5',
        title: 'Audit Support & Architecture Evidence',
        description: 'Prepare architecture evidence, design documentation, and control mappings to support audit activities.',
        inputLabel: 'Audit Type & Scope',
        inputPlaceholder: 'Audit type (ISO 27001, SOC 2, PCI), scope, timeline, known concerns, existing documentation available…',
        systemPrompt: `You are a security architect preparing for an external audit. Provide: 1) Evidence artefact checklist mapped to the audit standard, 2) Architecture evidence package contents (diagrams, ADRs, risk register, control mappings), 3) Common audit findings in this domain and how to pre-empt them, 4) Recommended audit narrative for architecture decisions, 5) Sample control description statements auditors expect to see. Format practically for use in audit preparation.`,
      },
    ],
  },
  {
    id: 'domains',
    label: 'Security Domain Ownership',
    icon: Server,
    color: '#818cf8',
    accent: 'rgba(129,140,248,0.08)',
    tasks: [
      {
        id: 'dom-1',
        title: 'IAM Architecture (Zero Trust, MFA, SSO, PAM)',
        description: 'Design identity and access management architecture including Zero Trust principles, MFA, SSO, and privileged access management.',
        inputLabel: 'Environment & Requirements',
        inputPlaceholder: 'User population, applications (on-prem/SaaS/cloud), existing IAM tools, federation requirements, privileged access concerns…',
        systemPrompt: `You are a security architect specialising in identity and access management. Design a comprehensive IAM architecture. Cover: identity governance model, authentication architecture (MFA, passwordless, SSO/federation), authorisation model (RBAC/ABAC/ReBAC), Zero Trust access principles, privileged access management (PAM) strategy, directory services design, lifecycle management (joiners/movers/leavers), and technology stack recommendations. Include an adoption roadmap and key risks to mitigate.`,
      },
      {
        id: 'dom-2',
        title: 'Network Security Architecture',
        description: 'Design network security zones, segmentation, micro-segmentation strategies, and perimeter controls.',
        inputLabel: 'Network Topology',
        inputPlaceholder: 'Current network topology, environments (DC/cloud/branch), critical assets, east-west vs north-south concerns, existing tools…',
        systemPrompt: `You are a network security architect. Design a comprehensive network security architecture. Cover: security zone model (DMZ, trusted, untrusted, management), macro and micro-segmentation strategy, perimeter security (NGFW, WAF, IPS), east-west traffic controls, cloud network security (VPC/VNET design, security groups, NACLs), SD-WAN/SASE considerations, and zero-trust network access (ZTNA). Provide specific architecture decisions with rationale and a recommended technology stack.`,
      },
      {
        id: 'dom-3',
        title: 'Endpoint Security Architecture (EDR/XDR)',
        description: 'Architect endpoint security including EDR/XDR deployment patterns, device trust models, and mobile security.',
        inputLabel: 'Endpoint Landscape',
        inputPlaceholder: 'Device types (managed/BYOD/OT), OS distribution, remote work requirements, existing AV/EDR tools, key threat scenarios…',
        systemPrompt: `You are a security architect for endpoint and device security. Design a comprehensive endpoint security architecture. Cover: endpoint security stack (AV/EPP, EDR/XDR, DLP, FIM), device trust and compliance model (MDM, Intune, Jamf), patch and vulnerability management architecture, application control and allowlisting, privileged endpoint access, mobile device security, and OT/ICS endpoint considerations if relevant. Include detection coverage mapping to MITRE ATT&CK and recommended tooling.`,
      },
      {
        id: 'dom-4',
        title: 'Data Security Architecture',
        description: 'Define data security architecture including classification, DLP, encryption at rest and in transit.',
        inputLabel: 'Data Landscape',
        inputPlaceholder: 'Data types and sensitivity levels, storage locations (cloud/on-prem/SaaS), regulatory requirements, key data flows, existing DLP tools…',
        systemPrompt: `You are a data security architect. Design a comprehensive data security architecture. Cover: data classification framework (levels, labelling, handling requirements), data discovery and inventory approach, DLP architecture (endpoint, network, cloud), encryption strategy (at rest, in transit, in use/TEE), key management architecture (HSM, KMS), data access governance, data loss prevention workflows, and privacy-by-design principles. Include tooling recommendations and implementation priorities.`,
      },
      {
        id: 'dom-5',
        title: 'Cloud Security Architecture (CSPM, CWPP, CASB)',
        description: 'Own cloud security architecture across IaaS, PaaS, and SaaS with CSPM, CWPP, and CASB capabilities.',
        inputLabel: 'Cloud Environment',
        inputPlaceholder: 'Cloud providers (AWS/Azure/GCP), workload types, multi-cloud vs single, current posture, compliance requirements, DevOps maturity…',
        systemPrompt: `You are a cloud security architect. Design a comprehensive cloud security architecture. Cover: cloud security governance model (landing zone design, guardrails), identity and access in the cloud (cloud IAM, workload identity), network security (VPC design, service endpoints, private connectivity), workload protection (CWPP, container/K8s security), data protection in cloud, cloud security posture management (CSPM), SaaS security (CASB, Shadow IT), and cloud-native security services vs third-party tooling. Include a cloud security maturity model and roadmap.`,
      },
      {
        id: 'dom-6',
        title: 'Application Security Architecture',
        description: 'Design application security including SAST, DAST, API security, secure SDLC integration, and threat modeling.',
        inputLabel: 'Application Stack',
        inputPlaceholder: 'Application types (web/mobile/API/microservices), tech stack, development methodology (Agile/DevOps), CI/CD pipeline, key security concerns…',
        systemPrompt: `You are an application security architect. Design a comprehensive application security architecture. Cover: secure development lifecycle (SSDLC) integration points, threat modeling process and tooling, static and dynamic analysis (SAST/DAST/SCA) pipeline integration, API security architecture (gateway, authentication, rate limiting, schema validation), secrets management, container and dependency security, web application firewall (WAF) strategy, and security champion programme design. Provide a developer-friendly security control catalogue.`,
      },
      {
        id: 'dom-7',
        title: 'SOC/SIEM Architecture',
        description: 'Define SOC and SIEM architecture including log ingestion pipelines, detection engineering standards, and SOAR integration.',
        inputLabel: 'SOC Environment',
        inputPlaceholder: 'Current SIEM tool, log sources, SOC model (in-house/MSSP/hybrid), team size, key detection gaps, SOAR maturity…',
        systemPrompt: `You are a security architect specialising in SOC and detection engineering. Design a comprehensive SOC/SIEM architecture. Cover: log collection architecture (agents, syslog, APIs, cloud-native), data normalisation and enrichment pipeline, SIEM platform design (indexes, retention, search optimisation), detection engineering framework (use case lifecycle, MITRE ATT&CK coverage mapping, quality gates), alert triage workflow, SOAR integration patterns (playbook triggers, API integrations), threat intelligence enrichment, and SOC tooling stack. Include a detection maturity model.`,
      },
    ],
  },
  {
    id: 'stakeholder',
    label: 'Stakeholder Engagement',
    icon: Users,
    color: '#34d399',
    accent: 'rgba(52,211,153,0.08)',
    tasks: [
      {
        id: 'stk-1',
        title: 'Engineering & DevOps Security Advisory',
        description: 'Act as the security advisor to engineering, DevOps, and product teams — embedding security into delivery.',
        inputLabel: 'Team & Initiative',
        inputPlaceholder: 'Engineering team type, project/initiative, technology decisions being made, timeline, key security concerns raised…',
        systemPrompt: `You are a security architect acting as a trusted security advisor to engineering and DevOps teams. Provide practical, developer-friendly security guidance for the initiative described. Avoid generic advice — be specific to the technology and context. Cover: key security architecture decisions required, security requirements in user story format, threat scenarios to design against, tool/library recommendations, and a security review checklist for this initiative. Frame security as an enabler, not a blocker.`,
      },
      {
        id: 'stk-2',
        title: 'Executive Security Communication',
        description: 'Translate complex security architecture concepts into business risk language for CISO, board, and C-suite audiences.',
        inputLabel: 'Topic & Audience',
        inputPlaceholder: 'Security topic to communicate, audience (CEO/CFO/Board/CISO), business context, key decisions needed, desired outcome…',
        systemPrompt: `You are a security architect and skilled communicator. Draft an executive-level communication on the security topic provided. Write for a non-technical audience. Focus on: business risk (not technical threats), financial and operational impact, regulatory exposure, peer benchmarks where relevant, recommended decisions with options, and a clear ask. Avoid jargon. Use language that resonates with business leaders: risk, cost, liability, competitive advantage, customer trust. Format as an executive brief with a one-paragraph summary at the top.`,
      },
      {
        id: 'stk-3',
        title: 'Design Review & Architecture Sign-Off',
        description: 'Conduct security design reviews for projects and provide structured architecture approval or conditions.',
        inputLabel: 'Design to Review',
        inputPlaceholder: 'Describe the design, technology choices, data flows, integration points, and any known concerns for review…',
        systemPrompt: `You are a security architect conducting a formal design review. Provide: 1) Design summary (what you understand the system to do), 2) Security control assessment (what controls are present and adequate), 3) Security findings (risks, gaps, design weaknesses — rated High/Medium/Low), 4) Architecture conditions (what must be resolved before sign-off), 5) Recommendations (nice-to-have improvements), 6) Sign-off status (Approved / Conditional Approval / Not Approved) with rationale. Be specific and actionable.`,
      },
      {
        id: 'stk-4',
        title: 'Vendor & MSSP Security Assessment',
        description: 'Assess third-party vendors, MSSPs, and technology partners for architecture alignment and security posture.',
        inputLabel: 'Vendor & Use Case',
        inputPlaceholder: 'Vendor name and product, use case, data they will access, integration pattern, regulatory scope, key concerns…',
        systemPrompt: `You are a security architect conducting a vendor security assessment. Provide: 1) Assessment scope and data classification (what data/access is involved), 2) Security questionnaire covering key domains (access control, data handling, incident response, supply chain, compliance), 3) Architecture integration risks, 4) Contractual security requirements to mandate, 5) Red flags to investigate, 6) Risk rating (High/Medium/Low) with recommendation. Frame findings practically for a procurement or legal team.`,
      },
      {
        id: 'stk-5',
        title: 'Legal, Privacy & Governance Collaboration',
        description: 'Embed security into governance processes by collaborating with legal, privacy, and compliance teams.',
        inputLabel: 'Governance Topic',
        inputPlaceholder: 'Governance challenge (e.g. data residency, DPIA, cross-border transfer, privacy by design review, M&A due diligence)…',
        systemPrompt: `You are a security architect working at the intersection of security, legal, and privacy. Provide structured guidance on the governance topic described. Cover: relevant regulatory requirements, security architecture implications, privacy-by-design controls, data protection impact considerations, recommended governance process, documentation requirements, and how security architecture supports compliance posture. Write for a mixed audience of lawyers, privacy officers, and technical staff.`,
      },
    ],
  },
  {
    id: 'engineering',
    label: 'Security Engineering Oversight',
    icon: Wrench,
    color: '#fbbf24',
    accent: 'rgba(251,191,36,0.08)',
    tasks: [
      {
        id: 'eng-1',
        title: 'Security Tool Evaluation & Selection',
        description: 'Define selection criteria and evaluate security products against architecture requirements.',
        inputLabel: 'Tool Category & Requirements',
        inputPlaceholder: 'Tool category (SIEM, EDR, PAM, CASB, etc.), functional requirements, integration constraints, budget range, shortlisted vendors…',
        systemPrompt: `You are a security architect running a tool evaluation process. Provide: 1) Evaluation framework (scoring criteria with weights), 2) Capability requirements mapped to architecture needs, 3) Integration and compatibility considerations, 4) Vendor landscape overview for this category, 5) Evaluation scorecard template, 6) RFP/PoC question set, 7) Common pitfalls in tool selection for this category. Be opinionated and specific — provide real architectural guidance, not just generic criteria.`,
      },
      {
        id: 'eng-2',
        title: 'Security Tool Integration Architecture',
        description: 'Establish integration patterns between security tools (EDR, SIEM, SOAR, CASB, WAF, NDR).',
        inputLabel: 'Tools to Integrate',
        inputPlaceholder: 'List of tools in the security stack, integration goals (data sharing, automated response, unified visibility), current pain points…',
        systemPrompt: `You are a security architect designing security tool integration patterns. For the toolset described, provide: 1) Integration architecture overview, 2) Data flow diagram description (what data flows where), 3) API/connector patterns for each integration, 4) Normalisation and enrichment approach, 5) Bi-directional workflow patterns (detection → response loop), 6) Common integration anti-patterns to avoid, 7) Recommended integration platform/middleware if applicable. Be specific about data schemas, trigger events, and latency requirements.`,
      },
      {
        id: 'eng-3',
        title: 'Infrastructure-as-Code Security Review',
        description: 'Review IaC templates (Terraform, CloudFormation, Bicep) and CI/CD pipelines for security adherence.',
        inputLabel: 'IaC / Pipeline Context',
        inputPlaceholder: 'IaC tool (Terraform/CloudFormation/Bicep/Ansible), cloud provider, resource types being deployed, CI/CD platform, key concerns…',
        systemPrompt: `You are a security architect specialising in DevSecOps and infrastructure security. Provide a security review framework for IaC and CI/CD pipelines. Cover: 1) IaC security scanning tools and integration points (checkov, tfsec, kics), 2) Common IaC misconfigurations by resource type with remediation, 3) Security policy-as-code patterns (OPA/Sentinel), 4) Pipeline security controls (secrets scanning, SAST, dependency check, image scanning), 5) Security gates and quality thresholds, 6) Drift detection and compliance monitoring. Provide specific checks and thresholds.`,
      },
      {
        id: 'eng-4',
        title: 'DevSecOps & Shift-Left Architecture',
        description: 'Drive adoption of DevSecOps practices and shift-left security principles across engineering.',
        inputLabel: 'Engineering Context',
        inputPlaceholder: 'Current SDLC maturity, development teams size, languages/frameworks, CI/CD toolchain, current security integration points, key gaps…',
        systemPrompt: `You are a security architect driving DevSecOps adoption. Design a comprehensive shift-left security programme. Cover: 1) DevSecOps maturity model and target state, 2) Security tooling at each SDLC phase (IDE plugins, pre-commit hooks, pipeline gates, runtime), 3) Security requirements in Agile (threat story format, definition of done security criteria), 4) Security champion programme design, 5) Developer security training curriculum, 6) Metrics and KPIs for measuring DevSecOps maturity, 7) Change management approach. Be practical and developer-centric.`,
      },
    ],
  },
  {
    id: 'threat',
    label: 'Threat Intelligence & Detection Architecture',
    icon: Radar,
    color: '#e879f9',
    accent: 'rgba(232,121,249,0.08)',
    tasks: [
      {
        id: 'thr-1',
        title: 'Detection Architecture Strategy',
        description: 'Define the detection architecture including use case development, data source mapping, and MITRE ATT&CK coverage modelling.',
        inputLabel: 'Detection Environment',
        inputPlaceholder: 'SIEM platform, current log sources, key threats relevant to your industry, detection engineering maturity, team structure…',
        systemPrompt: `You are a detection engineering architect. Design a comprehensive detection architecture strategy. Cover: 1) Detection philosophy and principles (hypothesis-driven, risk-aligned), 2) Data source catalogue and coverage mapping to MITRE ATT&CK, 3) Use case development lifecycle (ideation → research → build → test → deploy → tune), 4) Detection quality framework (TP/FP rates, alert fatigue metrics), 5) Coverage heatmap approach across MITRE tactics, 6) Gap prioritisation methodology, 7) Detection-as-code pipeline. Provide a practical roadmap for improving detection capability.`,
      },
      {
        id: 'thr-2',
        title: 'Threat Intelligence Integration Architecture',
        description: 'Design architecture to integrate threat intelligence feeds and validate architecture assumptions against real threat data.',
        inputLabel: 'Intelligence Requirements',
        inputPlaceholder: 'Current TI sources, consumption use cases (detection enrichment, IoC blocking, strategic planning), SIEM/SOAR platform, team capability…',
        systemPrompt: `You are a security architect specialising in threat intelligence. Design a threat intelligence integration architecture. Cover: 1) Intelligence requirements analysis (strategic/operational/tactical), 2) Feed landscape and selection criteria, 3) TAXII/STIX data ingestion architecture, 4) Intelligence enrichment pipeline (alert enrichment, IoC matching), 5) Intelligence-driven detection rule lifecycle, 6) Bi-directional intelligence sharing patterns, 7) Intelligence validation and quality scoring, 8) Integration with SIEM/SOAR/CASB/firewall for automated response. Include tooling recommendations.`,
      },
      {
        id: 'thr-3',
        title: 'Telemetry Gap Analysis',
        description: 'Identify telemetry gaps across the log source landscape and recommend data source onboarding to improve detection coverage.',
        inputLabel: 'Current Log Sources',
        inputPlaceholder: 'List existing log sources (EDR, firewall, AD, cloud, email, proxy, etc.), key MITRE techniques you need to detect, known blind spots…',
        systemPrompt: `You are a detection architect. Conduct a telemetry gap analysis. Provide: 1) MITRE ATT&CK technique coverage assessment based on current log sources, 2) Gap identification — which tactics/techniques have no or weak coverage, 3) Log source recommendations to close each gap (specific sources, data fields needed, collection method), 4) Prioritised onboarding roadmap (effort vs. detection value), 5) Data quality checks to validate log source completeness, 6) Normalisation requirements for new sources. Format as an actionable gap register with priority ratings.`,
      },
      {
        id: 'thr-4',
        title: 'Purple Team Exercise Design',
        description: 'Design purple team exercises to test and harden architectural controls against real adversary techniques.',
        inputLabel: 'Exercise Scope',
        inputPlaceholder: 'Priority threat scenarios (ransomware, insider threat, APT), architecture controls to test, team availability, tools available (Atomic Red Team, CALDERA)…',
        systemPrompt: `You are a security architect designing purple team exercises. Provide a comprehensive purple team exercise plan. Cover: 1) Exercise objectives and success criteria, 2) Threat scenario selection rationale (mapped to MITRE ATT&CK), 3) Exercise execution plan (phases: reconnaissance, initial access, lateral movement, exfiltration), 4) Control validation checkpoints per attack phase, 5) Detection expectation mapping (what should alert, when), 6) Findings capture template, 7) Remediation workflow from exercise findings, 8) Metrics to measure programme effectiveness. Format as an actionable exercise playbook.`,
      },
    ],
  },
  {
    id: 'docs',
    label: 'Documentation & Governance',
    icon: FileText,
    color: '#94a3b8',
    accent: 'rgba(148,163,184,0.08)',
    tasks: [
      {
        id: 'doc-1',
        title: 'Architecture Decision Records (ADRs)',
        description: 'Produce and maintain architecture decision records capturing key security design choices and their rationale.',
        inputLabel: 'Architecture Decision',
        inputPlaceholder: 'Describe the architecture decision being made: context, options considered, constraints, stakeholders involved…',
        systemPrompt: `You are a senior security architect. Produce a formal Architecture Decision Record (ADR) for the decision described. Use the standard ADR format: Title, Status, Context (problem being solved), Decision Drivers, Considered Options (with pros/cons for each), Decision Outcome, Consequences (positive, negative, neutral), and Compliance Notes. Be precise and document enough context that someone reading in 2 years can understand why this decision was made. Include references to relevant standards or frameworks.`,
      },
      {
        id: 'doc-2',
        title: 'HLD/LLD Security Design Documentation',
        description: 'Create high-level and low-level security design documents for projects and systems.',
        inputLabel: 'System to Document',
        inputPlaceholder: 'System name and purpose, key components, data flows, integration points, target audience for the document (HLD or LLD)…',
        systemPrompt: `You are a security architect. Produce a security design document for the system described. For HLD: cover security objectives, threat model summary, security architecture overview, key security controls by domain, compliance mapping, and open risks. For LLD: cover specific configuration requirements, security control specifications, authentication/authorisation flows, encryption specifications, logging requirements, and security test cases. Format as a formal design document with clear sections, assumptions, and constraints.`,
      },
      {
        id: 'doc-3',
        title: 'Threat Model Inventory & Maintenance',
        description: 'Build and maintain a threat model inventory aligned to the current asset and system landscape.',
        inputLabel: 'System or Asset',
        inputPlaceholder: 'System name, asset type, data classification, trust boundaries, key stakeholders, previous threat model (if updating)…',
        systemPrompt: `You are a security architect maintaining a threat model library. Produce a structured threat model for the system described. Include: 1) System overview and data flow diagram description, 2) Trust boundaries and actors, 3) STRIDE threat enumeration per component, 4) MITRE ATT&CK mapping for relevant threats, 5) Current controls assessment, 6) Residual risks, 7) Review cadence and trigger events for re-assessment. Format as a living document with versioning guidance and a threat register table.`,
      },
      {
        id: 'doc-4',
        title: 'Security Exception Management',
        description: 'Define and govern the security exception process with appropriate compensating controls and review cycles.',
        inputLabel: 'Exception Request',
        inputPlaceholder: 'Exception requested, which policy/standard it deviates from, business justification, proposed compensating controls, risk owner…',
        systemPrompt: `You are a security architect governing the exception management process. Provide: 1) Exception risk assessment (what risk does this deviation introduce), 2) Adequacy assessment of proposed compensating controls, 3) Additional compensating controls recommended, 4) Approval conditions (what must be in place before exception is granted), 5) Exception duration recommendation and review trigger, 6) Monitoring requirements for the exception period, 7) Formal exception decision (Approve/Approve with Conditions/Deny) with rationale. Format as a governance decision record.`,
      },
    ],
  },
  {
    id: 'leadership',
    label: 'Leadership & Mentorship',
    icon: GraduationCap,
    color: '#fb923c',
    accent: 'rgba(251,146,60,0.08)',
    tasks: [
      {
        id: 'lead-1',
        title: 'Security Team Mentorship & Development',
        description: 'Mentor security engineers and analysts on architecture best practices and career development.',
        inputLabel: 'Team Member Profile',
        inputPlaceholder: 'Role, experience level, current skills, development goals, specific topics they need guidance on, learning style…',
        systemPrompt: `You are a senior security architect and mentor. Create a personalised mentorship and development plan for the team member described. Include: 1) Skills gap assessment against senior/architect level expectations, 2) Learning path (topics, resources, hands-on projects), 3) Architecture thinking exercises and challenges, 4) Structured pairing opportunities, 5) Certification pathway recommendation, 6) 30/60/90 day milestones, 7) How to measure progress. Be specific and encouraging — focus on growth and practical application.`,
      },
      {
        id: 'lead-2',
        title: 'Security Architecture Community of Practice',
        description: 'Lead a community of practice around security architecture — driving standards, knowledge sharing, and capability uplift.',
        inputLabel: 'CoP Scope & Goals',
        inputPlaceholder: 'Organisation size, participant roles, current maturity, key topics to address, available time commitment, desired outcomes…',
        systemPrompt: `You are a security architect leading a community of practice. Design a comprehensive CoP programme. Cover: 1) CoP charter (purpose, membership, governance), 2) Meeting cadence and formats (presentations, workshops, review sessions), 3) Topic backlog for the first 12 months, 4) Knowledge management approach (wiki, decision library, pattern catalogue), 5) Engagement mechanics to sustain participation, 6) Ways to measure CoP value and impact, 7) Connection to security standards and architecture review processes. Format as a practical launch plan.`,
      },
      {
        id: 'lead-3',
        title: 'RFP, Vendor Assessment & Procurement',
        description: 'Contribute security architecture expertise to RFPs, vendor assessments, and procurement decisions.',
        inputLabel: 'Procurement Context',
        inputPlaceholder: 'Product category, business requirement, evaluation timeline, key stakeholders, budget, must-have vs nice-to-have requirements…',
        systemPrompt: `You are a security architect contributing to a procurement process. Provide: 1) Security architecture requirements for the RFP (functional and non-functional security requirements), 2) Due diligence questionnaire for vendors, 3) Architecture evaluation criteria with scoring weights, 4) PoC test plan with security-specific test cases, 5) Integration architecture requirements, 6) SLA and contractual security clauses to mandate, 7) Reference architecture for how this product fits the broader security stack. Format practically for use in procurement documentation.`,
      },
      {
        id: 'lead-4',
        title: 'Threat & Vulnerability Intelligence Briefing',
        description: 'Stay current and produce briefings on adversarial techniques, CVEs, and industry developments for stakeholders.',
        inputLabel: 'Topic / CVE / Threat',
        inputPlaceholder: 'Specific CVE, threat actor, attack technique, or industry development to brief on (e.g. Log4Shell, Midnight Blizzard, SolarWinds-style supply chain)…',
        systemPrompt: `You are a security architect producing a threat intelligence briefing for a mixed technical/executive audience. Cover: 1) What happened / what was discovered (plain language), 2) Technical details of the vulnerability or technique, 3) Affected systems and products, 4) Exploitation in the wild (if applicable), 5) Architecture-level impact assessment (which controls are bypassed, which layers are affected), 6) Detection opportunities (SIEM rules, indicators of compromise), 7) Remediation actions (immediate and strategic), 8) Architectural lessons and hardening recommendations. Calibrate depth for both technical and leadership readers.`,
      },
    ],
  },
]

// ── Component ─────────────────────────────────────────────────────────────────
export default function ArchitectView() {
  const apiKey = useStore(s => s.apiKey)
  const [expandedCat, setExpandedCat] = useState<string>('strategy')
  const [selectedTask, setSelectedTask] = useState<ArchTask | null>(null)
  const [userContext, setUserContext]   = useState('')
  const [aiOutput, setAiOutput]         = useState('')
  const [streaming, setStreaming]       = useState(false)
  const [done, setDone]                 = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [copied, setCopied]             = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)

  const handleSelectTask = useCallback((task: ArchTask) => {
    setSelectedTask(task)
    setAiOutput('')
    setDone(false)
    setError(null)
    setUserContext('')
  }, [])

  const handleAssist = useCallback(async () => {
    if (!selectedTask) return
    if (!apiKey.trim()) { setError('Enter your Groq API key first.'); return }
    setError(null)
    setAiOutput('')
    setStreaming(true)
    setDone(false)
    await assistArchitectTask(
      apiKey.trim(),
      selectedTask.title,
      selectedTask.systemPrompt,
      userContext,
      {
        onToken: (t) => {
          setAiOutput(prev => {
            const next = prev + t
            requestAnimationFrame(() => {
              outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
            })
            return next
          })
        },
        onDone: () => { setStreaming(false); setDone(true) },
        onError: (e) => { setError(e); setStreaming(false) },
      }
    )
  }, [selectedTask, apiKey, userContext])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(aiOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [aiOutput])

  const currentCat = CATEGORIES.find(c => c.tasks.some(t => t.id === selectedTask?.id))

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Left sidebar ──────────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-white/[0.06] overflow-hidden"
        style={{ background: 'rgba(7,11,20,0.6)' }}>

        {/* Header */}
        <div className="px-4 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 mb-1">
            <Lock className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-white">Security Architect</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {CATEGORIES.reduce((s, c) => s + c.tasks.length, 0)} skills across {CATEGORIES.length} domains
          </p>
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto py-2">
          {CATEGORIES.map(cat => {
            const isOpen = expandedCat === cat.id
            return (
              <div key={cat.id}>
                <button
                  onClick={() => setExpandedCat(isOpen ? '' : cat.id)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-white/[0.03] transition-colors text-left">
                  <cat.icon className="w-3.5 h-3.5 shrink-0" style={{ color: cat.color, opacity: 0.7 }} />
                  <span className="flex-1 text-[12px] font-medium text-slate-400 leading-tight">{cat.label}</span>
                  <span className="text-[10px] font-mono text-slate-700 mr-1">{cat.tasks.length}</span>
                  {isOpen
                    ? <ChevronDown className="w-3 h-3 text-slate-700" />
                    : <ChevronRight className="w-3 h-3 text-slate-700" />}
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }}
                      exit={{ height: 0 }} className="overflow-hidden">
                      {cat.tasks.map(task => {
                        const isActive = selectedTask?.id === task.id
                        return (
                          <button key={task.id}
                            onClick={() => handleSelectTask(task)}
                            className="w-full text-left px-4 py-2 pl-10 text-[11px] leading-snug transition-all"
                            style={{
                              color: isActive ? cat.color : '#64748b',
                              background: isActive ? `${cat.color}08` : 'transparent',
                              borderLeft: isActive ? `2px solid ${cat.color}` : '2px solid transparent',
                            }}>
                            {task.title}
                          </button>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>

      </div>

      {/* ── Main content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">

          {/* Welcome screen */}
          {!selectedTask && (
            <motion.div key="welcome"
              className="flex-1 flex flex-col items-center justify-center px-12 text-center"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                style={{ background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.15)' }}>
                <Lock className="w-6 h-6 text-slate-500" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Security Architect Workbench</h2>
              <p className="text-sm text-slate-500 max-w-md leading-relaxed mb-8">
                Select any skill from the left panel to open an AI-powered workspace. Provide your context and the assistant generates tailored, architecture-grade guidance.
              </p>
              <div className="grid grid-cols-4 gap-4 w-full max-w-2xl">
                {CATEGORIES.map(cat => (
                  <button key={cat.id}
                    onClick={() => { setExpandedCat(cat.id); handleSelectTask(cat.tasks[0]) }}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border transition-all hover:scale-[1.02]"
                    style={{ borderColor: `${cat.color}20`, background: cat.accent }}>
                    <cat.icon className="w-5 h-5" style={{ color: cat.color, opacity: 0.7 }} />
                    <span className="text-[10px] font-semibold text-center leading-tight"
                      style={{ color: cat.color, opacity: 0.8 }}>
                      {cat.label.split(' ').slice(0, 2).join(' ')}
                    </span>
                    <span className="text-[10px] font-mono text-slate-700">{cat.tasks.length} skills</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Task workspace */}
          {selectedTask && (
            <motion.div key={selectedTask.id}
              className="flex-1 flex flex-col overflow-hidden"
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>

              {/* Task header */}
              <div className="px-7 pt-6 pb-5 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  {currentCat && (
                    <>
                      <currentCat.icon className="w-3.5 h-3.5" style={{ color: currentCat.color, opacity: 0.6 }} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: currentCat.color, opacity: 0.6 }}>
                        {currentCat.label}
                      </span>
                    </>
                  )}
                </div>
                <h2 className="text-base font-semibold text-white mb-1">{selectedTask.title}</h2>
                <p className="text-[12px] text-slate-500 leading-relaxed">{selectedTask.description}</p>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-7 py-5 space-y-5">

                  {/* Context input */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      {selectedTask.inputLabel}
                      <span className="text-slate-700 normal-case font-normal ml-1">— optional but improves output</span>
                    </label>
                    <textarea
                      value={userContext}
                      onChange={e => setUserContext(e.target.value)}
                      rows={4}
                      placeholder={selectedTask.inputPlaceholder}
                      className="w-full px-4 py-3 rounded-xl text-sm text-slate-200 placeholder-slate-700 focus:outline-none transition-all resize-none leading-relaxed"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                    />
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-sm"
                      style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.22)', color: '#f87171' }}>
                      {error}
                    </div>
                  )}

                  {/* Generate button */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleAssist}
                      disabled={streaming || !apiKey.trim()}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: currentCat ? currentCat.accent : 'rgba(148,163,184,0.08)',
                        border: `1px solid ${currentCat ? currentCat.color + '30' : 'rgba(148,163,184,0.20)'}`,
                        color: currentCat?.color ?? '#94a3b8',
                      }}>
                      {streaming
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</>
                        : <><Sparkles className="w-4 h-4" />Generate Guidance</>}
                    </button>
                    {done && (
                      <>
                        <button onClick={handleCopy}
                          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: copied ? '#34d399' : '#64748b' }}>
                          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                        <button onClick={() => { setAiOutput(''); setDone(false) }}
                          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b' }}>
                          <RotateCcw className="w-3.5 h-3.5" />Reset
                        </button>
                      </>
                    )}
                  </div>

                  {/* AI output */}
                  <AnimatePresence>
                    {(aiOutput || streaming) && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border border-white/[0.07] overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.05]">
                          {streaming && <Loader2 className="w-3 h-3 text-slate-600 animate-spin" />}
                          {done && currentCat && <currentCat.icon className="w-3 h-3" style={{ color: currentCat.color, opacity: 0.5 }} />}
                          <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                            {streaming ? 'Generating…' : 'Architecture Guidance'}
                          </span>
                          {done && (
                            <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-700">
                              <Check className="w-3 h-3 text-emerald-600" />Complete
                            </span>
                          )}
                        </div>
                        <div ref={outputRef} className="px-5 py-4 max-h-[520px] overflow-y-auto">
                          <pre className="text-[12.5px] text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">
                            {aiOutput}
                            {streaming && <span className="inline-block w-1.5 h-4 bg-slate-500 animate-pulse ml-0.5 align-middle" />}
                          </pre>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Next task suggestion */}
                  {done && currentCat && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="rounded-xl border border-white/[0.06] p-4">
                      <p className="text-[11px] text-slate-600 mb-3">Continue with a related skill:</p>
                      <div className="flex flex-wrap gap-2">
                        {currentCat.tasks
                          .filter(t => t.id !== selectedTask.id)
                          .slice(0, 3)
                          .map(t => (
                            <button key={t.id}
                              onClick={() => handleSelectTask(t)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                              style={{ background: currentCat.accent, border: `1px solid ${currentCat.color}20`, color: currentCat.color }}>
                              <ArrowRight className="w-3 h-3" />
                              {t.title.split(' ').slice(0, 4).join(' ')}…
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}

                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
