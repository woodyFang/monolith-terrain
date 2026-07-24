import test from 'node:test'
import assert from 'node:assert/strict'
import { EditableTerrainData } from '../src/editor/editableTerrainData.js'
import { buildDerivedFields } from '../src/editor/pcg/derivedFields.js'

test('平地坡度接近零', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 16 })
  data.setBaseSampler(() => 2)
  const fields = buildDerivedFields(data)
  assert.ok(fields.sampleSlope(0, 0) < 1e-5)
})

test('线性坡面坡度稳定', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 32 })
  data.setBaseSampler((x) => x * 0.5)
  const fields = buildDerivedFields(data)
  const expected = Math.atan(0.5)
  assert.ok(Math.abs(fields.sampleSlope(0, 0) - expected) < 0.02)
  assert.ok(Math.abs(fields.sampleSlope(2, 1) - expected) < 0.02)
})

test('道路中心距离接近零，远离道路距离增大', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 32 })
  data.setBaseSampler(() => 0)
  data.addSpline({ type: 'road', points: [[-4, 0], [4, 0]], width: 1, falloff: 0.5 })
  const fields = buildDerivedFields(data)
  assert.ok(fields.sampleRoadDistance(0, 0) < 0.05)
  assert.ok(fields.sampleRoadDistance(0, 3) > 2.9)
})

test('禁建区会压低可建设评分', () => {
  const data = new EditableTerrainData({ worldSize: 10, resolution: 32 })
  data.setBaseSampler(() => 0)
  data.addRegion({
    type: 'buildable',
    points: [[-4, -4], [4, -4], [4, 4], [-4, 4]],
    affectedMasks: ['buildable'],
    heightMode: 'none',
  })
  data.addRegion({
    type: 'blocked',
    points: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    affectedMasks: ['blocked'],
    heightMode: 'none',
  })
  const fields = buildDerivedFields(data)
  assert.ok(fields.sampleBuildableScore(0, 0) < fields.sampleBuildableScore(3, 3))
})
