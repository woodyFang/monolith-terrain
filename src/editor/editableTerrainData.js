export const MASK_LAYERS = ['road', 'buildable', 'water', 'vegetation', 'blocked', 'spawnDensity']

const clamp01 = (v) => Math.max(0, Math.min(1, v))

function smoothFalloff(distance, width) {
  if (width <= 0 || distance >= width) return 0
  const t = 1 - distance / width
  return t * t * (3 - 2 * t)
}

function pointInPolygon(x, z, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0]
    const zi = points[i][1]
    const xj = points[j][0]
    const zj = points[j][1]
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function distanceToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq > 1e-8 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
  const px = ax + dx * t
  const pz = az + dz * t
  return Math.hypot(x - px, z - pz)
}

function distanceToPolyline(x, z, points) {
  let distance = Infinity
  for (let i = 1; i < points.length; i++) {
    distance = Math.min(distance, distanceToSegment(x, z, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]))
  }
  return distance
}

export class EditableTerrainData {
  constructor({ worldSize = 56, resolution = 128 } = {}) {
    this.worldSize = worldSize
    this.resolution = resolution
    this.vertexSize = resolution + 1
    this.baseHeight = new Float32Array(this.vertexSize * this.vertexSize)
    this.editDelta = new Float32Array(this.baseHeight.length)
    this.finalHeight = new Float32Array(this.baseHeight.length)
    this.masks = Object.fromEntries(MASK_LAYERS.map((name) => [name, new Float32Array(this.baseHeight.length)]))
    this.regions = []
    this.splines = []
    this._nextId = 1
    this.baseSampler = () => 0
  }

  setBaseSampler(sampler) {
    this.baseSampler = sampler
    const half = this.worldSize / 2
    for (let iz = 0; iz <= this.resolution; iz++) {
      const z = -half + (iz / this.resolution) * this.worldSize
      for (let ix = 0; ix <= this.resolution; ix++) {
        const x = -half + (ix / this.resolution) * this.worldSize
        this.baseHeight[this.index(ix, iz)] = sampler(x, z)
      }
    }
    this.rebuild()
  }

  index(ix, iz) {
    return iz * this.vertexSize + ix
  }

  worldToGrid(x, z) {
    const u = Math.max(0, Math.min(1, x / this.worldSize + 0.5))
    const v = Math.max(0, Math.min(1, z / this.worldSize + 0.5))
    return { x: u * this.resolution, z: v * this.resolution }
  }

  gridToWorld(ix, iz) {
    return {
      x: (ix / this.resolution - 0.5) * this.worldSize,
      z: (iz / this.resolution - 0.5) * this.worldSize,
    }
  }

  sampleArray(array, x, z) {
    const p = this.worldToGrid(x, z)
    const x0 = Math.floor(p.x)
    const z0 = Math.floor(p.z)
    const x1 = Math.min(this.resolution, x0 + 1)
    const z1 = Math.min(this.resolution, z0 + 1)
    const tx = p.x - x0
    const tz = p.z - z0
    const a = array[this.index(x0, z0)]
    const b = array[this.index(x1, z0)]
    const c = array[this.index(x0, z1)]
    const d = array[this.index(x1, z1)]
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
  }

  sampleHeight(x, z) {
    return this.sampleArray(this.finalHeight, x, z)
  }

  sampleMask(layer, x, z) {
    return this.sampleArray(this.masks[layer] || this.masks.blocked, x, z)
  }

  addRegion(region) {
    const item = {
      id: region.id || `area-${String(this._nextId++).padStart(3, '0')}`,
      type: region.type || 'buildable',
      points: region.points.map(([x, z]) => [x, z]),
      fill: region.fill ?? 1,
      edgeFalloff: region.edgeFalloff ?? 0.8,
      heightMode: region.heightMode || 'none',
      heightTarget: region.heightTarget ?? null,
      heightStrength: region.heightStrength ?? 1,
      affectedMasks: region.affectedMasks || [region.type || 'buildable'],
    }
    this.regions.push(item)
    this.rebuild()
    return item
  }

  addSpline(spline) {
    const item = {
      id: spline.id || `spline-${String(this._nextId++).padStart(3, '0')}`,
      type: spline.type || 'road',
      points: spline.points.map(([x, z]) => [x, z]),
      width: spline.width ?? 4,
      falloff: spline.falloff ?? 1.2,
      heightMode: spline.heightMode || 'none',
      heightStrength: spline.heightStrength ?? 1,
      maskLayer: spline.maskLayer || spline.type || 'road',
      maskValue: spline.maskValue ?? 1,
    }
    this.splines.push(item)
    this.rebuild()
    return item
  }

  removeObject(id) {
    this.regions = this.regions.filter((item) => item.id !== id)
    this.splines = this.splines.filter((item) => item.id !== id)
    this.rebuild()
  }

  clearEdits() {
    this.regions = []
    this.splines = []
    this.editDelta.fill(0)
    this.rebuild()
  }

  rebuild() {
    this.finalHeight.set(this.baseHeight)
    this.finalHeight.forEach((_, i) => {
      this.finalHeight[i] += this.editDelta[i]
    })
    for (const layer of MASK_LAYERS) this.masks[layer].fill(0)

    for (const region of this.regions) {
      const layers = region.affectedMasks.filter((layer) => this.masks[layer])
      for (let iz = 0; iz <= this.resolution; iz++) {
        for (let ix = 0; ix <= this.resolution; ix++) {
          const { x, z } = this.gridToWorld(ix, iz)
          const score = this.regionScore(region, x, z) * region.fill
          if (score <= 0) continue
          const index = this.index(ix, iz)
          for (const layer of layers) this.masks[layer][index] = Math.max(this.masks[layer][index], clamp01(score))
        }
      }
    }

    for (const spline of this.splines) {
      const layer = this.masks[spline.maskLayer] ? spline.maskLayer : 'road'
      for (let iz = 0; iz <= this.resolution; iz++) {
        for (let ix = 0; ix <= this.resolution; ix++) {
          const { x, z } = this.gridToWorld(ix, iz)
          const distance = distanceToPolyline(x, z, spline.points)
          const score = smoothFalloff(Math.max(0, distance - spline.width / 2), spline.falloff) * spline.maskValue
          if (score <= 0) continue
          this.masks[layer][this.index(ix, iz)] = Math.max(this.masks[layer][this.index(ix, iz)], clamp01(score))
        }
      }
    }
  }

  regionScore(region, x, z) {
    if (region.points.length < 3) return 0
    if (pointInPolygon(x, z, region.points)) return 1
    if (!region.edgeFalloff) return 0
    let distance = Infinity
    for (let i = 0; i < region.points.length; i++) {
      const a = region.points[i]
      const b = region.points[(i + 1) % region.points.length]
      distance = Math.min(distance, distanceToSegment(x, z, a[0], a[1], b[0], b[1]))
    }
    return smoothFalloff(distance, region.edgeFalloff)
  }

  toJSON() {
    return {
      version: 1,
      terrain: { worldSize: this.worldSize, resolution: this.resolution },
      regions: this.regions.map((item) => ({ ...item, points: item.points.map((point) => [...point]) })),
      splines: this.splines.map((item) => ({ ...item, points: item.points.map((point) => [...point]) })),
      masks: MASK_LAYERS.reduce((result, layer) => {
        result[layer] = { type: 'float32-grid', resolution: this.resolution }
        return result
      }, {}),
    }
  }
}

export { pointInPolygon, distanceToPolyline }
