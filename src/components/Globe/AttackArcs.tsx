import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../../lib/store'
import { severityColor } from '../../lib/theme'
import type { ThreatEvent } from '../../lib/types'

const EARTH_R = 1.0
const SEGMENTS = 44
const LIFETIME_S = 11

function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -(r * Math.sin(phi) * Math.cos(theta)),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  )
}

function buildArcPoints(src: [number, number], dst: [number, number]): THREE.Vector3[] {
  const p0 = latLngToVec3(src[0], src[1], EARTH_R)
  const p1 = latLngToVec3(dst[0], dst[1], EARTH_R)
  const mid = p0.clone().add(p1).multiplyScalar(0.5)
  const dist = p0.distanceTo(p1)
  mid.setLength(EARTH_R + Math.max(0.28, dist * 0.55))
  return new THREE.QuadraticBezierCurve3(p0, mid, p1).getPoints(SEGMENTS)
}

function ArcLine({ event }: { event: ThreatEvent }) {
  const { line, mat } = useMemo(() => {
    const pts = buildArcPoints(event.srcCoord, event.dstCoord)
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(severityColor[event.severity]),
      transparent: true,
      opacity: 0.8,
    })
    const line = new THREE.Line(geo, mat)
    return { line, mat }
  }, [event.id, event.srcCoord, event.dstCoord, event.severity])

  // Marker sphere that travels along the arc
  const { markerLine, markerMat } = useMemo(() => {
    const pts = buildArcPoints(event.srcCoord, event.dstCoord)
    const geo = new THREE.BufferGeometry().setFromPoints(pts.slice(0, 1))
    const markerMat = new THREE.PointsMaterial({
      color: new THREE.Color(severityColor[event.severity]),
      size: event.severity === 'critical' ? 0.045 : 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
    })
    const markerLine = new THREE.Points(geo, markerMat)
    return { markerLine, markerMat }
  }, [event.id])

  const progressRef = useRef(0)
  const allPoints = useMemo(() => buildArcPoints(event.srcCoord, event.dstCoord), [event.id])

  useFrame((_, delta) => {
    const age = (Date.now() - event.ts) / 1000
    const opacity = Math.max(0, Math.min(0.75, 1 - age / LIFETIME_S))
    mat.opacity = opacity
    line.visible = opacity > 0.01

    // Advance marker
    progressRef.current = Math.min(1, progressRef.current + delta * 0.38)
    const idx = Math.floor(progressRef.current * (allPoints.length - 1))
    const pt = allPoints[Math.min(idx, allPoints.length - 1)]
    markerMat.opacity = opacity * 1.4
    ;(markerLine.geometry as THREE.BufferGeometry).setFromPoints([pt])
  })

  return (
    <>
      <primitive object={line} />
      <primitive object={markerLine} />
    </>
  )
}

export default function AttackArcs() {
  const allEvents = useStore(s => s.events)
  const events = allEvents.slice(0, 14)

  return (
    <>
      {events.map(e => (
        <ArcLine key={e.id} event={e} />
      ))}
    </>
  )
}
