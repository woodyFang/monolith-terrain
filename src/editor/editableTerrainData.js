export const MASK_LAYERS = ['road', 'buildable', 'water', 'vegetation', 'blocked', 'spawnDensity']

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clamp01(value) {
  return clamp(value, 0, 1)
}

const OPERATOR_BLEND_MODES = new Set(['add', 'min', 'max', 'replace'])

function normalizeOperatorBlendMode(type, blendMode) {
  return OPERATOR_BLEND_MODES.has(blendMode) ? blendMode : defaultOperatorBlendMode(type)
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / Math.max(1e-8, edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function smoothFalloff(distance, width) {
  if (width <= 0 || distance >= width) return 0
  const t = 1 - distance / width
  return t * t * (3 - 2 * t)
}

function validateProjectCollection(project, key) {
  const value = project[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError(`Invalid terrain project: ${key} must be an array`)
  return value
}

function validateTerrainProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new TypeError('Invalid terrain project: expected an object')
  }
  if (project.version !== undefined && project.version !== 1) {
    throw new TypeError(`Unsupported terrain project version: ${project.version}`)
  }
  if (project.terrain !== undefined && (!project.terrain || typeof project.terrain !== 'object' || Array.isArray(project.terrain))) {
    throw new TypeError('Invalid terrain project: terrain must be an object')
  }
  return {
    operators: validateProjectCollection(project, 'operators'),
    regions: validateProjectCollection(project, 'regions'),
    splines: validateProjectCollection(project, 'splines'),
  }
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

function sampleCatmullRom(points, samplesPerSegment = 12) {
  if (points.length <= 2) return points.map(([x, z]) => [x, z])
  const sampled = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    if (i === 0) sampled.push([p1[0], p1[1]])
    for (let step = 1; step <= samplesPerSegment; step++) {
      const t = step / samplesPerSegment
      const t2 = t * t
      const t3 = t2 * t
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
      const z =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      sampled.push([x, z])
    }
  }
  return sampled
}

function sampleSplinePoints(points, samplesPerSegment = 12) {
  if (points.length < 2) return points.map(([x, z]) => [x, z])
  return sampleCatmullRom(points, samplesPerSegment)
}

function nearestPointOnPolyline(x, z, points) {
  let nearest = { distance: Infinity, x, z }
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz
    const t = lengthSq > 1e-8 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
    const px = ax + dx * t
    const pz = az + dz * t
    const distance = Math.hypot(x - px, z - pz)
    if (distance < nearest.distance) nearest = { distance, x: px, z: pz }
  }
  return nearest
}

function nearestPointOnSpline(x, z, points) {
  return nearestPointOnPolyline(x, z, sampleSplinePoints(points))
}

function defaultOperatorMasks(type) {
  if (type === 'mountain' || type === 'ridge') return ['blocked']
  if (type === 'basin') return ['buildable']
  if (type === 'plateau') return ['buildable']
  return ['buildable']
}

function defaultOperatorBlendMode(type) {
  if (type === 'basin') return 'min'
  if (type === 'mountain' || type === 'ridge') return 'max'
  if (type === 'plateau') return 'replace'
  return 'add'
}

function normalizedOperatorDistance(operator, x, z) {
  const radiusX = Math.max(1e-5, operator.radiusX ?? operator.radius ?? 1)
  const radiusZ = Math.max(1e-5, operator.radiusZ ?? operator.radius ?? 1)
  const rotation = operator.rotation ?? 0
  const cos = Math.cos(-rotation)
  const sin = Math.sin(-rotation)
  const dx = x - (operator.center?.[0] ?? 0)
  const dz = z - (operator.center?.[1] ?? 0)
  const lx = dx * cos - dz * sin
  const lz = dx * sin + dz * cos
  const nx = lx / radiusX
  const nz = lz / radiusZ
  return Math.sqrt(nx * nx + nz * nz)
}

