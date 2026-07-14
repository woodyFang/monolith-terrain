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

export function generateSeededLayout(seed, worldSize = 56) {
  const random = mulberry32(Number(seed) >>> 0)
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

  const splines = []
  for (let index = 1; index < nodes.length; index++) {
    const start = nodes[index - 1]
    const end = nodes[index]
    const midpoint = {
      x: (start.x + end.x) / 2 + between(random, -2.8, 2.8),
      z: (start.z + end.z) / 2 + between(random, -4.5, 4.5),
    }
    splines.push({
      type: 'road',
      points: [[start.x, start.z], [midpoint.x, midpoint.z], [end.x, end.z]],
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
    const midpoint = {
      x: (parent.x + branchEnd.x) / 2 + between(random, -2, 2),
      z: (parent.z + branchEnd.z) / 2 + between(random, -2, 2),
    }
    splines.push({
      type: 'road',
      points: [[parent.x, parent.z], [midpoint.x, midpoint.z], [branchEnd.x, branchEnd.z]],
      width: between(random, 2, 3.1),
      falloff: 1.1,
      heightMode: 'flatten',
      heightStrength: 0.9,
      maskLayer: 'road',
      maskValue: 1,
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

  return { seed: Number(seed) >>> 0, splines, regions }
}
