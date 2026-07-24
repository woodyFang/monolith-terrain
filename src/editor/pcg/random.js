export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(seed, salt = 0) {
  const text = `${seed}:${salt}`
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 2246822507)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 3266489909)
  hash ^= hash >>> 16
  return hash >>> 0
}

export function createRandom(seed, salt = 0) {
  return mulberry32(hashSeed(seed, salt))
}

export function randomBetween(random, min, max) {
  return min + random() * (max - min)
}

export function randomInt(random, min, max) {
  return Math.floor(randomBetween(random, min, max + 1))
}
