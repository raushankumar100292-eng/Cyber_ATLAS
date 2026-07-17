import { useMemo, useRef } from 'react'
import type { ElementType } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import {
  Search, Hammer, LogIn, Terminal, Anchor, TrendingUp,
  EyeOff, KeyRound, Compass, ArrowRightLeft, Database,
  Radio, Upload, Flame, Shield,
} from 'lucide-react'
import { tactics } from '../../lib/atlas'
import { colorForTactic } from '../../lib/theme'
import { useStore } from '../../lib/store'
import { tacticCoverage } from '../../lib/coverage'

// ── Per-tactic icon map ───────────────────────────────────────────────────────

const TACTIC_ICON_MAP: Record<string, ElementType> = {
  'TA0043': Search,        // Reconnaissance
  'TA0042': Hammer,        // Resource Development
  'TA0001': LogIn,         // Initial Access
  'TA0002': Terminal,      // Execution
  'TA0003': Anchor,        // Persistence
  'TA0004': TrendingUp,    // Privilege Escalation
  'TA0005': EyeOff,        // Defense Evasion
  'TA0006': KeyRound,      // Credential Access
  'TA0007': Compass,       // Discovery
  'TA0008': ArrowRightLeft, // Lateral Movement
  'TA0009': Database,      // Collection
  'TA0011': Radio,         // Command and Control
  'TA0010': Upload,        // Exfiltration
  'TA0040': Flame,         // Impact
}

