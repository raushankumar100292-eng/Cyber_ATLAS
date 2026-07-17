import { useMemo } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useStore } from '../../lib/store'

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewDir;
  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vUv       = uv;
    vec4 mv   = modelViewMatrix * vec4(position, 1.0);
    vViewDir  = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const EARTH_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    float PI = 3.14159265;
    float gx = step(0.97, abs(sin(vUv.x * 36.0 * PI)));
    float gy = step(0.97, abs(sin(vUv.y * 18.0 * PI)));
    float grid = max(gx, gy);

    float n1 = noise(vUv * 4.5);
    float n2 = noise(vUv * 2.5 + vec2(1.7, 0.9));
    float land = step(0.20, n1 * n2 + n1 * 0.3);

    float rimF = 1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0);
    float rim  = pow(rimF, 3.5);

    vec3 ocean   = vec3(0.01, 0.04, 0.11);
    vec3 landCol = mix(ocean, vec3(0.04, 0.20, 0.10), land);
    vec3 gridCol = vec3(0.0, 0.62, 0.9) * grid * 0.35;
    vec3 rimCol  = vec3(0.0, 0.88, 1.0) * rim * 0.65;

    gl_FragColor = vec4(landCol + gridCol + rimCol, 1.0);
  }
`

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mv  = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const ATMO_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
    float rim    = clamp(1.0 - facing, 0.0, 1.0);
    float glow   = pow(rim, 3.2);
    gl_FragColor = vec4(0.0, 0.88, 1.0, 1.0) * glow * 1.6;
  }
`

// Globe radius — further reduced 20% so orbit ring has more visual breathing room
export const GLOBE_RADIUS = 0.60

export default function Earth() {
  const clientName   = useStore(s => s.clientName)
  const industryLabel = useStore(s => s.industryLabel)

  const earthMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
    [],
  )

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  )

  return (
    <group>
      <mesh material={earthMat}>
        <sphereGeometry args={[GLOBE_RADIUS, 72, 72]} />
      </mesh>
      <mesh material={atmoMat}>
        <sphereGeometry args={[GLOBE_RADIUS * 1.16, 32, 32]} />
      </mesh>

      {/* MITRE ATT&CK shield badge + client name — rendered at globe center */}
      <Html center position={[0, 0, GLOBE_RADIUS * 0.01]} distanceFactor={4.5} zIndexRange={[9, 0]}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          pointerEvents: 'none',
          userSelect: 'none',
          filter: 'drop-shadow(0 0 8px rgba(0,229,255,0.55)) drop-shadow(0 0 20px rgba(0,229,255,0.25))',
        }}>
          <svg width="72" height="84" viewBox="0 0 38 44" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="shieldGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="shieldFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(0,229,255,0.18)" />
                <stop offset="100%" stopColor="rgba(0,229,255,0.04)" />
              </linearGradient>
            </defs>

            {/* Outer shield */}
            <path
              d="M19 1L2 8v12c0 10.5 7.3 20.3 17 23 9.7-2.7 17-12.5 17-23V8L19 1z"
              fill="url(#shieldFill)"
              stroke="rgba(0,229,255,0.80)"
              strokeWidth="1.0"
              filter="url(#shieldGlow)"
            />
            {/* Inner shield */}
            <path
              d="M19 6L6 12v9c0 8 5.5 15.3 13 17.5 7.5-2.2 13-9.5 13-17.5v-9L19 6z"
              fill="rgba(0,229,255,0.06)"
              stroke="rgba(0,229,255,0.38)"
              strokeWidth="0.7"
            />
            {/* Top accent line */}
            <line x1="9" y1="10" x2="29" y2="10" stroke="rgba(0,229,255,0.18)" strokeWidth="0.4"/>

            {/* MITRE text */}
            <text x="19" y="22" textAnchor="middle" fontSize="6.8" fontWeight="800"
              fill="rgba(0,229,255,1.0)" fontFamily="Inter,sans-serif" letterSpacing="0.9">
              MITRE
            </text>
            {/* Divider */}
            <line x1="8" y1="25.5" x2="30" y2="25.5" stroke="rgba(0,229,255,0.45)" strokeWidth="0.55"/>
            {/* ATT&CK text */}
            <text x="19" y="32.5" textAnchor="middle" fontSize="6.0" fontWeight="700"
              fill="rgba(0,229,255,0.92)" fontFamily="Inter,sans-serif" letterSpacing="0.6">
              ATT&amp;CK
            </text>
          </svg>

          {/* Client name + industry — appears below shield after data upload */}
          {clientName && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              marginTop: 5,
            }}>
              {/* Separator line */}
              <div style={{
                width: 40,
                height: 1,
                background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.45), transparent)',
              }} />
              {/* Client name */}
              <span style={{
                fontFamily: 'Orbitron, sans-serif',
                fontSize: 9,
                fontWeight: 700,
                color: 'rgba(0,229,255,0.95)',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                textShadow: '0 0 10px rgba(0,229,255,0.7), 0 1px 4px rgba(0,0,0,1)',
                whiteSpace: 'nowrap',
              }}>
                {clientName}
              </span>
              {/* Industry label */}
              {industryLabel && (
                <span style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 8,
                  fontWeight: 500,
                  color: 'rgba(148,163,184,0.80)',
                  letterSpacing: '0.06em',
                  textShadow: '0 1px 4px rgba(0,0,0,1)',
                  whiteSpace: 'nowrap',
                }}>
                  {industryLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </Html>
    </group>
  )
}
