import { sampleSplinePoints } from '../editableTerrainData.js'
import { createRandom, randomBetween } from './random.js'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function makeFootprint(x, z, width, depth, rotationY) {
  const hw = width / 2
  const hd = depth / 2
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([px, pz]) => [x + px * cos - pz * sin, z + px * sin + pz * cos])
}

function segmentLength(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az)
}

function polylineLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += segmentLength(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
  return total
}

function samplePolyline(points, distance) {
  let traveled = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const length = segmentLength(ax, az, bx, bz)
    if (length < 0.1) continue
    if (traveled + length >= distance) {
      const t = clamp((distance - traveled) / length, 0, 1)
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        dx: (bx - ax) / length,
        dz: (bz - az) / length,
        segmentIndex: i - 1,
      }
    }
    traveled += length
  }
  const a = points[Math.max(0, points.length - 2)]
  const b = points[points.length - 1]
  const length = segmentLength(a[0], a[1], b[0], b[1]) || 1
  return { x: b[0], z: b[1], dx: (b[0] - a[0]) / length, dz: (b[1] - a[1]) / length, segmentIndex: points.length - 2 }
}

function chooseBuilding(random, options) {
  const palettes = options.palette || [
    { type: '小房屋', width: 1.7, depth: 2.1, height: 1.1 },
    { type: '中型建筑', width: 2.2, depth: 2.6, height: 1.4 },
    { type: '塔楼', width: 1.4, depth: 1.4, height: 2.2 },
  ]
  return palettes[Math.floor(random() * palettes.length)]
}

function isCandidateAllowed({ data, fields, occupancy, group, x, z, footprint, options }) {
  if (data.sampleMask('buildable', x, z) < (options.minBuildableMask ?? 0.45)) return false
  if (data.sampleMask('road', x, z) > (options.maxRoadMask ?? 0.55)) return false
  if (data.sampleMask('water', x, z) > (options.maxWaterMask ?? 0.2)) return false
  if (data.sampleMask('blocked', x, z) > (options.maxBlockedMask ?? 0.2)) return false
  if (fields?.sampleSlope && fields.sampleSlope(x, z) > (options.maxSlope ?? 0.52)) return false
  if (occupancy && !occupancy.canOccupyFootprint(group, footprint, options.footprintPadding ?? 0.08)) return false
  return true
}

export function generateBuildings({ seed, data, fields, occupancy, options = {} }) {
  const random = createRandom(seed, '建筑')
  const buildings = []
  const density = options.density ?? 1
  const spacing = options.spacing ?? Math.max(2.5, 4.5 / Math.max(0.15, density))
  const setback = options.setback ?? 0.65
  const group = 'buildingBody'
  let serial = 1

  for (const road of data.splines.filter((item) => item.type === 'road' && item.points.length >= 2)) {
    const roadWidth = road.width ?? 3
    const roadPoints = sampleSplinePoints(road.points, 10)
    const roadLength = polylineLength(roadPoints)
    const count = Math.max(1, Math.floor(roadLength / spacing))

    for (let step = 0; step <= count; step++) {
      if (random() > density) continue
      const t = clamp((step + randomBetween(random, -0.22, 0.22)) / Math.max(1, count), 0.08, 0.92)
      const sample = samplePolyline(roadPoints, roadLength * t)
      const nx = -sample.dz
      const nz = sample.dx
      for (const side of [-1, 1]) {
        if (random() > 0.72 * density) continue
        const spec = chooseBuilding(random, options)
        const width = spec.width * randomBetween(random, 0.9, 1.12)
        const depth = spec.depth * randomBetween(random, 0.9, 1.15)
        const offset = roadWidth / 2 + setback + depth / 2
        const x = sample.x + nx * side * offset
        const z = sample.z + nz * side * offset
        const rotationY = Math.atan2(nx * side, nz * side)
        const footprint = makeFootprint(x, z, width, depth, rotationY)
        if (!isCandidateAllowed({ data, fields, occupancy, group, x, z, footprint, options })) continue

        const height = spec.height * randomBetween(random, 0.9, 1.25)
        const building = {
          id: `建筑-${String(serial++).padStart(3, '0')}`,
          type: spec.type,
          position: [x, data.sampleHeight(x, z), z],
          rotationY,
          scale: [width, height, depth],
          footprint,
          source: {
            generator: '道路两侧建筑',
            roadId: road.id || null,
            segmentIndex: sample.segmentIndex,
            side: side < 0 ? '左侧' : '右侧',
          },
        }
        buildings.push(building)
        occupancy?.occupyFootprint(group, footprint, { source: building.id, strength: 1 })

        const buffer = makeFootprint(x, z, width + 0.9, depth + 0.9, rotationY)
        occupancy?.occupyFootprint('buildingBuffer', buffer, { source: `${building.id}-留白`, strength: 0.45 })
      }
    }
  }

  return buildings
}

export { makeFootprint }