function operatorInfluence(operator, distance) {
  const radius = Math.max(1e-5, operator.radiusX ?? operator.radius ?? 1, operator.radiusZ ?? operator.radius ?? 1)
  const blend = Math.max(0, Math.min(0.95, (operator.blendWidth ?? radius * 0.35) / radius))
  if (blend <= 0) return distance <= 1 ? 1 : 0
  return 1 - smoothstep(1 - blend, 1 + blend, distance)
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
    this.operators = []
    this.regions = []
    this.splines = []
    this._nextId = 1
    this.baseSampler = () => 0
  }

  beginBatch() {
    this._batchDepth = (this._batchDepth || 0) + 1
  }

  endBatch() {
    if (!this._batchDepth) return
    this._batchDepth -= 1
    if (!this._batchDepth) this.rebuild()
  }

  requestRebuild() {
    if (!this._batchDepth) this.rebuild()
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
    this.requestRebuild()
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

  addOperator(operator) {
    const type = operator.type || 'basin'
    const radius = operator.radius ?? Math.max(operator.radiusX ?? 6, operator.radiusZ ?? 6)
    const center = operator.center ? [...operator.center] : [0, 0]
    const localBase = this.baseSampler(center[0], center[1])
    const item = {
      id: operator.id || `shape-${String(this._nextId++).padStart(3, '0')}`,
      type,
      center,
      radiusX: operator.radiusX ?? radius,
      radiusZ: operator.radiusZ ?? radius,
      rotation: operator.rotation ?? 0,
      height:
        operator.height ??
        (type === 'mountain' || type === 'ridge' ? 2.2 : type === 'plateau' ? localBase : -1.2),
      blendWidth: operator.blendWidth ?? radius * 0.35,
      rimHeight: operator.rimHeight ?? (type === 'basin' ? Math.abs(operator.height ?? -1.2) * 0.22 : 0),
      sharpness: operator.sharpness ?? (type === 'mountain' || type === 'ridge' ? 1.8 : 1.1),
      blendMode: normalizeOperatorBlendMode(type, operator.blendMode),
      affectedMasks: operator.affectedMasks || defaultOperatorMasks(type),
    }
    this.operators.push(item)
    this.requestRebuild()
    return item
  }

  addRegion(region) {
    const item = {
      id: region.id || `area-${String(this._nextId++).padStart(3, '0')}`,
      type: region.type || 'buildable',
      points: region.points.map(([x, z]) => [x, z]),
      fill: region.fill ?? 1,
      edgeFalloff: region.edgeFalloff ?? 0.8,
      heightMode: region.heightMode || (region.type === 'buildable' ? 'flatten' : 'none'),
      heightTarget: region.heightTarget ?? null,
      heightStrength: region.heightStrength ?? 1,
      affectedMasks: region.affectedMasks || [region.type || 'buildable'],
    }
    this.regions.push(item)
    this.requestRebuild()
    return item
  }

  addSpline(spline) {
    const item = {
      id: spline.id || `spline-${String(this._nextId++).padStart(3, '0')}`,
      type: spline.type || 'road',
      points: spline.points.map(([x, z]) => [x, z]),
      width: spline.width ?? 4,
      falloff: spline.falloff ?? 1.2,
      heightMode: spline.heightMode || (spline.type === 'road' ? 'flatten' : 'none'),
      heightStrength: spline.heightStrength ?? 1,
      maskLayer: spline.maskLayer || spline.type || 'road',
      maskValue: spline.maskValue ?? 1,
    }
    this.splines.push(item)
    this.requestRebuild()
    return item
  }

  removeObject(id) {
    this.operators = this.operators.filter((item) => item.id !== id)
    this.regions = this.regions.filter((item) => item.id !== id)
    this.splines = this.splines.filter((item) => item.id !== id)
    this.requestRebuild()
  }

  clearEdits() {
    this.operators = []
    this.regions = []
    this.splines = []
    this.editDelta.fill(0)
    this.requestRebuild()
  }

  applyOperator(operator, x, z) {
    const distance = normalizedOperatorDistance(operator, x, z)
    const influence = operatorInfluence(operator, distance)
    if (influence <= 0) return 0

    if (operator.type === 'mountain' || operator.type === 'ridge') {
      const core = Math.pow(Math.max(0, 1 - distance), operator.sharpness ?? 1.8)
      return influence * (operator.height ?? 0) * core
    }

    if (operator.type === 'plateau') {
      const base = this.baseSampler(x, z)
      return influence * ((operator.height ?? base) - base)
    }

    if (operator.type === 'basin') {
      const core = Math.pow(Math.max(0, 1 - distance), operator.sharpness ?? 1.1)
      const rimWidth = Math.max(0.18, (operator.blendWidth ?? 1) / Math.max(1e-5, Math.max(operator.radiusX ?? operator.radius ?? 1, operator.radiusZ ?? operator.radius ?? 1)) * 0.85)
      const rim = (operator.rimHeight ?? 0) * Math.exp(-Math.pow((distance - 1) / rimWidth, 2))
      return influence * ((operator.height ?? 0) * core + rim)
    }

    return influence * (operator.height ?? 0)
  }

  applyOperatorBlend(current, base, delta, operator, influence) {
    if (operator.blendMode === 'min') return delta > 0 ? current + delta : Math.min(current, base + delta)
    if (operator.blendMode === 'max') return Math.max(current, base + delta)
    if (operator.blendMode === 'replace') return current + ((operator.height ?? base) - current) * influence
    return current + delta
  }

  rebuild() {
    this.finalHeight.set(this.baseHeight)
    for (let i = 0; i < this.finalHeight.length; i++) this.finalHeight[i] += this.editDelta[i]
    for (const layer of MASK_LAYERS) this.masks[layer].fill(0)

    for (const operator of this.operators) {
      const layers = operator.affectedMasks.filter((layer) => this.masks[layer])
      for (let iz = 0; iz <= this.resolution; iz++) {
        for (let ix = 0; ix <= this.resolution; ix++) {
          const { x, z } = this.gridToWorld(ix, iz)
          const distance = normalizedOperatorDistance(operator, x, z)
          const influence = operatorInfluence(operator, distance)
          if (influence <= 0) continue
          const index = this.index(ix, iz)
          this.finalHeight[index] = this.applyOperatorBlend(
            this.finalHeight[index],
            this.baseHeight[index],
            this.applyOperator(operator, x, z),
            operator,
            influence
          )
          for (const layer of layers) this.masks[layer][index] = Math.max(this.masks[layer][index], influence)
        }
      }
    }

    for (const region of this.regions) {
      const layers = region.affectedMasks.filter((layer) => this.masks[layer])
      const targetHeight = region.heightTarget ?? this.regionHeightTarget(region)
      for (let iz = 0; iz <= this.resolution; iz++) {
        for (let ix = 0; ix <= this.resolution; ix++) {
          const { x, z } = this.gridToWorld(ix, iz)
          const score = this.regionScore(region, x, z) * region.fill
          if (score <= 0) continue
          const index = this.index(ix, iz)
          for (const layer of layers) this.masks[layer][index] = Math.max(this.masks[layer][index], clamp01(score))
          if (region.heightMode === 'flatten') {
            const strength = clamp01(score * (region.heightStrength ?? 1))
            this.finalHeight[index] += (targetHeight - this.finalHeight[index]) * strength
          }
        }
      }
    }

    for (const spline of this.splines) {
      const layer = this.masks[spline.maskLayer] ? spline.maskLayer : 'road'
      for (let iz = 0; iz <= this.resolution; iz++) {
        for (let ix = 0; ix <= this.resolution; ix++) {
          const { x, z } = this.gridToWorld(ix, iz)
          const nearest = nearestPointOnSpline(x, z, spline.points)
          const score = smoothFalloff(Math.max(0, nearest.distance - spline.width / 2), spline.falloff) * spline.maskValue
          if (score <= 0) continue
          const index = this.index(ix, iz)
          this.masks[layer][index] = Math.max(this.masks[layer][index], clamp01(score))
          if (spline.heightMode === 'flatten') {
            const targetHeight = spline.heightTarget ?? this.baseSampler(nearest.x, nearest.z)
            const strength = clamp01(score * (spline.heightStrength ?? 1))
            this.finalHeight[index] += (targetHeight - this.finalHeight[index]) * strength
          }
        }
      }
    }
  }

  regionHeightTarget(region) {
    if (!region.points.length) return 0
    return region.points.reduce((sum, [x, z]) => sum + this.sampleArray(this.baseHeight, x, z), 0) / region.points.length
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
      operators: this.operators.map((item) => ({ ...item, center: [...item.center] })),
      regions: this.regions.map((item) => ({ ...item, points: item.points.map((point) => [...point]) })),
      splines: this.splines.map((item) => ({ ...item, points: item.points.map((point) => [...point]) })),
      masks: MASK_LAYERS.reduce((result, layer) => {
        result[layer] = { type: 'float32-grid', resolution: this.resolution }
        return result
      }, {}),
    }
  }

  loadJSON(project) {
    if (!project || typeof project !== 'object') throw new TypeError('Invalid terrain project')
    const collections = validateTerrainProject(project)
    this.beginBatch()
    try {
      this.operators = []
      this.regions = []
      this.splines = []
      this._nextId = 1
      for (const operator of collections.operators) this.addOperator(operator)
      for (const region of collections.regions) this.addRegion(region)
      for (const spline of collections.splines) this.addSpline(spline)
      const ids = [...this.operators, ...this.regions, ...this.splines]
      const largestId = ids.reduce((largest, item) => {
        const suffix = Number.parseInt(String(item.id).match(/(\d+)$/)?.[1] || '0', 10)
        return Math.max(largest, suffix)
      }, 0)
      this._nextId = largestId + 1
    } finally {
      this.endBatch()
    }
    return this
  }

  static fromJSON(project, options = {}) {
    const terrain = project?.terrain || {}
    const data = new EditableTerrainData({
      worldSize: options.worldSize ?? terrain.worldSize ?? 56,
      resolution: options.resolution ?? terrain.resolution ?? 128,
    })
    return data.loadJSON(project)
  }
}

export {
  pointInPolygon,
  distanceToPolyline,
  sampleSplinePoints,
  nearestPointOnSpline,
  validateTerrainProject,
  OPERATOR_BLEND_MODES,
}
