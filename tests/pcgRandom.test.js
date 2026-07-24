import test from 'node:test'
import assert from 'node:assert/strict'
import { createRandom, hashSeed, mulberry32 } from '../src/editor/pcg/random.js'

test('同一个种子会产生稳定随机序列', () => {
  const first = mulberry32(1234)
  const second = mulberry32(1234)
  assert.deepEqual(
    Array.from({ length: 8 }, () => first()),
    Array.from({ length: 8 }, () => second())
  )
})

test('同一个种子加同一个用途会产生稳定随机序列', () => {
  const first = createRandom(77, '建筑')
  const second = createRandom(77, '建筑')
  assert.deepEqual(
    Array.from({ length: 8 }, () => first()),
    Array.from({ length: 8 }, () => second())
  )
})

test('不同用途会拆出不同随机流', () => {
  assert.notEqual(hashSeed(77, '建筑'), hashSeed(77, '植被'))
  const buildings = createRandom(77, '建筑')
  const vegetation = createRandom(77, '植被')
  assert.notDeepEqual(
    Array.from({ length: 8 }, () => buildings()),
    Array.from({ length: 8 }, () => vegetation())
  )
})
