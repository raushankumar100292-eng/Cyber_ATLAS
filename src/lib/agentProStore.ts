import { create } from 'zustand'

export type AiProvider = 'claude-cli' | 'grok'

export interface AgentProState {
  masterAgentUrl: string
  masterAgentId: string
  connected: boolean
  connectedAt: string | null
  /** Stored in memory only — never rendered in UI */
  sessionId: string | null
  connecting: boolean
  disconnecting: boolean
  error: string | null
  enabledProvider: AiProvider | null
  /** Claude CLI availability (Agent Pro ↔ Claude), distinct from session health. null = unknown/checking. */
  claudeAvailable: boolean | null
}

interface AgentProActions {
  setMasterAgentUrl: (v: string) => void
  setMasterAgentId: (v: string) => void
  setConnected: (sessionId: string, connectedAt: string) => void
  setDisconnected: () => void
  setConnecting: (v: boolean) => void
  setDisconnecting: (v: boolean) => void
  setError: (e: string | null) => void
  setClaudeAvailable: (v: boolean | null) => void
  toggleProvider: (p: AiProvider) => void
}

export const useAgentProStore = create<AgentProState & AgentProActions>(set => ({
  masterAgentUrl: 'http://localhost:3000',
  masterAgentId: '',
  connected: false,
  connectedAt: null,
  sessionId: null,
  connecting: false,
  disconnecting: false,
  error: null,
  enabledProvider: null,
  claudeAvailable: null,

  setMasterAgentUrl: masterAgentUrl => set({ masterAgentUrl }),
  setMasterAgentId: masterAgentId => set({ masterAgentId }),

  setConnected: (sessionId, connectedAt) =>
    set({ connected: true, sessionId, connectedAt, error: null, connecting: false }),

  setDisconnected: () =>
    set({
      connected: false,
      sessionId: null,
      connectedAt: null,
      enabledProvider: null,
      claudeAvailable: null,
      error: null,
      connecting: false,
      disconnecting: false,
    }),

  setConnecting: connecting => set({ connecting }),
  setDisconnecting: disconnecting => set({ disconnecting }),
  setError: error => set({ error, connecting: false, disconnecting: false }),
  setClaudeAvailable: claudeAvailable => set({ claudeAvailable }),

  toggleProvider: p =>
    set(state => ({
      enabledProvider: state.enabledProvider === p ? null : p,
    })),
}))
