export interface ConnectPayload {
  masterAgentId: string
  secretKey: string
}

export interface ConnectResult {
  connected: boolean
  sessionId?: string
  connectedAt?: string
  error?: string
}

export interface DisconnectResult {
  disconnected: boolean
}

export async function connectToMasterAgent(
  baseUrl: string,
  payload: ConnectPayload,
): Promise<ConnectResult> {
  try {
    const res = await fetch(`${baseUrl}/api/master/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data: ConnectResult = await res.json()
    if (!res.ok) return { connected: false, error: data.error ?? `HTTP ${res.status}` }
    return data
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    }
  }
}

export async function disconnectFromMasterAgent(
  baseUrl: string,
  sessionId?: string,
): Promise<DisconnectResult> {
  try {
    const res = await fetch(`${baseUrl}/api/master/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    })
    return (await res.json()) as DisconnectResult
  } catch {
    return { disconnected: true }
  }
}

export interface MasterStatus {
  connected: boolean
  /** null = unknown/checking */
  claudeAvailable: boolean | null
  detail?: string
}

/**
 * Poll the live health of a connection — session validity AND Claude CLI
 * availability, reported independently.
 */
export async function getMasterStatus(
  baseUrl: string,
  sessionId: string,
): Promise<MasterStatus> {
  try {
    const res = await fetch(`${baseUrl}/api/master/status`, {
      method: 'GET',
      headers: { 'X-Session-Id': sessionId },
    })
    if (!res.ok) return { connected: false, claudeAvailable: null }
    const data = await res.json()
    return {
      connected: !!data.connected,
      claudeAvailable: data.claude ? !!data.claude.available : null,
      detail: data.claude?.detail,
    }
  } catch {
    return { connected: false, claudeAvailable: null }
  }
}

export interface TaskSummary {
  taskId: string
  title: string
  status: string
  turns: number
  createdAt?: string
  updatedAt?: string
}

export interface ThreadMessage {
  role: 'user' | 'assistant'
  content: string
}

/** List the connected agent's conversations (most recently updated first). */
export async function listTasks(baseUrl: string, sessionId: string): Promise<TaskSummary[]> {
  try {
    const res = await fetch(`${baseUrl}/api/master/tasks`, { headers: { 'X-Session-Id': sessionId } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.tasks ?? []) as TaskSummary[]
  } catch {
    return []
  }
}

/** Full transcript for one conversation. */
export async function getTaskThread(baseUrl: string, sessionId: string, taskId: string): Promise<ThreadMessage[]> {
  try {
    const res = await fetch(`${baseUrl}/api/master/tasks?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'X-Session-Id': sessionId },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.messages ?? []).map((m: ThreadMessage) => ({ role: m.role, content: m.content }))
  } catch {
    return []
  }
}

export interface ExecuteResult {
  success: boolean
  response?: string
  error?: string
  agentName?: string
  durationMs?: number
  /** Conversation/task id — pass it back on the next call to keep context. */
  taskId?: string
  turns?: number
}

/**
 * Run a prompt on the connected Master Agent over an open session, within a
 * conversation. Pass the `taskId` returned by the previous call to continue the
 * same thread; omit it to start a fresh conversation. The session id travels in
 * the X-Session-Id header.
 */
export async function executeOnMasterAgent(
  baseUrl: string,
  sessionId: string,
  prompt: string,
  taskId?: string,
): Promise<ExecuteResult> {
  try {
    const res = await fetch(`${baseUrl}/api/master/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify(taskId ? { prompt, taskId } : { prompt }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error ?? `HTTP ${res.status}` }
    return data as ExecuteResult
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' }
  }
}
