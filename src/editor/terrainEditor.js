import * as THREE from 'three'
import { EditableTerrainData, MASK_LAYERS, pointInPolygon } from './editableTerrainData.js'
import { MaskOverlay, MASK_COLORS } from './maskOverlay.js'

const TOOL_LABELS = {
  select: 'SELECT',
  spline: 'ROAD SPLINE',
  area: 'BUILDABLE AREA',
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose()
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose())
    else child.material?.dispose()
  })
}

function clearGroup(group) {
  for (const child of [...group.children]) {
    disposeObject(child)
    group.remove(child)
  }
}

function button(text, className = '') {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = text
  element.className = className
  return element
}

export class TerrainEditor {
  constructor({ scene, camera, renderer, controls, terrain, params }) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.controls = controls
    this.terrain = terrain
    this.params = params
    this.mode = 'explore'
    this.tool = 'select'
    this.activeLayer = 'road'
    this.selectedId = null
    this.draftPoints = []
    this.dragging = null
    this.lastClickAt = 0
    this.previewVisible = false
    this.data = new EditableTerrainData({ worldSize: 56, resolution: 128 })
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.editorGroup = new THREE.Group()
    this.editorGroup.name = 'TerrainEditor'
    this.previewGroup = new THREE.Group()
    this.previewGroup.name = 'PCGPreview'
    this.scene.add(this.editorGroup, this.previewGroup)
    this.handleMeshes = []
    this.overlay = new MaskOverlay({
      scene,
      data: this.data,
      heightSampler: (x, z) => this.terrain.sample?.(x, z) ?? 0,
    })
    this.overlay.setVisible(false)
    this.createUI()
    this.bindEvents()
    this.setBaseSampler(this.terrain.sample)
  }

  createUI() {
    this.root = document.createElement('section')
    this.root.className = 'editor-ui'
    this.root.innerHTML = `
      <div class="editor-toolbar-row editor-modes"></div>
      <div class="editor-toolbar-row editor-tools"></div>
      <div class="editor-toolbar-row editor-options"></div>
      <div class="editor-status">EXPLORE / terrain preview</div>
      <div class="editor-help">Edit mode: click to place points · Enter finish · Esc cancel · Delete remove</div>
    `
    document.body.appendChild(this.root)

    const modes = this.root.querySelector('.editor-modes')
    this.modeButtons = {
      explore: button('EXPLORE'),
      edit: button('EDIT'),
      masks: button('MASKS'),
    }
    Object.entries(this.modeButtons).forEach(([mode, element]) => {
      element.addEventListener('click', () => this.setMode(mode))
      modes.appendChild(element)
    })

    const tools = this.root.querySelector('.editor-tools')
    this.toolButtons = {
      select: button('SELECT'),
      spline: button('ROAD SPLINE'),
      area: button('BUILDABLE AREA'),
    }
    Object.entries(this.toolButtons).forEach(([tool, element]) => {
      element.addEventListener('click', () => this.setTool(tool))
      tools.appendChild(element)
    })

    const options = this.root.querySelector('.editor-options')
    this.layerSelect = document.createElement('select')
    this.layerSelect.setAttribute('aria-label', 'Active mask layer')
    for (const layer of MASK_LAYERS) {
      const option = document.createElement('option')
      option.value = layer
      option.textContent = `MASK / ${layer.toUpperCase()}`
      this.layerSelect.appendChild(option)
    }
    this.layerSelect.addEventListener('change', () => this.setLayer(this.layerSelect.value))
    options.appendChild(this.layerSelect)

    this.clearButton = button('CLEAR EDITS')
    this.clearButton.addEventListener('click', () => this.clearEdits())
    options.appendChild(this.clearButton)

    this.previewButton = button('PCG PREVIEW')
    this.previewButton.addEventListener('click', () => this.togglePreview())
    options.appendChild(this.previewButton)

    this.exportButton = button('EXPORT JSON')
    this.exportButton.addEventListener('click', () => this.exportProject())
    options.appendChild(this.exportButton)

    this.refreshUI()
  }

  bindEvents() {
    this.onPointerDown = (event) => this.handlePointerDown(event)
    this.onPointerMove = (event) => this.handlePointerMove(event)
    this.onPointerUp = () => this.handlePointerUp()
    this.onKeyDown = (event) => this.handleKeyDown(event)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('keydown', this.onKeyDown)
  }

  setBaseSampler(sampler) {
    if (!sampler) return
    this.data.setBaseSampler(sampler)
    this.overlay.update()
    this.refreshVisuals()
    this.rebuildPcgPreview()
  }

  setMode(mode) {
    this.cancelDraft()
    this.mode = mode
    const editing = mode === 'edit'
    this.controls.enabled = !editing
    this.editorGroup.visible = mode !== 'explore'
    this.overlay.setVisible(mode === 'edit' || mode === 'masks')
    if (mode === 'masks') this.setTool('select')
    this.refreshUI()
  }

  setTool(tool) {
    this.cancelDraft()
    this.tool = tool
    if (tool === 'spline') this.activeLayer = 'road'
    if (tool === 'area') this.activeLayer = 'buildable'
    this.layerSelect.value = this.activeLayer
    this.refreshUI()
  }

  setLayer(layer) {
    if (!MASK_LAYERS.includes(layer)) return
    this.activeLayer = layer
    this.overlay.setLayer(layer)
    this.refreshUI()
  }

  getTerrainHit(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0]
    return hit?.point || null
  }

  getHandleHit(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.intersectObjects(this.handleMeshes, false)[0] || null
  }

  handlePointerDown(event) {
    if (event.button !== 0 || this.mode !== 'edit') return
    event.preventDefault()
    event.stopPropagation()

    const handle = this.getHandleHit(event)
    if (handle && this.tool === 'select') {
      this.selectedId = handle.object.userData.objectId
      this.dragging = handle.object.userData
      this.refreshUI()
      return
    }

    if (this.tool !== 'spline' && this.tool !== 'area') return
    const point = this.getTerrainHit(event)
    if (!point) return
    const now = performance.now()
    if (now - this.lastClickAt < 320 && this.draftPoints.length >= (this.tool === 'area' ? 3 : 2)) {
      this.finishDraft()
      this.lastClickAt = 0
      return
    }
    this.draftPoints.push([point.x, point.z])
    this.lastClickAt = now
    this.refreshVisuals()
    this.refreshUI()
  }

  handlePointerMove(event) {
    if (!this.dragging || this.mode !== 'edit') return
    const point = this.getTerrainHit(event)
    if (!point) return
    const target = this.findObject(this.dragging.objectId)
    if (!target || !target.points[this.dragging.pointIndex]) return
    target.points[this.dragging.pointIndex][0] = point.x
    target.points[this.dragging.pointIndex][1] = point.z
    this.data.rebuild()
    this.refreshVisuals()
    this.overlay.update()
    this.rebuildPcgPreview()
  }

  handlePointerUp() {
    if (!this.dragging) return
    this.dragging = null
    this.onDataChange()
  }

  handleKeyDown(event) {
    if (event.key === 'Escape') {
      this.cancelDraft()
      return
    }
    if (event.key === 'Enter' && this.draftPoints.length) {
      this.finishDraft()
      return
    }
    if (event.key === 'Delete' && this.selectedId) {
      this.deleteSelected()
      return
    }
    if (event.key === '1') this.setTool('select')
    if (event.key === '2') this.setTool('spline')
    if (event.key === '3') this.setTool('area')
    if (event.key.toLowerCase() === 'm') this.setMode(this.mode === 'masks' ? 'explore' : 'masks')
  }

  finishDraft() {
    const points = this.draftPoints.map((point) => [...point])
    if (this.tool === 'spline' && points.length >= 2) {
      const item = this.data.addSpline({ type: 'road', points, maskLayer: 'road', width: 4, falloff: 1.2 })
      this.selectedId = item.id
    } else if (this.tool === 'area' && points.length >= 3) {
      const item = this.data.addRegion({ type: 'buildable', points, affectedMasks: ['buildable'], edgeFalloff: 0.8 })
      this.selectedId = item.id
    }
    this.draftPoints = []
    this.tool = 'select'
    this.onDataChange()
    this.refreshUI()
  }

  cancelDraft() {
    if (!this.draftPoints.length) return
    this.draftPoints = []
    this.refreshVisuals()
    this.refreshUI()
  }

  findObject(id) {
    return this.data.regions.find((item) => item.id === id) || this.data.splines.find((item) => item.id === id)
  }

  deleteSelected() {
    if (!this.selectedId) return
    this.data.removeObject(this.selectedId)
    this.selectedId = null
    this.onDataChange()
  }

  clearEdits() {
    this.cancelDraft()
    this.selectedId = null
    this.data.clearEdits()
    this.onDataChange()
    this.setStatus('EDIT LAYERS CLEARED')
  }

  refreshVisuals() {
    clearGroup(this.editorGroup)
    this.handleMeshes = []
    const addObjectVisual = (item, closed, color) => {
      const points = item.points.map(([x, z]) => new THREE.Vector3(x, this.data.sampleHeight(x, z) + 0.2, z))
      if (closed) points.push(points[0].clone())
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: item.id === this.selectedId ? 1 : 0.8 })
      )
      this.editorGroup.add(line)
      for (let i = 0; i < item.points.length; i++) {
        const [x, z] = item.points[i]
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 10, 6),
          new THREE.MeshBasicMaterial({ color: item.id === this.selectedId ? '#ffffff' : color })
        )
        handle.position.set(x, this.data.sampleHeight(x, z) + 0.35, z)
        handle.userData = { objectId: item.id, pointIndex: i }
        this.editorGroup.add(handle)
        this.handleMeshes.push(handle)
      }
    }

    this.data.splines.forEach((item) => addObjectVisual(item, false, MASK_COLORS.road))
    this.data.regions.forEach((item) => addObjectVisual(item, true, MASK_COLORS.buildable))

    if (this.draftPoints.length) {
      const draft = this.draftPoints.map(([x, z]) => new THREE.Vector3(x, this.data.sampleHeight(x, z) + 0.3, z))
      this.editorGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(draft),
          new THREE.LineBasicMaterial({ color: this.tool === 'area' ? MASK_COLORS.buildable : MASK_COLORS.road })
        )
      )
      draft.forEach((point) => {
        const handle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
        handle.position.copy(point)
        this.editorGroup.add(handle)
      })
    }
  }

  rebuildPcgPreview() {
    clearGroup(this.previewGroup)
    if (!this.previewVisible) return

    const roadMaterial = new THREE.MeshStandardMaterial({ color: '#d87928', roughness: 0.9 })
    for (const spline of this.data.splines.filter((item) => item.type === 'road')) {
      for (let i = 1; i < spline.points.length; i++) {
        const [ax, az] = spline.points[i - 1]
        const [bx, bz] = spline.points[i]
        const dx = bx - ax
        const dz = bz - az
        const length = Math.hypot(dx, dz)
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, spline.width), roadMaterial)
        mesh.position.set((ax + bx) / 2, this.data.sampleHeight((ax + bx) / 2, (az + bz) / 2) + 0.18, (az + bz) / 2)
        mesh.rotation.y = -Math.atan2(dz, dx)
        this.previewGroup.add(mesh)
      }
    }

    const buildingMaterial = new THREE.MeshStandardMaterial({ color: '#6e7681', roughness: 0.85 })
    let buildingCount = 0
    for (const region of this.data.regions.filter((item) => item.type === 'buildable')) {
      const xs = region.points.map((point) => point[0])
      const zs = region.points.map((point) => point[1])
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minZ = Math.min(...zs)
      const maxZ = Math.max(...zs)
      for (let x = minX + 1.2; x < maxX && buildingCount < 120; x += 3.2) {
        for (let z = minZ + 1.2; z < maxZ && buildingCount < 120; z += 3.2) {
          if (!pointInPolygon(x, z, region.points) || this.data.sampleMask('buildable', x, z) < 0.5) continue
          const h = 0.9 + ((buildingCount * 17) % 11) * 0.12
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 1.5), buildingMaterial)
          mesh.position.set(x, this.data.sampleHeight(x, z) + h / 2 + 0.08, z)
          mesh.rotation.y = ((buildingCount * 13) % 30) * (Math.PI / 180)
          this.previewGroup.add(mesh)
          buildingCount++
        }
      }
    }
  }

  togglePreview() {
    this.previewVisible = !this.previewVisible
    this.previewGroup.visible = this.previewVisible
    this.rebuildPcgPreview()
    this.refreshUI()
    this.setStatus(this.previewVisible ? 'PCG PREVIEW ON' : 'PCG PREVIEW OFF')
  }

  onDataChange() {
    this.data.rebuild()
    this.overlay.update()
    this.refreshVisuals()
    this.rebuildPcgPreview()
    this.setStatus(`${this.data.splines.length} SPLINE / ${this.data.regions.length} AREA`)
  }

  getProject() {
    return {
      ...this.data.toJSON(),
      params: {
        source: this.params.source,
        seed: this.params.seed,
        demLocation: this.params.demLocation,
        demLat: this.params.demLat,
        demLon: this.params.demLon,
        demZoom: this.params.demZoom,
        demExaggeration: this.params.demExaggeration,
      },
    }
  }

  async exportProject() {
    const json = JSON.stringify(this.getProject(), null, 2)
    try {
      await navigator.clipboard.writeText(json)
      this.setStatus('PROJECT JSON COPIED')
    } catch {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'monolith-terrain-project.json'
      link.click()
      URL.revokeObjectURL(url)
      this.setStatus('PROJECT JSON DOWNLOADED')
    }
  }

  setStatus(message) {
    if (this.root) this.root.querySelector('.editor-status').textContent = `EDITOR / ${message}`
  }

  refreshUI() {
    if (!this.root) return
    Object.entries(this.modeButtons).forEach(([mode, element]) => element.classList.toggle('active', this.mode === mode))
    Object.entries(this.toolButtons).forEach(([tool, element]) => {
      element.classList.toggle('active', this.tool === tool)
      element.disabled = this.mode !== 'edit'
    })
    this.layerSelect.value = this.activeLayer
    this.root.querySelector('.editor-tools').style.display = this.mode === 'edit' ? 'flex' : 'none'
    this.root.querySelector('.editor-options').style.display = this.mode === 'explore' ? 'none' : 'flex'
    this.root.querySelector('.editor-help').style.display = this.mode === 'edit' ? 'block' : 'none'
    this.renderer.domElement.style.cursor = this.mode === 'edit' ? (this.tool === 'select' ? 'default' : 'crosshair') : 'grab'
    if (this.mode === 'explore') this.setStatus('EXPLORE / TERRAIN PREVIEW')
    else if (this.mode === 'masks') this.setStatus(`MASKS / ${this.activeLayer.toUpperCase()}`)
    else if (this.draftPoints.length) this.setStatus(`${TOOL_LABELS[this.tool]} / ${this.draftPoints.length} POINTS`)
    else this.setStatus(`EDIT / ${TOOL_LABELS[this.tool]} / READY`)
  }

  dispose() {
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    clearGroup(this.editorGroup)
    clearGroup(this.previewGroup)
    this.overlay.dispose()
    this.root.remove()
  }
}
