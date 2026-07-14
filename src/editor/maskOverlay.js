import * as THREE from 'three'
import { MASK_LAYERS } from './editableTerrainData.js'

const COLORS = {
  road: '#ff9f1c',
  buildable: '#26c6da',
  water: '#3182ce',
  vegetation: '#3ca55c',
  blocked: '#ef476f',
  spawnDensity: '#a855f7',
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export class MaskOverlay {
  constructor({ scene, data, heightSampler, size = 56, segments = 128 }) {
    this.data = data
    this.heightSampler = heightSampler
    this.size = size
    this.segments = segments
    this.layer = 'road'
    this.visible = false

    this.canvas = document.createElement('canvas')
    this.canvas.width = this.canvas.height = data.resolution + 1
    this.context = this.canvas.getContext('2d')
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
    geometry.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      })
    )
    this.mesh.renderOrder = 4
    this.mesh.visible = false
    scene.add(this.mesh)
    this.updateHeight()
    this.updateTexture()
  }

  setLayer(layer) {
    if (!MASK_LAYERS.includes(layer)) return
    this.layer = layer
    this.updateTexture()
  }

  setVisible(visible) {
    this.visible = visible
    this.mesh.visible = visible
  }

  updateHeight() {
    const position = this.mesh.geometry.attributes.position
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      position.setY(i, this.heightSampler(x, z) + 0.11)
    }
    position.needsUpdate = true
    this.mesh.geometry.computeBoundingSphere()
  }

  updateTexture() {
    const width = this.canvas.width
    const height = this.canvas.height
    const image = this.context.createImageData(width, height)
    const [r, g, b] = hexToRgb(COLORS[this.layer] || COLORS.road)
    const mask = this.data.masks[this.layer]
    for (let iz = 0; iz < height; iz++) {
      for (let ix = 0; ix < width; ix++) {
        const value = mask[this.data.index(ix, height - 1 - iz)]
        const index = (iz * width + ix) * 4
        image.data[index] = r
        image.data[index + 1] = g
        image.data[index + 2] = b
        image.data[index + 3] = Math.round(value * 215)
      }
    }
    this.context.putImageData(image, 0, 0)
    this.texture.needsUpdate = true
  }

  update() {
    this.updateHeight()
    this.updateTexture()
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.texture.dispose()
  }
}

export { COLORS as MASK_COLORS }
