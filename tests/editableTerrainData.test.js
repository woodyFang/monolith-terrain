import test from 'node:test'
import assert from 'node:assert/strict'
import { EditableTerrainData } from '../src/editor/editableTerrainData.js'

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

test('serializes editable objects without losing their geometry', () => {
  const data = new EditableTerrainData({ worldSize: 20, resolution: 8 })
  data.setBaseSampler(() => 1)
  data.addSpline({ points: [[-3, -2], [3, 2]] })
  const project = data.toJSON()
  assert.equal(project.version, 1)
  assert.deepEqual(project.splines[0].points, [[-3, -2], [3, 2]])
  assert.equal(project.terrain.resolution, 8)
})
