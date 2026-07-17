import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense } from 'react'
import * as THREE from 'three'
import Earth from './Earth'
import TacticOrbitRing from './TacticOrbitRing'
import { atlas } from '../../lib/atlas'
import { useStore } from '../../lib/store'

const PANEL_WIDTH = 480

const STATS = [
  { label: 'Tactics',        value: atlas.stats.tactics,        color: '#38bdf8' },
  { label: 'Techniques',     value: atlas.stats.techniques,     color: '#818cf8' },
  { label: 'Sub-Techniques', value: atlas.stats.subtechniques,  color: '#a78bfa' },
  { label: 'Mitigations',    value: atlas.stats.mitigations,    color: '#34d399' },
  { label: 'Case Studies',   value: atlas.stats.caseStudies,    color: '#fbbf24' },
]

// ── Star field ────────────────────────────────────────────────────────────────

function StarField() {
  const { positions, sizes } = useMemo(() => {
    const count = 1600
    const pos  = new Float32Array(count * 3)
    const size = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const r     = 9 + Math.random() * 16
      const theta = Math.random() * Math.PI * 2
      const phi   = Math.acos(2 * Math.random() - 1)
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      pos[i * 3 + 2] = r * Math.cos(phi)
      size[i] = Math.random() > 0.88 ? 0.028 : 0.014
    }
    return { positions: pos, sizes: size }
  }, [])

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('size',     new THREE.BufferAttribute(sizes, 1))
    return g
  }, [positions, sizes])

  const mat = useMemo(() => new THREE.PointsMaterial({
    size: 0.016,
    color: '#cbd5e1',
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: true,
  }), [])

  return <points geometry={geo} material={mat} />
}

// ── Scan ring ─────────────────────────────────────────────────────────────────

function EquatorRing() {
  const geo = useMemo(() => new THREE.TorusGeometry(2.22, 0.004, 4, 120), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#00e5ff', transparent: true, opacity: 0.10,
  }), [])
  return <mesh geometry={geo} material={mat} rotation={[Math.PI / 2, 0, 0]} />
}

// ── Stats HUD ─────────────────────────────────────────────────────────────────

function AtlasStatsHUD() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 18px',
        background: 'rgba(3, 6, 15, 0.84)',
        border: '1px solid rgba(0, 229, 255, 0.10)',
        borderRadius: 12,
        boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 1px 0 rgba(0,229,255,0.08) inset',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 10,
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          position: 'relative',
          width: 8, height: 8,
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            borderRadius: '50%',
            background: '#00e5ff',
            boxShadow: '0 0 8px rgba(0,229,255,1), 0 0 20px rgba(0,229,255,0.5)',
          }} />
        </div>
        <span style={{
          fontFamily: 'Orbitron, sans-serif',
          fontSize: 9.5,
          fontWeight: 800,
          color: '#e2e8f0',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}>
          {atlas.meta.name}
        </span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 8,
          color: '#475569',
          letterSpacing: '0.05em',
        }}>
          {new Date(atlas.meta.generatedAt).getFullYear()}
        </span>
      </div>

      {/* Divider */}
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, rgba(0,229,255,0.15), rgba(0,229,255,0.04), transparent)',
      }} />

      {/* Stat pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {STATS.map((s, i) => (
          <div
            key={s.label}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 5,
              paddingRight: i < STATS.length - 1 ? 14 : 0,
              marginRight: i < STATS.length - 1 ? 14 : 0,
              borderRight: i < STATS.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
            }}
          >
            <span style={{
              fontFamily: 'Orbitron, sans-serif',
              fontSize: 14,
              fontWeight: 700,
              color: s.color,
              letterSpacing: '0.02em',
              lineHeight: 1,
              textShadow: `0 0 14px ${s.color}60`,
            }}>
              {s.value}
            </span>
            <span style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 9,
              color: '#64748b',
              letterSpacing: '0.04em',
            }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Compass ring labels ────────────────────────────────────────────────────────

function CompassOverlay() {
  const labels = [
    { angle: 0,   text: 'N' },
    { angle: 90,  text: 'E' },
    { angle: 180, text: 'S' },
    { angle: 270, text: 'W' },
  ]
  return (
    <>
      {labels.map(({ angle, text }) => (
        <div
          key={text}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `
              translate(-50%, -50%)
              rotate(${angle}deg)
              translateY(-46%)
            `,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            fontWeight: 700,
            color: 'rgba(0,229,255,0.18)',
            letterSpacing: '0.1em',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {text}
        </div>
      ))}
    </>
  )
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export default function GlobeScene() {
  const hoveredTacticId = useStore(s => s.hoveredTacticId)
  const pinnedTacticId  = useStore(s => s.pinnedTacticId)
  const coverage        = useStore(s => s.coverage)
  const isPanelOpen     = !!(hoveredTacticId || pinnedTacticId)
  const hasData         = coverage !== null

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        position: 'relative',
        transition: 'padding-right 0.44s cubic-bezier(0.4, 0, 0.2, 1)',
        paddingRight: isPanelOpen ? PANEL_WIDTH : 0,
      }}
    >
      {/* Radial vignette over canvas */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 4,
        background: 'radial-gradient(ellipse 75% 75% at 50% 50%, transparent 45%, rgba(3,6,15,0.45) 100%)',
        pointerEvents: 'none',
      }} />

      {/* Subtle top gradient to blend with TopBar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 40, zIndex: 4,
        background: 'linear-gradient(to bottom, rgba(3,6,15,0.3), transparent)',
        pointerEvents: 'none',
      }} />

      <Canvas
        style={{ display: 'block', width: '100%', height: '100%' }}
        camera={{ position: [0, 0.9, 5.5], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#050a18']} />

        {/* Lighting for dark space scene */}
        <ambientLight intensity={0.18} />
        <directionalLight position={[5, 3, 3]}   intensity={1.6}  color="#ffffff" />
        <pointLight      position={[-5, -2, -5]}  intensity={0.55} color="#6366f1" />
        <pointLight      position={[2,  5,  2]}   intensity={0.45} color="#0ea5e9" />
        <pointLight      position={[0, -4,  0]}   intensity={0.12} color="#1e3a5f" />

        <Suspense fallback={null}>
          <StarField />
          <EquatorRing />
          <Earth />
          <TacticOrbitRing />
        </Suspense>

        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={3.5}
          maxDistance={11}
          autoRotate
          autoRotateSpeed={0.3}
          enableDamping
          dampingFactor={0.06}
          makeDefault
        />
      </Canvas>

      {/* Bottom stats ribbon — hidden once client data is uploaded and mapped */}
      {!hasData && <AtlasStatsHUD />}
      <CompassOverlay />
    </div>
  )
}