function TacticIcon({ id, color, size }: { id: string; color: string; size: number }) {
  const Icon = TACTIC_ICON_MAP[id] ?? Shield
  return <Icon size={size} style={{ color, flexShrink: 0 }} strokeWidth={2.2} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMesh = THREE.Mesh<any, any>

export const ORBIT_RADIUS = 2.2
const ORBIT_TILT = -Math.PI * 0.16
const N = tactics.length

function coverageColor(pct: number): string {
  if (pct >= 0.75) return '#22c55e'
  if (pct >= 0.4) return '#f59e0b'
  if (pct > 0) return '#f97316'
  return '#f43f5e'
}

// Animated beam from globe center to a covered tactic node
function ConnectionBeam({
  toX, toZ, color, phase,
}: {
  toX: number; toZ: number; color: string; phase: number
}) {
  const dotRef = useRef<THREE.Mesh>(null!)
  const matRef = useRef<THREE.MeshBasicMaterial>(null!)
  const lineMat = useRef<THREE.LineBasicMaterial>(null!)
  const origin = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  const target = useMemo(() => new THREE.Vector3(toX, 0, toZ), [toX, toZ])

  useFrame(({ clock }) => {
    const t = ((clock.elapsedTime * 0.45 + phase) % 1)
    dotRef.current.position.lerpVectors(origin, target, t)
    const fade = t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1
    matRef.current.opacity = fade * 0.9
    lineMat.current.opacity = 0.18 + 0.07 * Math.sin(clock.elapsedTime * 1.5 + phase * 6)
  })

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, 0, 0, toX, 0, toZ]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial ref={lineMat} color={color} transparent opacity={0.18} />
      </line>
      <mesh ref={dotRef}>
        <sphereGeometry args={[0.028, 8, 8]} />
        <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

function TacticNode({
  tactic,
  isSelected,
  isHovered,
  anyHovered,
  angle,
}: {
  tactic: (typeof tactics)[0]
  isSelected: boolean
  isHovered: boolean
  anyHovered: boolean
  angle: number
}) {
  const selectTactic  = useStore(s => s.selectTactic)
  const hoverTactic   = useStore(s => s.hoverTactic)
  const pinTactic     = useStore(s => s.pinTactic)
  const pinnedTacticId = useStore(s => s.pinnedTacticId)
  const coverageMap   = useStore(s => s.coverageMap)
  const useCaseTacticMap = useStore(s => s.useCaseTacticMap)
  const pulseRef    = useRef<AnyMesh>(null!)
  const glowRingRef = useRef<AnyMesh>(null!)
  const glowMatRef  = useRef<THREE.MeshBasicMaterial>(null!)

  const x = ORBIT_RADIUS * Math.cos(angle)
  const z = ORBIT_RADIUS * Math.sin(angle)
  const nx = Math.cos(angle)
  const nz = Math.sin(angle)
  const tacticCol = colorForTactic(tactic.id)
  const isPinned  = pinnedTacticId === tactic.id
  const active    = isSelected || isHovered || isPinned
  const isDimmed  = anyHovered && !active

  const { cvgPct, cvgCol, arcGeo } = useMemo(() => {
    const hasAttck = useCaseTacticMap.size > 0
    const hasAtlas = coverageMap.size > 0
    if (!hasAttck && !hasAtlas) return { cvgPct: -1, cvgCol: tacticCol, arcGeo: null }

    let pct = 0
    if (hasAttck) {
      const count = useCaseTacticMap.get(tactic.name.toLowerCase().trim()) ?? 0
      const maxCount = Math.max(1, ...Array.from(useCaseTacticMap.values()))
      pct = count / maxCount
    } else {
      const c = tacticCoverage(tactic.id, coverageMap)
      pct = c.total > 0 ? (c.full + c.partial * 0.5) / c.total : 0
    }

    const col = coverageColor(pct)
    const geo = new THREE.RingGeometry(0.072, 0.112, 48, 1, -Math.PI / 2, pct * Math.PI * 2)
    return { cvgPct: pct, cvgCol: col, arcGeo: geo }
  }, [tactic.id, tactic.name, coverageMap, useCaseTacticMap, tacticCol])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (pulseRef.current && active && !isDimmed) {
      const speed = isHovered ? 4.5 : 2.5
      const amp = isHovered ? 0.65 : 0.4
      pulseRef.current.scale.setScalar(1 + amp * Math.abs(Math.sin(t * speed)))
    }
    if (glowRingRef.current && glowMatRef.current) {
      if (isHovered) {
        glowMatRef.current.opacity = 0.18 + 0.14 * Math.abs(Math.sin(t * 2.0))
        const s = 1.15 + 0.28 * Math.abs(Math.sin(t * 1.6))
        glowRingRef.current.scale.setScalar(s)
      } else {
        glowMatRef.current.opacity = 0
      }
    }
  })

  const nodeColor = cvgPct >= 0 ? cvgCol : tacticCol
  const orbRadius = isHovered ? 0.072 : isDimmed ? 0.022 : (isSelected ? 0.054 : 0.034)

  return (
    <group position={[x, 0, z]}>
      {/* Hit area — click pins the intel panel; hover previews it */}
      <mesh
        onClick={() => {
          selectTactic(isSelected ? null : tactic.id)
          pinTactic(isPinned ? null : tactic.id)
        }}
        onPointerOver={() => hoverTactic(tactic.id)}
        onPointerOut={() => hoverTactic(null)}
      >
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Outer glow ring — only visible when hovered */}
      <mesh ref={glowRingRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.09, 0.26, 64]} />
        <meshBasicMaterial
          ref={glowMatRef}
          color={nodeColor}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Core orb */}
      <mesh>
        <sphereGeometry args={[orbRadius, 16, 16]} />
        <meshBasicMaterial
          color={nodeColor}
          transparent
          opacity={isDimmed ? 0.35 : 1}
        />
      </mesh>

      {/* Coverage arc */}
      {arcGeo && (
        <mesh geometry={arcGeo} rotation={[Math.PI / 2, 0, 0]}>
          <meshBasicMaterial
            color={cvgCol}
            transparent
            opacity={isDimmed ? 0.18 : 0.88}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Background ring */}
      {cvgPct >= 0 && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.072, 0.112, 48]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={isDimmed ? 0.02 : 0.14} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Pulse ring when active */}
      {active && (
        <mesh ref={pulseRef} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.062, 0.13, 32]} />
          <meshBasicMaterial
            color={nodeColor}
            transparent
            opacity={isHovered ? 0.55 : 0.45}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Radial connector */}
      <Line
        points={[[0, 0, 0], [nx * 0.26, 0, nz * 0.26]]}
        color={nodeColor}
        lineWidth={isHovered ? 1.2 : 0.7}
        transparent
        opacity={isDimmed ? 0.08 : (active ? 0.7 : 0.25)}
      />

      {/* Label — zIndexRange kept below HoverIntelPanel (z-50) */}
      <Html
        center
        position={[nx * 0.48, 0, nz * 0.48]}
        distanceFactor={12}
        zIndexRange={[9, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 2,
          pointerEvents: 'none',
        }}>
          {/* Tactic name — always visible, no background */}
          <span style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: isHovered ? '12px' : (isPinned ? '11.5px' : '10.5px'),
            fontWeight: isHovered ? 700 : (isPinned ? 700 : 500),
            color: isHovered ? '#ffffff' : (isPinned ? tacticCol : '#dde6f0'),
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
            textShadow: isHovered
              ? `0 0 12px ${tacticCol}cc, 0 1px 4px rgba(0,0,0,1)`
              : `0 1px 4px rgba(0,0,0,1), 0 0 6px rgba(0,0,0,0.95)`,
            opacity: isDimmed ? 0.22 : 1,
            transition: 'all 0.2s ease',
          }}>
            {tactic.name}
          </span>

          {/* Coverage % — always visible when coverage data is loaded */}
          {cvgPct >= 0 && (
            <span style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: isHovered ? '10px' : '9px',
              fontWeight: 700,
              color: cvgCol,
              textShadow: isHovered
                ? `0 0 10px ${cvgCol}cc, 0 1px 3px rgba(0,0,0,1)`
                : `0 0 5px ${cvgCol}66, 0 1px 3px rgba(0,0,0,1)`,
              letterSpacing: '0.05em',
              opacity: isDimmed ? 0.20 : (active ? 1 : 0.80),
              transition: 'all 0.2s ease',
            }}>
              {Math.round(cvgPct * 100)}%
            </span>
          )}
        </div>
      </Html>
    </group>
  )
}

