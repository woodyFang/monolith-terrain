import * as THREE from 'three'
import { EditableTerrainData, MASK_LAYERS, pointInPolygon } from './editableTerrainData.js'
import { MaskOverlay, MASK_COLORS } from './maskOverlay.js'

const TOOL_LABELS = {
  select: '选择',
  spline: '道路样条',
  area: '可建设区域',
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
      <div class="editor-header">
        <div>
          <div class="editor-kicker"><span class="editor-dot"></span>PCG TERRAIN EDITOR</div>
          <div class="editor-title">可编辑地形</div>
          <div class="editor-subtitle">城市 / 野外生成工作台</div>
        </div>
        <div class="editor-live"><span></span>实时</div>
      </div>
      <div class="editor-section">
        <div class="editor-section-title"><b>01</b><span>工作模式</span></div>
        <div class="editor-toolbar-row editor-modes"></div>
      </div>
      <div class="editor-section editor-tools-section">
        <div class="editor-section-title"><b>02</b><span>编辑工具</span><em>数字键 1 / 2 / 3</em></div>
        <div class="editor-toolbar-row editor-tools"></div>
      </div>
      <div class="editor-section">
        <div class="editor-section-title"><b>03</b><span>Mask 图层</span><em>M 切换</em></div>
        <div class="editor-toolbar-row editor-options"></div>
      </div>
      <div class="editor-status"><span class="editor-status-mark"></span><span class="editor-status-text">编辑器 / 浏览 / 地形预览</span></div>
      <div class="editor-help"><b>操作提示</b><span>点击放置点</span><span>Enter 完成</span><span>Esc 取消</span><span>Delete 删除</span></div>
    `
    document.body.appendChild(this.root)

    const modes = this.root.querySelector('.editor-modes')
    this.modeButtons = {
      explore: button('浏览'),
      edit: button('编辑'),
      masks: button('图层'),
    }
    Object.entries(this.modeButtons).forEach(([mode, element]) => {
      element.addEventListener('click', () => this.setMode(mode))
      modes.appendChild(element)
    })

    const tools = this.root.querySelector('.editor-tools')
    this.toolButtons = {
      select: button('选择'),
      spline: button('道路样条'),
      area: button('可建设区域'),
    }
    Object.entries(this.toolButtons).forEach(([tool, element]) => {
      element.addEventListener('click', () => this.setTool(tool))
      tools.appendChild(element)
    })

    const options = this.root.querySelector('.editor-options')
    this.layerSelect = document.createElement('select')
    this.layerSelect.setAttribute('aria-label', '当前 Mask 图层')
    for (const layer of MASK_LAYERS) {
      const option = document.createElement('option')
      option.value = layer
      option.textContent = `图层 / ${this.layerName(layer)}`
      this.layerSelect.appendChild(option)
    }
    this.layerSelect.addEventListener('change', () => this.setLayer(this.layerSelect.value))
    options.appendChild(this.layerSelect)

    this.clearButton = button('清空编辑')
    this.clearButton.addEventListener('click', () => this.clearEdits())
    options.appendChild(this.clearButton)

    this.previewButton = button('PCG 预览')
    this.previewButton.addEventListener('click', () => this.togglePreview())
    options.appendChild(this.previewButton)

    this.exportButton = button('导出 JSON')
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
    this.syncTerrainSurface()
    this.overlay.update()
    this.refreshVisuals()
    this.rebuildPcgPreview()
  }

  syncTerrainSurface() {
    this.terrain.applyHeightField?.((x, z) => this.data.sampleHeight(x, z))
  }

  layerName(layer) {
    return {
      road: '道路',
      buildable: '可建设',
      water: '水域',
      vegetation: '植被',
      blocked: '禁建',
      spawnDensity: '生成密度',
    }[layer] || layer
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
    this.syncTerrainSurface()
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
    this.setStatus('编辑图层已清空')
  }

  refreshVisuals() {
    clearGroup(this.editorGroup)
    this.handleMeshes = []
    const addObjectVisual = (item, closed, color) => {
      const selected = item.id === this.selectedId
      const routeColor = selected ? '#e8973f' : item.type === 'road' ? '#59d68f' : color
      const points = item.points.map(([x, z]) => new THREE.Vector3(x, this.data.sampleHeight(x, z) + 0.28, z))

      if (item.type === 'road' && item.points.length >= 2) {
        const bandMaterial = new THREE.MeshBasicMaterial({
          color: routeColor,
          transparent: true,
          opacity: selected ? 0.34 : 0.2,
          depthTest: false,
          depthWrite: false,
        })
        for (let i = 1; i < item.points.length; i++) {
          const [ax, az] = item.points[i - 1]
          const [bx, bz] = item.points[i]
          const dx = bx - ax
          const dz = bz - az
          const length = Math.max(0.01, Math.hypot(dx, dz))
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, item.width || 4), bandMaterial)
          mesh.position.set(
            (ax + bx) / 2,
            this.data.sampleHeight((ax + bx) / 2, (az + bz) / 2) + 0.2,
            (az + bz) / 2
          )
          mesh.rotation.y = -Math.atan2(dz, dx)
          mesh.renderOrder = 7
          this.editorGroup.add(mesh)
        }
      } else if (closed && item.points.length >= 3) {
        const shape = new THREE.Shape()
        item.points.forEach(([x, z], index) => {
          if (index === 0) shape.moveTo(x, -z)
          else shape.lineTo(x, -z)
        })
        shape.closePath()
        const fill = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: selected ? 0.22 : 0.12,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        )
        const averageHeight = item.points.reduce((sum, [x, z]) => sum + this.data.sampleHeight(x, z), 0) / item.points.length
        fill.rotation.x = -Math.PI / 2
        fill.position.y = averageHeight + 0.12
        fill.renderOrder = 5
        this.editorGroup.add(fill)
      }

      if (closed) points.push(points[0].clone())
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: routeColor, transparent: true, opacity: selected ? 1 : 0.88, depthTest: false })
      )
      line.renderOrder = 8
      this.editorGroup.add(line)

      if (item.type === 'road' && item.points.length >= 2) {
        const endpointMaterial = new THREE.MeshBasicMaterial({ color: routeColor, transparent: true, opacity: 0.9, depthTest: false })
        for (const [x, z] of [item.points[0], item.points[item.points.length - 1]]) {
          const endpoint = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.28, (item.width || 4) * 0.12), 12, 8), endpointMaterial)
          endpoint.position.set(x, this.data.sampleHeight(x, z) + 0.3, z)
          endpoint.renderOrder = 9
          this.editorGroup.add(endpoint)
        }
      }
      for (let i = 0; i < item.points.length; i++) {
        const [x, z] = item.points[i]
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(selected ? 0.3 : 0.23, 12, 8),
          new THREE.MeshBasicMaterial({ color: selected ? '#ffd36a' : '#f1f5f6', depthTest: false })
        )
        handle.position.set(x, this.data.sampleHeight(x, z) + 0.35, z)
        handle.renderOrder = 10
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
    this.setStatus(this.previewVisible ? 'PCG 预览已开启' : 'PCG 预览已关闭')
  }

  onDataChange() {
    this.data.rebuild()
    this.syncTerrainSurface()
    this.overlay.update()
    this.refreshVisuals()
    this.rebuildPcgPreview()
    this.setStatus(`${this.data.splines.length} 条样条 / ${this.data.regions.length} 个区域`)
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
      this.setStatus('项目 JSON 已复制')
    } catch {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'monolith-terrain-project.json'
      link.click()
      URL.revokeObjectURL(url)
      this.setStatus('项目 JSON 已下载')
    }
  }

  setStatus(message) {
    if (this.root) this.root.querySelector('.editor-status-text').textContent = `编辑器 / ${message}`
  }

  refreshUI() {
    if (!this.root) return
    Object.entries(this.modeButtons).forEach(([mode, element]) => element.classList.toggle('active', this.mode === mode))
    Object.entries(this.toolButtons).forEach(([tool, element]) => {
      element.classList.toggle('active', this.tool === tool)
      element.disabled = this.mode !== 'edit'
    })
    this.layerSelect.value = this.activeLayer
    this.root.querySelector('.editor-tools').style.display = 'flex'
    this.root.querySelector('.editor-options').style.display = 'flex'
    this.root.querySelector('.editor-help').style.display = this.mode === 'edit' ? 'flex' : 'none'
    this.renderer.domElement.style.cursor = this.mode === 'edit' ? (this.tool === 'select' ? 'default' : 'crosshair') : 'grab'
    if (this.mode === 'explore') this.setStatus('浏览 / 地形预览')
    else if (this.mode === 'masks') this.setStatus(`图层 / ${this.layerName(this.activeLayer)}`)
    else if (this.draftPoints.length) this.setStatus(`${TOOL_LABELS[this.tool]} / ${this.draftPoints.length} 个点`)
    else this.setStatus(`编辑 / ${TOOL_LABELS[this.tool]} / 就绪`)
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
