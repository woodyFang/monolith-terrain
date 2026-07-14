import test from 'node:test'
import assert from 'node:assert/strict'
import { EditableTerrainData } from '../src/editor/editableTerrainData.js'
import { generateSeededLayout } from '../src/editor/seededTerrainGenerator.js'

test('generates a repeatable editable layout from a seed', () => {
  const first = generateSeededLayout(42)
  const second = generateSeededLayout(42)
  const other = generateSeededLayout(43)
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, other)
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
