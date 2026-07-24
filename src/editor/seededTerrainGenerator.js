function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function between(random, min, max) {
  return min + random() * (max - min)
}

function intBetween(random, min, max) {
  return Math.floor(between(random, min, max + 1))
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)]
}

function rounded(value, step = 0.001) {
  return Math.round(value / step) * step
}

function colorFromHsl(h, s, l) {
  return `#${hslToRgb(h, s, l)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}

function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)].map((value) => Math.round(value * 255))
}

function rotatedRectangle(center, halfWidth, halfDepth, angle) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ].map(([x, z]) => [center.x + x * cos - z * sin, center.z + x * sin + z * cos])
}

function makeRoadPoints(start, end, random, widthScale = 1) {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const length = Math.max(1e-5, Math.hypot(dx, dz))
  const nx = -dz / length
  const nz = dx / length
  const bend = between(random, 2.8, 6.2) * (random() < 0.5 ? -1 : 1) * widthScale
  return [
    [start.x, start.z],
    [start.x + dx * 0.34 + nx * bend, start.z + dz * 0.34 + nz * bend],
    [start.x + dx * 0.66 - nx * bend * 0.72, start.z + dz * 0.66 - nz * bend * 0.72],
    [end.x, end.z],
  ]
}

function generateTerrainPreset(random, seed) {
  const archetype = pick(random, ['mesa', 'ridge', 'basin', 'badlands', 'highlands'])
  const hue = between(random, 0.04, 0.14)
  const warmHigh = colorFromHsl(hue, between(random, 0.62, 0.82), between(random, 0.58, 0.72))
  const lowTint = colorFromHsl(between(random, 0.08, 0.16), between(random, 0.08, 0.18), between(random, 0.82, 0.94))
  const materialTint = colorFromHsl(between(random, 0.07, 0.14), between(random, 0.05, 0.16), between(random, 0.68, 0.82))

  const presets = {
    mesa: {
      scale: between(random, 0.045, 0.075),
      amplitude: between(random, 1.3, 2.4),
      warp: between(random, 1.2, 2.8),
      detail: between(random, 0.08, 0.22),
      contourInterval: between(random, 0.08, 0.14),
    },
    ridge: {
      scale: between(random, 0.065, 0.12),
      amplitude: between(random, 2.1, 3.8),
      warp: between(random, 2.4, 4.8),
      detail: between(random, 0.12, 0.34),
      contourInterval: between(random, 0.1, 0.18),
    },
    basin: {
      scale: between(random, 0.04, 0.07),
      amplitude: between(random, 0.9, 1.8),
      warp: between(random, 0.6, 2.1),
      detail: between(random, 0.04, 0.16),
      contourInterval: between(random, 0.06, 0.12),
    },
    badlands: {
      scale: between(random, 0.095, 0.16),
      amplitude: between(random, 1.8, 3.2),
      warp: between(random, 3.0, 5.8),
      detail: between(random, 0.2, 0.48),
      contourInterval: between(random, 0.07, 0.13),
    },
    highlands: {
      scale: between(random, 0.05, 0.095),
      amplitude: between(random, 2.8, 5.2),
      warp: between(random, 1.8, 4.2),
      detail: between(random, 0.1, 0.28),
      contourInterval: between(random, 0.14, 0.24),
    },
  }
  const base = presets[archetype]

  return {
    archetype,
    source: 'noise',
    seed,
    scale: rounded(base.scale, 0.005),
    octaves: intBetween(random, 4, 7),
    lacunarity: rounded(between(random, 1.9, 2.65), 0.05),
    gain: rounded(between(random, 0.42, 0.63), 0.01),
    amplitude: rounded(base.amplitude, 0.1),
    warp: rounded(base.warp, 0.1),
    detail: rounded(base.detail, 0.01),
    detailScale: rounded(between(random, 1.2, 4.8), 0.1),
    resolution: pick(random, [512, 768]),
    color: materialTint,
    roughness: rounded(between(random, 0.82, 1), 0.01),
    roughnessVariation: rounded(between(random, 0.28, 0.58), 0.01),
    roughnessScale: rounded(between(random, 1.5, 8), 0.5),
    bumpScale: rounded(between(random, 0.08, 0.42), 0.01),
    envMapIntensity: rounded(between(random, 0.45, 1.25), 0.05),
    mapTint: rounded(between(random, 0.82, 1), 0.01),
    heightContrast: rounded(between(random, 3.2, 8.5), 0.1),
    heightPivot: rounded(between(random, 0.42, 0.62), 0.01),
    gradLow: lowTint,
    gradMid1: colorFromHsl(hue, between(random, 0.12, 0.26), between(random, 0.88, 0.98)),
    gradMid2: colorFromHsl(hue, between(random, 0.32, 0.56), between(random, 0.74, 0.86)),
    gradHigh: warmHigh,
    gradMid1Pos: rounded(between(random, 0.22, 0.42), 0.01),
    gradMid2Pos: rounded(between(random, 0.45, 0.68), 0.01),
    slopeTint: rounded(between(random, 0.25, 0.72), 0.01),
    contourInterval: rounded(base.contourInterval, 0.01),
    contourOpacity: rounded(between(random, 0.72, 1), 0.01),
    contourColor: random() < 0.8 ? '#000000' : '#2a241c',
    gridStep: pick(random, [4, 5, 6, 7]),
    gridOpacity: rounded(between(random, 0.35, 0.92), 0.01),
    sunIntensity: rounded(between(random, 5.5, 11.5), 0.1),
    sunAzimuth: intBetween(random, 20, 340),
    sunElevation: intBetween(random, 12, 42),
    envLight: rounded(between(random, 0.12, 0.55), 0.01),
    shadowSoftness: rounded(between(random, 8, 22), 0.5),
  }
}

export function generateSeededLayout(seed, worldSize = 56) {
  const normalizedSeed = Number(seed) >>> 0
  const random = mulberry32(normalizedSeed)
  const terrain = generateTerrainPreset(random, normalizedSeed)
  const margin = 5
  const half = worldSize / 2 - margin
  const nodeCount = 5 + Math.floor(random() * 3)
  const nodes = []

  for (let index = 0; index < nodeCount; index++) {
    const progress = nodeCount === 1 ? 0.5 : index / (nodeCount - 1)
    nodes.push({
      x: -half + progress * half * 2,
      z: between(random, -half * 0.48, half * 0.48),
    })
  }

  const roadScale = terrain.archetype === 'highlands' ? 0.75 : terrain.archetype === 'badlands' ? 1.15 : 1
  const splines = []
  for (let index = 1; index < nodes.length; index++) {
    const start = nodes[index - 1]
    const end = nodes[index]
    splines.push({
      type: 'road',
      points: makeRoadPoints(start, end, random, roadScale),
      width: between(random, 2.4, 3.8),
      falloff: 1.3,
      heightMode: 'flatten',
      heightStrength: 0.95,
      maskLayer: 'road',
      maskValue: 1,
    })
  }

  // Add two short branches so the first result feels like a small PCG network,
  // while keeping the layout compact enough to edit in the terrain viewport.
  for (let index = 1; index < nodes.length - 1; index += 2) {
    const parent = nodes[index]
    const branchEnd = {
      x: Math.max(-half, Math.min(half, parent.x + between(random, -5, 5))),
      z: Math.max(-half, Math.min(half, parent.z + between(random, 7, 12))),
    }
    splines.push({
      type: 'road',
      points: makeRoadPoints(parent, branchEnd, random, 0.65 * roadScale),
      width: between(random, 2, 3.1),
      falloff: 1.1,
      heightMode: 'flatten',
      heightStrength: 0.9,
      maskLayer: 'road',
      maskValue: 1,
    })
  }

  const operators = []
  if (terrain.archetype === 'basin') {
    operators.push({
      type: 'basin',
      center: [0, 0],
      radiusX: between(random, 9, 12),
      radiusZ: between(random, 7, 10),
      height: between(random, -1.9, -1.0),
      blendWidth: between(random, 2.4, 3.8),
      rimHeight: between(random, 0.18, 0.48),
      sharpness: between(random, 1.05, 1.35),
      affectedMasks: ['buildable'],
    })
    operators.push({
      type: 'plateau',
      center: [between(random, -2.5, 2.5), between(random, -1.5, 1.5)],
      radiusX: between(random, 3.5, 5),
      radiusZ: between(random, 2.4, 4),
      height: between(random, -0.25, 0.15),
      blendWidth: between(random, 1.1, 1.8),
      sharpness: 1,
      affectedMasks: ['buildable'],
    })
  } else if (terrain.archetype === 'ridge') {
    operators.push({
      type: 'ridge',
      center: [0, 0],
      radiusX: between(random, 12, 17),
      radiusZ: between(random, 3.2, 5.2),
      rotation: between(random, -0.65, 0.65),
      height: between(random, 2.4, 4.2),
      blendWidth: between(random, 2.4, 4),
      sharpness: between(random, 1.5, 2.2),
      blendMode: 'max',
      affectedMasks: ['blocked'],
    })
    operators.push({
      type: 'mountain',
      center: [between(random, -8, -4), between(random, 5, 9)],
      radiusX: between(random, 4.5, 6.5),
      radiusZ: between(random, 4, 6),
      height: between(random, 1.8, 3.1),
      blendWidth: between(random, 2.4, 3.8),
      sharpness: between(random, 1.7, 2.4),
      blendMode: 'max',
      affectedMasks: ['blocked'],
    })
  } else if (terrain.archetype === 'badlands') {
    operators.push({
      type: 'basin',
      center: [-5, 0],
      radiusX: between(random, 6, 8.5),
      radiusZ: between(random, 4.5, 6.5),
      height: between(random, -1.2, -0.6),
      blendWidth: between(random, 1.9, 3.2),
      rimHeight: between(random, 0.18, 0.36),
      sharpness: between(random, 1.1, 1.4),
      affectedMasks: ['buildable'],
    })
    operators.push({
      type: 'mountain',
      center: [6, -6],
      radiusX: between(random, 5, 7.5),
      radiusZ: between(random, 4.5, 6.5),
      height: between(random, 1.8, 3),
      blendWidth: between(random, 2.8, 4.2),
      sharpness: between(random, 1.5, 2.2),
      affectedMasks: ['blocked'],
    })
  } else {
    operators.push({
      type: 'mountain',
      center: [-9, -6],
      radiusX: between(random, 4.8, 7.2),
      radiusZ: between(random, 4.8, 7.2),
      height: between(random, 2.0, 4.1),
      blendWidth: between(random, 2.4, 4.1),
      sharpness: between(random, 1.6, 2.5),
      affectedMasks: ['blocked'],
    })
    operators.push({
      type: 'mountain',
      center: [9, 7],
      radiusX: between(random, 4.8, 7.2),
      radiusZ: between(random, 4.8, 7.2),
      height: between(random, 2.0, 4.1),
      blendWidth: between(random, 2.4, 4.1),
      sharpness: between(random, 1.6, 2.5),
      affectedMasks: ['blocked'],
    })
  }

  const regions = nodes
    .filter((_, index) => index % 2 === 1 || index === nodes.length - 1)
    .map((node, index) => ({
      type: 'buildable',
      points: rotatedRectangle(
        node,
        between(random, 3.4, 5.4),
        between(random, 2.8, 4.8),
        between(random, -0.35, 0.35)
      ),
      fill: 1,
      edgeFalloff: 0.8,
      heightMode: 'flatten',
      heightStrength: 0.9,
      affectedMasks: ['buildable'],
      generatedIndex: index,
    }))

  return { seed: normalizedSeed, terrain, operators, splines, regions }
}