export default function TacticOrbitRing() {
  const selectedTacticId  = useStore(s => s.selectedTacticId)
  const hoveredTacticId   = useStore(s => s.hoveredTacticId)
  const pinnedTacticId    = useStore(s => s.pinnedTacticId)
  const coverageMap       = useStore(s => s.coverageMap)
  const useCaseTacticMap  = useStore(s => s.useCaseTacticMap)

  const ringPoints = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2
      pts.push(new THREE.Vector3(ORBIT_RADIUS * Math.cos(a), 0, ORBIT_RADIUS * Math.sin(a)))
    }
    return pts
  }, [])

  // Only draw beams for tactics that have coverage
  const coveredTactics = useMemo(() => {
    const hasAttck = useCaseTacticMap.size > 0
    const hasAtlas = coverageMap.size > 0
    if (!hasAttck && !hasAtlas) return []
    const maxCount = hasAttck ? Math.max(1, ...Array.from(useCaseTacticMap.values())) : 1
    return tactics
      .map((tac, i) => {
        let pct = 0
        if (hasAttck) {
          const count = useCaseTacticMap.get(tac.name.toLowerCase().trim()) ?? 0
          pct = count / maxCount
        } else {
          const c = tacticCoverage(tac.id, coverageMap)
          pct = c.total > 0 ? (c.full + c.partial * 0.5) / c.total : 0
        }
        if (pct === 0) return null
        const angle = (i / N) * Math.PI * 2
        return {
          tacticId: tac.id,
          angle,
          x: ORBIT_RADIUS * Math.cos(angle),
          z: ORBIT_RADIUS * Math.sin(angle),
          color: coverageColor(pct),
          phase: i / N,
        }
      })
      .filter(Boolean) as { tacticId: string; angle: number; x: number; z: number; color: string; phase: number }[]
  }, [coverageMap, useCaseTacticMap])

  return (
    <group rotation={[ORBIT_TILT, 0, 0]}>
      {/* Orbit ring guide */}
      <Line points={ringPoints} color="#00e5ff" lineWidth={0.6} transparent opacity={0.1} />

      {/* Animated coverage beams */}
      {coveredTactics.map(ct => (
        <ConnectionBeam
          key={ct.tacticId}
          toX={ct.x}
          toZ={ct.z}
          color={ct.color}
          phase={ct.phase}
        />
      ))}

      {/* Tactic nodes */}
      {tactics.map((tactic, i) => (
        <TacticNode
          key={tactic.id}
          tactic={tactic}
          angle={(i / N) * Math.PI * 2}
          isSelected={selectedTacticId === tactic.id}
          isHovered={hoveredTacticId === tactic.id}
          anyHovered={hoveredTacticId !== null || pinnedTacticId !== null}
        />
      ))}
    </group>
  )
}
