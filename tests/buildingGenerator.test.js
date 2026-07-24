import test from 'node:test'
import assert from 'node:assert/strict'
import { EditableTerrainData } from '../src/editor/editableTerrainData.js'
import { buildDerivedFields } from '../src/editor/pcg/derivedFields.js'
import { OccupancyLayer } from '../src/editor/pcg/occupancyLayer.js'
import { generateBuildings } from '../src/editor/pcg/buildingGenerator.js'

function setupData({ buildable = true, slope = 0 } = {}) {
  const data = new EditableTerrainData({ worldSize: 24, resolution: 64 })
  data.setBaseSampler((x) => x * slope)
  data.addSpline({ id: '道路一', type: 'road', points: [[-9, 0], [9, 0]], width: 2.4, falloff: 0.8, heightMode: 'none' })
  if (buildable) {
    data.addRegion({
      type: 'buildable',
      points: [[-10, -6], [10, -6], [10, 6], [-10, 6]],
      affectedMasks: ['buildable'],
      heightMode: 'none',
    })
  }
  return data
}

function generate(seed, data, options = {}) {
  const fields = buildDerivedFields(data)
  const occupancy = new OccupancyLayer({ worldSize: data.worldSize, resolution: data.resolution })
  return generateBuildings({ seed, data, fields, occupancy, options: { density: 1, spacing: 3, maxSlope: 0.7, ...options } })
}

test('道路两侧建筑生成保持确定性', () => {
  const data = setupData()
  assert.deepEqual(generate(12, data), generate(12, data))
  assert.notDeepEqual(generate(12, data), generate(13, data))
})

test('没有可建设图层时不生成建筑', () => {
  const data = setupData({ buildable: false })
  assert.equal(generate(12, data).length, 0)
})

test('有道路和可建设区域时会生成建筑', () => {
  const buildings = generate(12, setupData())
  assert.ok(buildings.length > 0)
  assert.ok(buildings.every((building) => Math.abs(building.position[2]) > 2))
})

test('建筑会避开过陡地形', () => {
  const flat = generate(12, setupData({ slope: 0 }), { maxSlope: 0.7 })
  const steep = generate(12, setupData({ slope: 3 }), { maxSlope: 0.5 })
  assert.ok(flat.length > 0)
  assert.equal(steep.length, 0)
})

test('建筑朝向道路中心', () => {
  const buildings = generate(12, setupData())
  const sample = buildings[0]
  const z = sample.position[2]
  const facingZ = -Math.cos(sample.rotationY)
  assert.ok(Math.sign(facingZ) === Math.sign(-z) || Math.abs(facingZ) < 0.01)
})
