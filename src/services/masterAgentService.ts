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

export interface ExecuteResult {
  success: boolean
  response?: string
  error?: string
  agentName?: string
  durationMs?: number
}

/**
 * Run a prompt on the connected Master Agent over an open session.
 * The session id travels in the X-Session-Id header.
 */
export async function executeOnMasterAgent(
  baseUrl: string,
  sessionId: string,
  prompt: string,
): Promise<ExecuteResult> {
  try {
    const res = await fetch(`${baseUrl}/api/master/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ prompt }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error ?? `HTTP ${res.status}` }
    return data as ExecuteResult
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' }
  }
}
