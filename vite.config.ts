import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

// ── Mock placeholder endpoints for Phase 1 ────────────────────────────────────
// Real Agent Pro server (port 3000) replaces these in production.
// In dev, point the Master Agent URL field to http://localhost:5173 to use mocks.
function masterAgentMockPlugin(): Plugin {
  return {
    name: 'master-agent-mock',
    configureServer(server) {
      server.middlewares.use(
        '/api/master/connect',
        (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405); res.end(); return
          }
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { secretKey } = JSON.parse(body || '{}') as Record<string, string>
              if (!secretKey?.trim()) {
                res.writeHead(401, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ connected: false, error: 'Secret key is required' }))
                return
              }
              const sessionId = `session_${Math.random().toString(36).slice(2, 11)}`
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                connected: true,
                sessionId,
                connectedAt: new Date().toISOString(),
              }))
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ connected: false, error: 'Invalid request body' }))
            }
          })
        },
      )

      server.middlewares.use(
        '/api/master/disconnect',
        (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405); res.end(); return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ disconnected: true }))
        },
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), masterAgentMockPlugin()],
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 5173,
    host: true,
  },
})
