import test from 'node:test'
import assert from 'node:assert/strict'
import { EditableTerrainData, sampleSplinePoints, validateTerrainProject } from '../src/editor/editableTerrainData.js'
import { generateSeededLayout } from '../src/editor/seededTerrainGenerator.js'

test('generates a repeatable editable layout from a seed', () => {
  const first = generateSeededLayout(42)
  const second = generateSeededLayout(42)
  const other = generateSeededLayout(43)
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, other)
  assert.ok(first.operators.length >= 2)
  assert.ok(first.splines.length >= 5)
  assert.ok(first.regions.length >= 3)
  assert.equal(first.splines[0].heightMode, 'flatten')
})

test('initializes and samples a base heightfield', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 16 })
  data.setBaseSampler((x, z) => x + z)
  assert.equal(data.sampleHeight(0, 0), 0)
  assert.ok(data.sampleHeight(2, 1) > 2.9 && data.sampleHeight(2, 1) < 3.1)
})

test('writes road and buildable masks from editable objects', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 32 })
  data.setBaseSampler(() => 0)
  data.addSpline({ points: [[-4, 0], [4, 0]], width: 2, falloff: 1 })
  data.addRegion({
    type: 'buildable',
    points: [[-2, -2], [2, -2], [2, 2], [-2, 2]],
    affectedMasks: ['buildable'],
  })
  assert.ok(data.sampleMask('road', 0, 0) > 0.9)
  assert.ok(data.sampleMask('road', 0, 2.2) < 0.2)
  assert.ok(data.sampleMask('buildable', 0, 0) > 0.9)
  assert.equal(data.splines.length, 1)
  assert.equal(data.regions.length, 1)
})

test('road splines sample as continuous curved paths', () => {
  const data = new EditableTerrainData({ worldSize: 20, resolution: 64 })
  data.setBaseSampler(() => 0)
  data.addSpline({ points: [[-6, 0], [-2, 5], [3, -4], [6, 0]], width: 1.6, falloff: 0.8 })
  const sampled = sampleSplinePoints(data.splines[0].points, 8)
  assert.equal(sampled[0][0], -6)
  assert.equal(sampled.at(-1)[0], 6)
  assert.ok(sampled.some(([x, z]) => x > -1 && x < 1 && z > 0.5))
  assert.ok(data.sampleMask('road', -2, 5) > 0.85)
  assert.ok(data.sampleMask('road', 3, -4) > 0.85)
})

test('applies flattening edits to the final heightfield', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 32 })
  data.setBaseSampler((x, z) => x + z)
  data.addSpline({ points: [[-4, 0], [4, 0]], width: 2, falloff: 0.5 })
  data.addRegion({
    type: 'buildable',
    points: [[-2, -2], [2, -2], [2, 2], [-2, 2]],
    affectedMasks: ['buildable'],
  })
  assert.ok(Math.abs(data.sampleHeight(1, 1)) < 0.2)
  assert.ok(Math.abs(data.sampleHeight(0, 1)) < 0.2)
})

test('serializes editable objects without losing their geometry', () => {
  const data = new EditableTerrainData({ worldSize: 20, resolution: 8 })
  data.setBaseSampler(() => 1)
  data.addSpline({ points: [[-3, -2], [3, 2]] })
  const project = data.toJSON()
  assert.equal(project.version, 1)
  assert.deepEqual(project.splines[0].points, [[-3, -2], [3, 2]])
  assert.equal(project.terrain.resolution, 8)
})

test('batches object insertion into one rebuild', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 16 })
  data.setBaseSampler(() => 0)
  let rebuilds = 0
  const rebuild = data.rebuild.bind(data)
  data.rebuild = () => {
    rebuilds += 1
    rebuild()
  }
  data.beginBatch()
  data.addOperator({ type: 'mountain', center: [0, 0], radiusX: 2, radiusZ: 2, height: 2 })
  data.addSpline({ points: [[-2, 0], [2, 0]] })
  data.addRegion({ type: 'buildable', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] })
  assert.equal(rebuilds, 0)
  data.endBatch()
  assert.equal(rebuilds, 1)
})

test('supports an elongated ridge operator and directional falloff', () => {
  const data = new EditableTerrainData({ worldSize: 30, resolution: 60 })
  data.setBaseSampler(() => 0)
  const ridge = data.addOperator({
    type: 'ridge',
    center: [0, 0],
    radiusX: 10,
    radiusZ: 2,
    height: 4,
    blendWidth: 1,
    sharpness: 1.5,
  })
  assert.equal(ridge.blendMode, 'max')
  assert.equal(ridge.affectedMasks[0], 'blocked')
  assert.ok(data.sampleHeight(0, 0) > 3.9)
  assert.ok(data.sampleHeight(6, 0) > data.sampleHeight(0, 3))
})

test('applies min, max and replace operator blend modes', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 32 })
  data.setBaseSampler(() => 2)
  data.addOperator({ type: 'basin', center: [0, 0], radiusX: 3, radiusZ: 3, height: -1, rimHeight: 0, blendMode: 'min' })
  data.addOperator({ type: 'mountain', center: [0, 0], radiusX: 3, radiusZ: 3, height: 3, blendMode: 'max' })
  assert.ok(Math.abs(data.sampleHeight(0, 0) - 5) < 0.05)
  data.addOperator({ type: 'plateau', center: [0, 0], radiusX: 2, radiusZ: 2, height: 1, blendMode: 'replace' })
  assert.ok(Math.abs(data.sampleHeight(0, 0) - 1) < 0.05)
})

test('round-trips operators, regions and splines through JSON', () => {
  const source = new EditableTerrainData({ worldSize: 20, resolution: 16 })
  const baseSampler = (x, z) => x * 0.2 - z * 0.1
  source.setBaseSampler(baseSampler)
  source.addOperator({ type: 'ridge', center: [2, -1], radiusX: 8, radiusZ: 2, rotation: 0.4, height: 3 })
  source.addSpline({ points: [[-3, 0], [3, 0]] })
  source.addRegion({ type: 'buildable', points: [[-2, -2], [2, -2], [2, 2], [-2, 2]] })
  const restored = EditableTerrainData.fromJSON(source.toJSON())
  restored.setBaseSampler(baseSampler)
  assert.deepEqual(restored.toJSON(), source.toJSON())
  assert.ok(Math.abs(restored.sampleHeight(2, -1) - source.sampleHeight(2, -1)) < 1e-6)
  assert.ok(Math.abs(restored.sampleMask('blocked', 2, -1) - source.sampleMask('blocked', 2, -1)) < 1e-6)
})

test('loads old projects with missing optional collections and blend modes', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 16 })
  data.setBaseSampler(() => 0)
  data.loadJSON({
    version: 1,
    operators: [{ type: 'mountain', center: [0, 0], radiusX: 2, radiusZ: 2, height: 2 }],
  })
  assert.equal(data.operators.length, 1)
  assert.equal(data.operators[0].blendMode, 'max')
  assert.deepEqual(data.regions, [])
  assert.deepEqual(data.splines, [])
})

test('rejects malformed or unsupported terrain projects before mutating data', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 8 })
  data.setBaseSampler(() => 0)
  data.addOperator({ type: 'basin', center: [0, 0], radiusX: 2, radiusZ: 2, height: -1 })
  const before = data.toJSON()
  assert.throws(() => validateTerrainProject(null), /expected an object/)
  assert.throws(() => data.loadJSON({ version: 2 }), /Unsupported terrain project version/)
  assert.throws(() => data.loadJSON({ version: 1, operators: {} }), /operators must be an array/)
  assert.deepEqual(data.toJSON(), before)
})
