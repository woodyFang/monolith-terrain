const DEFAULT_GROUPS = {
  road: { bit: 1 << 0, color: '#f59e0b', priority: 40 },
  roadEdge: { bit: 1 << 1, color: '#fbbf24', priority: 30 },
  buildingBody: { bit: 1 << 2, color: '#64748b', priority: 80 },
  buildingAccess: { bit: 1 << 3, color: '#38bdf8', priority: 50 },
  buildingBuffer: { bit: 1 << 4, color: '#94a3b8', priority: 25 },
  vegetation: { bit: 1 << 5, color: '#22c55e', priority: 20 },
  largeRock: { bit: 1 << 6, color: '#78716c', priority: 35 },
  smallProp: { bit: 1 << 7, color: '#e879f9', priority: 15 },
  water: { bit: 1 << 8, color: '#2563eb', priority: 70 },
  bridge: { bit: 1 << 9, color: '#a16207', priority: 90 },
  traversal: { bit: 1 << 10, color: '#ffffff', priority: 60 },
  blocked: { bit: 1 << 11, color: '#ef4444', priority: 100 },
}

const DEFAULT_CONFLICTS = {
  road: ['buildingBody', 'vegetation', 'largeRock', 'water', 'blocked'],
  buildingBody: ['road', 'buildingBody', 'buildingAccess', 'buildingBuffer', 'vegetation', 'largeRock', 'water', 'blocked', 'traversal'],
  buildingAccess: ['buildingBody', 'largeRock', 'water', 'blocked'],
  buildingBuffer: ['buildingBody', 'water', 'blocked'],
  vegetation: ['road', 'buildingBody', 'water', 'blocked', 'traversal'],
  largeRock: ['road', 'buildingBody', 'buildingAccess', 'vegetation', 'water', 'blocked', 'traversal'],
  smallProp: ['buildingBody', 'water', 'blocked'],
  water: ['road', 'buildingBody', 'buildingAccess', 'buildingBuffer', 'vegetation', 'largeRock', 'smallProp', 'blocked', 'traversal'],
  bridge: ['buildingBody', 'blocked'],
  traversal: ['buildingBody', 'vegetation', 'largeRock', 'water', 'blocked'],
  blocked: Object.keys(DEFAULT_GROUPS).filter((group) => group !== 'blocked'),
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function pointInPolygon(x, z, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0]
    const zi = points[i][1]
    const xj = points[j][0]
    const zj = points[j][1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
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

function distanceToPolygon(x, z, points) {
  let distance = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    distance = Math.min(distance, distanceToSegment(x, z, a[0], a[1], b[0], b[1]))
  }
  return distance
}

export class OccupancyLayer {
  constructor({ worldSize = 56, resolution = 128, groups = DEFAULT_GROUPS, conflicts = DEFAULT_CONFLICTS } = {}) {
    this.worldSize = worldSize
    this.resolution = resolution
    this.vertexSize = resolution + 1
    this.groups = groups
    this.conflicts = conflicts
    this.mask = new Uint32Array(this.vertexSize * this.vertexSize)
    this.strength = new Float32Array(this.mask.length)
    this.priority = new Int16Array(this.mask.length)
    this.color = new Array(this.mask.length).fill(null)
    this.source = new Array(this.mask.length).fill(null)
  }

  clear() {
    this.mask.fill(0)
    this.strength.fill(0)
    this.priority.fill(0)
    this.color.fill(null)
    this.source.fill(null)
  }

  index(ix, iz) {
    return iz * this.vertexSize + ix
  }

  worldToGrid(x, z) {
    const u = clamp(x / this.worldSize + 0.5, 0, 1)
    const v = clamp(z / this.worldSize + 0.5, 0, 1)
    return {
      x: Math.round(u * this.resolution),
      z: Math.round(v * this.resolution),
    }
  }

  gridToWorld(ix, iz) {
    return {
      x: (ix / this.resolution - 0.5) * this.worldSize,
      z: (iz / this.resolution - 0.5) * this.worldSize,
    }
  }

  groupBit(group) {
    return this.groups[group]?.bit ?? 0
  }

  conflictMask(group) {
    return (this.conflicts[group] || []).reduce((mask, item) => mask | this.groupBit(item), 0)
  }

  footprintCells(points, padding = 0) {
    const step = this.worldSize / this.resolution
    const minX = Math.min(...points.map((point) => point[0])) - padding - step
    const maxX = Math.max(...points.map((point) => point[0])) + padding + step
    const minZ = Math.min(...points.map((point) => point[1])) - padding - step
    const maxZ = Math.max(...points.map((point) => point[1])) + padding + step
    const a = this.worldToGrid(minX, minZ)
    const b = this.worldToGrid(maxX, maxZ)
    const cells = []
    const seen = new Set()
    for (let iz = Math.min(a.z, b.z); iz <= Math.max(a.z, b.z); iz++) {
      for (let ix = Math.min(a.x, b.x); ix <= Math.max(a.x, b.x); ix++) {
        const { x, z } = this.gridToWorld(ix, iz)
        if (!pointInPolygon(x, z, points) && distanceToPolygon(x, z, points) > padding) continue
        const index = this.index(ix, iz)
        if (seen.has(index)) continue
        seen.add(index)
        cells.push(index)
      }
    }
    return cells
  }

  canPlaceCells(group, cells) {
    const conflictMask = this.conflictMask(group)
    return cells.every((index) => (this.mask[index] & conflictMask) === 0)
  }

  occupyCells(group, cells, { source = null, strength = 1, color = null } = {}) {
    const info = this.groups[group]
    if (!info) return
    for (const index of cells) {
      this.mask[index] |= info.bit
      if ((info.priority ?? 0) >= this.priority[index]) {
        this.priority[index] = info.priority ?? 0
        this.strength[index] = Math.max(this.strength[index], strength)
        this.color[index] = color || info.color
        this.source[index] = source
      }
    }
  }

  canOccupyFootprint(group, points, padding = 0) {
    return this.canPlaceCells(group, this.footprintCells(points, padding))
  }

  occupyFootprint(group, points, options = {}) {
    const cells = this.footprintCells(points, options.padding ?? 0)
    this.occupyCells(group, cells, options)
    return cells
  }

  sample(x, z) {
    const { x: ix, z: iz } = this.worldToGrid(x, z)
    const index = this.index(ix, iz)
    return {
      mask: this.mask[index],
      strength: this.strength[index],
      color: this.color[index],
      source: this.source[index],
      groups: Object.entries(this.groups)
        .filter(([, info]) => (this.mask[index] & info.bit) !== 0)
        .map(([group]) => group),
    }
  }
}

export { DEFAULT_CONFLICTS, DEFAULT_GROUPS }
