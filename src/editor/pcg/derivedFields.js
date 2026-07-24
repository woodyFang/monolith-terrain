import { nearestPointOnSpline } from '../editableTerrainData.js'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-8, edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function distanceToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq > 1e-8 ? clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1) : 0
  const px = ax + dx * t
  const pz = az + dz * t
  return Math.hypot(x - px, z - pz)
}

function sampleField(field, worldSize, resolution, x, z) {
  const u = clamp(x / worldSize + 0.5, 0, 1) * resolution
  const v = clamp(z / worldSize + 0.5, 0, 1) * resolution
  const x0 = Math.floor(u)
  const z0 = Math.floor(v)
  const x1 = Math.min(resolution, x0 + 1)
  const z1 = Math.min(resolution, z0 + 1)
  const tx = u - x0
  const tz = v - z0
  const size = resolution + 1
  const a = field[z0 * size + x0]
  const b = field[z0 * size + x1]
  const c = field[z1 * size + x0]
  const d = field[z1 * size + x1]
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
}

function nearestRoadDistance(data, x, z) {
  let distance = Infinity
  for (const spline of data.splines) {
    if (spline.type !== 'road' || spline.points.length < 2) continue
    distance = Math.min(distance, nearestPointOnSpline(x, z, spline.points).distance)
  }
  return Number.isFinite(distance) ? distance : data.worldSize
}

export function buildDerivedFields(data, options = {}) {
  const resolution = options.resolution ?? data.resolution
  const worldSize = data.worldSize
  const vertexSize = resolution + 1
  const slope = new Float32Array(vertexSize * vertexSize)
  const roadDistance = new Float32Array(vertexSize * vertexSize)
  const buildableScore = new Float32Array(vertexSize * vertexSize)
  const step = worldSize / resolution
  const half = worldSize / 2

  for (let iz = 0; iz <= resolution; iz++) {
    const z = -half + (iz / resolution) * worldSize
    for (let ix = 0; ix <= resolution; ix++) {
      const x = -half + (ix / resolution) * worldSize
      const index = iz * vertexSize + ix
      const hL = data.sampleHeight(x - step, z)
      const hR = data.sampleHeight(x + step, z)
      const hD = data.sampleHeight(x, z - step)
      const hU = data.sampleHeight(x, z + step)
      const dx = (hR - hL) / (2 * step)
      const dz = (hU - hD) / (2 * step)
      const slopeValue = Math.atan(Math.hypot(dx, dz))
      const roadDistanceValue = nearestRoadDistance(data, x, z)
      const buildable = data.sampleMask('buildable', x, z)
      const water = data.sampleMask('water', x, z)
      const blocked = data.sampleMask('blocked', x, z)
      const nearRoad = 1 - smoothstep(2, 10, roadDistanceValue)
      const slopePenalty = smoothstep(options.buildableSlopeStart ?? 0.26, options.buildableSlopeEnd ?? 0.62, slopeValue)

      slope[index] = slopeValue
      roadDistance[index] = roadDistanceValue
      buildableScore[index] = clamp(buildable + nearRoad * 0.35 - slopePenalty - water * 2 - blocked * 3, 0, 1)
    }
  }

  return {
    resolution,
    worldSize,
    slope,
    roadDistance,
    buildableScore,
    sampleSlope: (x, z) => sampleField(slope, worldSize, resolution, x, z),
    sampleRoadDistance: (x, z) => sampleField(roadDistance, worldSize, resolution, x, z),
    sampleBuildableScore: (x, z) => sampleField(buildableScore, worldSize, resolution, x, z),
  }
}

export { distanceToSegment, sampleField }
