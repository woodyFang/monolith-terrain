import test from 'node:test'
import assert from 'node:assert/strict'
import { OccupancyLayer } from '../src/editor/pcg/occupancyLayer.js'

const square = (x, z, size) => [
  [x - size, z - size],
  [x + size, z - size],
  [x + size, z + size],
  [x - size, z + size],
]

test('占用图层会按组和颜色写入格子', () => {
  const occupancy = new OccupancyLayer({ worldSize: 10, resolution: 20 })
  occupancy.occupyFootprint('buildingBody', square(0, 0, 1), { source: '房屋一', color: '#123456' })
  const sample = occupancy.sample(0, 0)
  assert.ok(sample.groups.includes('buildingBody'))
  assert.equal(sample.source, '房屋一')
  assert.equal(sample.color, '#123456')
})

test('建筑主体会拒绝其他建筑和植被', () => {
  const occupancy = new OccupancyLayer({ worldSize: 10, resolution: 20 })
  occupancy.occupyFootprint('buildingBody', square(0, 0, 1), { source: '房屋一' })
  assert.equal(occupancy.canOccupyFootprint('buildingBody', square(0, 0, 1)), false)
  assert.equal(occupancy.canOccupyFootprint('vegetation', square(0, 0, 0.6)), false)
  assert.equal(occupancy.canOccupyFootprint('buildingBody', square(4, 4, 0.5)), true)
})

test('建筑周边留白允许草和小装饰但拒绝建筑主体', () => {
  const occupancy = new OccupancyLayer({ worldSize: 10, resolution: 20 })
  occupancy.occupyFootprint('buildingBuffer', square(0, 0, 1), { source: '留白' })
  assert.equal(occupancy.canOccupyFootprint('vegetation', square(0, 0, 0.5)), true)
  assert.equal(occupancy.canOccupyFootprint('smallProp', square(0, 0, 0.5)), true)
  assert.equal(occupancy.canOccupyFootprint('buildingBody', square(0, 0, 0.5)), false)
})

test('桥梁可以覆盖道路和水体交叉区域', () => {
  const occupancy = new OccupancyLayer({ worldSize: 10, resolution: 20 })
  occupancy.occupyFootprint('road', square(0, 0, 1), { source: '道路' })
  occupancy.occupyFootprint('water', square(0, 0, 1), { source: '水体' })
  assert.equal(occupancy.canOccupyFootprint('bridge', square(0, 0, 0.5)), true)
})
