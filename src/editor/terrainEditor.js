import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { EditableTerrainData, MASK_LAYERS, sampleSplinePoints, validateTerrainProject } from './editableTerrainData.js'
import { buildDerivedFields } from './pcg/derivedFields.js'
import { generateBuildings } from './pcg/buildingGenerator.js'
import { OccupancyLayer } from './pcg/occupancyLayer.js'
import { MaskOverlay, MASK_COLORS } from './maskOverlay.js'
import { generateSeededLayout } from './seededTerrainGenerator.js'

const TOOL_LABELS = {
  select: '选择',
  spline: '道路样条',
  area: '可建设区域',
  landform: '地貌形状',
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

function thickLine(points, { color, width = 4, opacity = 1, renderOrder = 35 }) {
  const geometry = new LineGeometry()
  geometry.setPositions(points.flatMap((point) => [point.x, point.y, point.z]))
  const material = new LineMaterial({
    color: new THREE.Color(color).getHex(),
    linewidth: width,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
  })
  const line = new Line2(geometry, material)
  line.computeLineDistances()
  line.renderOrder = renderOrder
  return line
}

function outlinedLine(points, color, { selected = false, renderOrder = 35 } = {}) {
  const group = new THREE.Group()
  group.add(
    thickLine(points, {
      color: '#06151b',
      width: selected ? 9 : 7,
      opacity: 0.94,
      renderOrder: renderOrder - 1,
    })
  )
  group.add(
    thickLine(points, {
      color,
      width: selected ? 6 : 4,
      opacity: 1,
      renderOrder,
    })
  )
  return group
}

function selectionMarker(position, { hovered = false } = {}) {
  const group = new THREE.Group()
  group.position.copy(position)
  const material = new THREE.MeshBasicMaterial({
    color: hovered ? '#fff1a8' : '#ff7a1a',
    transparent: true,
    opacity: hovered ? 0.92 : 1,
    depthTest: false,
    depthWrite: false,
  })
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: hovered ? '#ffd45c' : '#ff9f43',
    transparent: true,
    opacity: hovered ? 0.48 : 0.68,
    depthTest: false,
    depthWrite: false,
  })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 12, 48), material)
  ring.rotation.x = Math.PI / 2
  ring.renderOrder = 44
  group.add(ring)
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.045, 10, 48), outerMaterial)
  outerRing.rotation.x = Math.PI / 2
  outerRing.renderOrder = 43
  group.add(outerRing)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10), material)
  stem.position.y = 0.75
  stem.renderOrder = 44
  group.add(stem)
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), material)
  tip.position.y = 1.55
  tip.renderOrder = 44
  group.add(tip)
  return group
}

function addHandleHitProxy(handle, radius, userData, hitTargets) {
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
  )
  proxy.position.copy(handle.position)
  proxy.userData = { ...userData, hitProxy: true }
  hitTargets.push(proxy)
  return proxy
}

function roadRibbonGeometry(points, width, heightSampler, yOffset) {
  const vertices = []
  const indices = []
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i]
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dz = next[1] - prev[1]
    const length = Math.max(1e-5, Math.hypot(dx, dz))
    const nx = -dz / length
    const nz = dx / length
    const y = heightSampler(x, z) + yOffset
    vertices.push(x + nx * width * 0.5, y, z + nz * width * 0.5, x - nx * width * 0.5, y, z - nz * width * 0.5)
    if (i > 0) {
      const a = (i - 1) * 2
      const b = i * 2
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function roadCurvePoints(item, samplesPerSegment = 12) {
  return sampleSplinePoints(item.points, samplesPerSegment)
}

function operatorCurvePoints(operator, heightSampler, segments = 48) {
  const radiusX = Math.max(0.5, operator.radiusX ?? operator.radius ?? 1)
  const radiusZ = Math.max(0.5, operator.radiusZ ?? operator.radius ?? 1)
  const rotation = operator.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const [cx, cz] = operator.center || [0, 0]
  const points = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const lx = Math.cos(t) * radiusX
    const lz = Math.sin(t) * radiusZ
    const x = cx + lx * cos - lz * sin
    const z = cz + lx * sin + lz * cos
    points.push(new THREE.Vector3(x, heightSampler(x, z) + 0.32, z))
  }
  return points
}

export class TerrainEditor {
  constructor({ scene, camera, renderer, controls, terrain, params, onTerrainPreset }) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.controls = controls
    this.terrain = terrain
    this.params = params
    this.onTerrainPreset = onTerrainPreset
    this.mode = 'explore'
    this.tool = 'select'
    this.activeLayer = 'road'
    this.landformType = 'basin'
    this.selectedId = null
    this.hoveredHandleKey = null
    this.draftPoints = []
    this.dragging = null
    this.lastClickAt = 0
    this.previewVisible = false
    this.visualRefreshQueued = false
    this.lastTerrainHitSource = null
    this.data = new EditableTerrainData({ worldSize: 56, resolution: 128 })
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this.terrainHitPoint = new THREE.Vector3()
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
    this.generateFromSeed(this.params.seed)
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
      <div class="editor-seedbar">
        <label for="terrain-seed-input">\u79cd\u5b50</label>
        <input id="terrain-seed-input" type="number" min="0" step="1" value="${this.params.seed ?? 7}" />
        <button class="editor-generate" type="button">\u968f\u673a</button>
      </div>
      <div class="editor-section">
        <div class="editor-section-title"><b>01</b><span>工作模式</span></div>
        <div class="editor-toolbar-row editor-modes"></div>
      </div>
      <div class="editor-section editor-tools-section">
        <div class="editor-section-title"><b>02</b><span>编辑工具</span><em>数字键 1 / 2 / 3 / 4</em></div>
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

    this.seedInput = this.root.querySelector('#terrain-seed-input')
    this.generateButton = this.root.querySelector('.editor-generate')
    this.generateButton.addEventListener('click', () => this.randomizeSeed())
    this.seedInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.generateFromSeed(this.seedInput.value)
    })
    this.root.querySelector('.editor-help').insertAdjacentHTML(
      'beforeend',
      '<span>右键旋转</span><span>中键平移</span><span>滚轮缩放</span>'
    )

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
      landform: button('地貌形状'),
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

    this.importInput = document.createElement('input')
    this.importInput.type = 'file'
    this.importInput.accept = 'application/json,.json'
    this.importInput.hidden = true
    this.importInput.addEventListener('change', () => this.importProjectFile())
    options.appendChild(this.importInput)

    this.importButton = button('载入 JSON')
    this.importButton.addEventListener('click', () => this.importInput.click())
    options.appendChild(this.importButton)

    const landformSection = document.createElement('div')
    landformSection.className = 'editor-section editor-landform-section'
    landformSection.innerHTML = `
      <div class="editor-section-title"><b>04</b><span>地貌参数</span><em>单击放置 / 选中后可拖拽中心</em></div>
    `
    const landformPanel = document.createElement('div')
    landformPanel.className = 'editor-landform-panel'
    landformPanel.innerHTML = `
      <label><span>形状</span><select class="editor-landform-type" aria-label="地貌形状类型">
        <option value="basin">盆地</option>
        <option value="mountain">高山</option>
        <option value="plateau">平台</option>
        <option value="ridge">山脊</option>
      </select></label>
      <label><span>混合</span><select class="editor-landform-blend-mode" aria-label="地貌混合模式">
        <option value="add">叠加</option>
        <option value="min">向下</option>
        <option value="max">向上</option>
        <option value="replace">替换</option>
      </select></label>
      <label><span>高度</span><input class="editor-landform-height" type="number" step="0.1" value="-1.2" /></label>
      <label><span>半径 X</span><input class="editor-landform-radius-x" type="number" min="0.5" step="0.1" value="6" /></label>
      <label><span>半径 Z</span><input class="editor-landform-radius-z" type="number" min="0.5" step="0.1" value="6" /></label>
      <label><span>过渡</span><input class="editor-landform-blend" type="number" min="0" step="0.1" value="2.2" /></label>
      <label><span>尖锐</span><input class="editor-landform-sharpness" type="number" min="0.1" step="0.1" value="1.4" /></label>
    `
    landformSection.appendChild(landformPanel)
    this.root.insertBefore(landformSection, this.root.querySelector('.editor-status'))
    this.landformSection = landformSection
    this.landformPanel = landformPanel
    this.landformTypeSelect = landformPanel.querySelector('.editor-landform-type')
    this.landformBlendModeSelect = landformPanel.querySelector('.editor-landform-blend-mode')
    this.landformHeightInput = landformPanel.querySelector('.editor-landform-height')
    this.landformRadiusXInput = landformPanel.querySelector('.editor-landform-radius-x')
    this.landformRadiusZInput = landformPanel.querySelector('.editor-landform-radius-z')
    this.landformBlendInput = landformPanel.querySelector('.editor-landform-blend')
    this.landformSharpnessInput = landformPanel.querySelector('.editor-landform-sharpness')
    this.landformTypeSelect.addEventListener('change', () => this.handleLandformFormChange(true))
    this.landformBlendModeSelect.addEventListener('change', () => this.handleLandformFormChange())
    this.landformHeightInput.addEventListener('change', () => this.handleLandformFormChange())
    this.landformRadiusXInput.addEventListener('change', () => this.handleLandformFormChange())
    this.landformRadiusZInput.addEventListener('change', () => this.handleLandformFormChange())
    this.landformBlendInput.addEventListener('change', () => this.handleLandformFormChange())
    this.landformSharpnessInput.addEventListener('change', () => this.handleLandformFormChange())

    this.refreshUI()
  }

  bindEvents() {
    this.onPointerDown = (event) => this.handlePointerDown(event)
    this.onPointerMove = (event) => this.handlePointerMove(event)
    this.onPointerUp = () => this.handlePointerUp()
    this.onKeyDown = (event) => this.handleKeyDown(event)
    this.onContextMenu = (event) => event.preventDefault()
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
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

  generateFromSeed(seed = this.params.seed) {
    const parsedSeed = Number.isFinite(Number(seed)) ? Math.max(0, Math.floor(Number(seed))) >>> 0 : 0
    const layout = generateSeededLayout(parsedSeed, this.data.worldSize)
    this.params.seed = parsedSeed
    if (this.seedInput) this.seedInput.value = String(parsedSeed)
    this.cancelDraft()
    this.selectedId = null
    this.data.beginBatch()
    try {
      this.data.operators = []
      this.data.regions = []
      this.data.splines = []
      this.data._nextId = 1
      this.onTerrainPreset?.(layout.terrain)
      this.data.setBaseSampler(this.terrain.sample)
      for (const operator of layout.operators || []) this.data.addOperator(operator)
      for (const spline of layout.splines) this.data.addSpline(spline)
      for (const region of layout.regions) this.data.addRegion(region)
    } finally {
      this.data.endBatch()
    }
    this.syncTerrainSurface()
    this.overlay.update()
    this.setMode('edit')
    this.refreshVisuals()
    this.rebuildPcgPreview()
    this.setStatus(
      `\u79cd\u5b50 ${layout.seed} / ${layout.terrain.archetype} / ${layout.operators?.length || 0} \u4e2a\u5730\u8c8c / ${layout.splines.length} \u6761\u8def\u5f84 / ${layout.regions.length} \u4e2a\u533a\u57df`
    )
  }

  randomizeSeed() {
    const nextSeed = Math.floor(Math.random() * 999999) + 1
    this.generateFromSeed(nextSeed)
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
    this.hoveredHandleKey = null
    this.mode = mode
    const editing = mode === 'edit'
    this.configureCameraControls(editing)
    this.editorGroup.visible = mode !== 'explore'
    this.overlay.setVisible(mode === 'edit' || mode === 'masks')
    if (mode === 'masks') this.setTool('select')
    this.refreshUI()
  }

  configureCameraControls(editing) {
    this.controls.enabled = true
    this.controls.mouseButtons.LEFT = editing ? null : THREE.MOUSE.ROTATE
    this.controls.mouseButtons.RIGHT = editing ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN
    this.controls.mouseButtons.MIDDLE = editing ? THREE.MOUSE.PAN : THREE.MOUSE.DOLLY
  }

  setTool(tool) {
    this.cancelDraft()
    this.hoveredHandleKey = null
    this.tool = tool
    if (tool === 'spline') this.activeLayer = 'road'
    if (tool === 'area' || tool === 'landform') this.activeLayer = 'buildable'
    this.layerSelect.value = this.activeLayer
    this.refreshLandformForm()
    this.refreshUI()
  }

  landformTypeDefaults(type) {
    return {
      basin: { height: -1.2, radiusX: 7.5, radiusZ: 5.8, blendWidth: 2.8, sharpness: 1.15, blendMode: 'min' },
      mountain: { height: 2.4, radiusX: 5.5, radiusZ: 5.5, blendWidth: 3.4, sharpness: 1.9, blendMode: 'max' },
      plateau: { height: 0, radiusX: 5.2, radiusZ: 3.8, blendWidth: 1.4, sharpness: 1, blendMode: 'replace' },
      ridge: { height: 2.8, radiusX: 12, radiusZ: 3.8, blendWidth: 3.2, sharpness: 1.7, blendMode: 'max' },
    }[type] || { height: 0, radiusX: 5, radiusZ: 5, blendWidth: 2, sharpness: 1, blendMode: 'add' }
  }

  handleLandformFormChange(resetDefaults = false) {
    const type = this.landformTypeSelect.value
    this.landformType = type
    if (resetDefaults) {
      const defaults = this.landformTypeDefaults(type)
      this.landformBlendModeSelect.value = defaults.blendMode
      this.landformHeightInput.value = String(defaults.height)
      this.landformRadiusXInput.value = String(defaults.radiusX)
      this.landformRadiusZInput.value = String(defaults.radiusZ)
      this.landformBlendInput.value = String(defaults.blendWidth)
      this.landformSharpnessInput.value = String(defaults.sharpness)
    }
    const selected = this.findObject(this.selectedId)
    if (this.tool === 'select' && selected?.center && selected.id.startsWith('shape-')) {
      selected.type = type
      selected.blendMode = this.landformBlendModeSelect.value
      selected.height = Number(this.landformHeightInput.value)
      selected.radiusX = Math.max(0.5, Number(this.landformRadiusXInput.value))
      selected.radiusZ = Math.max(0.5, Number(this.landformRadiusZInput.value))
      selected.blendWidth = Math.max(0, Number(this.landformBlendInput.value))
      selected.sharpness = Math.max(0.1, Number(this.landformSharpnessInput.value))
      selected.rimHeight = type === 'basin' ? Math.abs(selected.height) * 0.22 : 0
      selected.affectedMasks = type === 'mountain' || type === 'ridge' ? ['blocked'] : ['buildable']
      this.onDataChange()
    }
    this.refreshUI()
  }

  refreshLandformForm() {
    if (!this.landformPanel) return
    const selected = this.findObject(this.selectedId)
    if (selected?.center && selected.id.startsWith('shape-')) {
      this.landformType = selected.type
      this.landformTypeSelect.value = selected.type
      this.landformBlendModeSelect.value = selected.blendMode || this.landformTypeDefaults(selected.type).blendMode
      this.landformHeightInput.value = String(selected.height ?? 0)
      this.landformRadiusXInput.value = String(selected.radiusX ?? 5)
      this.landformRadiusZInput.value = String(selected.radiusZ ?? 5)
      this.landformBlendInput.value = String(selected.blendWidth ?? 2)
      this.landformSharpnessInput.value = String(selected.sharpness ?? 1)
      return
    }
    this.landformTypeSelect.value = this.landformType
    this.landformBlendModeSelect.value = this.landformTypeDefaults(this.landformType).blendMode
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
    this.terrain.mesh.updateMatrixWorld(true)
    const meshHit = this.raycaster.intersectObject(this.terrain.mesh, false)[0]
    if (meshHit) {
      this.lastTerrainHitSource = 'mesh'
      this.terrainHitPoint.copy(meshHit.point)
      return this.terrainHitPoint
    }
    this.groundPlane.constant = -this.terrain.sample(0, 0)
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.terrainHitPoint)) {
      this.lastTerrainHitSource = null
      return null
    }
    this.lastTerrainHitSource = 'fallback-plane'
    this.terrainHitPoint.y = this.data.sampleHeight(this.terrainHitPoint.x, this.terrainHitPoint.z)
    return this.terrainHitPoint
  }

  handleKey(userData) {
    return userData ? `${userData.objectId}:${userData.pointIndex ?? 'center'}` : null
  }

  updateHandleHover(event) {
    if (this.mode !== 'edit' || this.tool !== 'select' || this.dragging) return
    const hit = this.getHandleHit(event)
    const key = this.handleKey(hit?.object.userData)
    if (key !== this.hoveredHandleKey) {
      this.hoveredHandleKey = key
      this.refreshVisuals()
    }
    this.renderer.domElement.style.cursor = key ? 'pointer' : 'default'
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
      this.hoveredHandleKey = this.handleKey(handle.object.userData)
      this.renderer.domElement.style.cursor = 'grabbing'
      this.refreshLandformForm()
      this.refreshUI()
      return
    }

    const point = this.getTerrainHit(event)
    if (!point) return

    if (this.tool === 'landform') {
      const type = this.landformTypeSelect?.value || this.landformType
      const height = Number(this.landformHeightInput.value)
      const item = this.data.addOperator({
        type,
        center: [point.x, point.z],
        radiusX: Math.max(0.5, Number(this.landformRadiusXInput.value)),
        radiusZ: Math.max(0.5, Number(this.landformRadiusZInput.value)),
        blendMode: this.landformBlendModeSelect.value,
        height,
        blendWidth: Math.max(0, Number(this.landformBlendInput.value)),
        sharpness: Math.max(0.1, Number(this.landformSharpnessInput.value)),
        rimHeight: type === 'basin' ? Math.abs(height) * 0.22 : 0,
        affectedMasks: type === 'mountain' || type === 'ridge' ? ['blocked'] : ['buildable'],
      })
      this.selectedId = item.id
      this.tool = 'select'
      this.refreshLandformForm()
      this.onDataChange()
      this.refreshUI()
      return
    }

    if (this.tool !== 'spline' && this.tool !== 'area') return
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
    if (!this.dragging) {
      this.updateHandleHover(event)
      return
    }
    if (this.mode !== 'edit') return
    const point = this.getTerrainHit(event)
    if (!point) return
    const target = this.findObject(this.dragging.objectId)
    if (!target) return
    if (this.dragging.pointIndex !== undefined && target.points?.[this.dragging.pointIndex]) {
      target.points[this.dragging.pointIndex][0] = point.x
      target.points[this.dragging.pointIndex][1] = point.z
    } else if (target.center) {
      target.center[0] = point.x
      target.center[1] = point.z
    }
    this.scheduleInteractiveRefresh()
  }

  rebuildInteractiveGeometry() {
    this.data.rebuild()
    this.syncTerrainSurface()
    this.overlay.updateHeight()
    this.refreshVisuals()
  }

  scheduleInteractiveRefresh() {
    if (this.visualRefreshQueued) return
    this.visualRefreshQueued = true
    requestAnimationFrame(() => {
      this.visualRefreshQueued = false
      if (!this.dragging) return
      this.rebuildInteractiveGeometry()
    })
  }

  handlePointerUp() {
    if (!this.dragging) return
    this.dragging = null
    this.renderer.domElement.style.cursor = this.hoveredHandleKey ? 'pointer' : 'default'
    this.onDataChange()
  }

  handleKeyDown(event) {
    const inputTarget =
      event.target === this.seedInput ||
      event.target?.matches?.('input, select, textarea')
    if (inputTarget) return
    if (event.key === 'Escape') {
      this.cancelDraft()
      return
    }
    if (event.key === 'Enter' && this.draftPoints.length) {
      event.preventDefault()
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
    if (event.key === '4') this.setTool('landform')
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
    return (
      this.data.operators.find((item) => item.id === id) ||
      this.data.regions.find((item) => item.id === id) ||
      this.data.splines.find((item) => item.id === id)
    )
  }

  deleteSelected() {
    if (!this.selectedId) return
    this.data.removeObject(this.selectedId)
    this.selectedId = null
    this.hoveredHandleKey = null
    this.onDataChange()
  }

  clearEdits() {
    this.cancelDraft()
    this.selectedId = null
    this.hoveredHandleKey = null
    this.data.clearEdits()
    this.onDataChange()
    this.setStatus('编辑图层已清空')
  }

  refreshVisuals() {
    clearGroup(this.editorGroup)
    this.handleMeshes = []
    const addObjectVisual = (item, closed, color) => {
      const selected = item.id === this.selectedId
      const routeColor = selected ? '#ff7a1a' : item.type === 'road' ? '#2cf0a1' : color
      if (item.center) {
        const ringPoints = operatorCurvePoints(item, (x, z) => this.data.sampleHeight(x, z))
        ringPoints.push(ringPoints[0].clone())
        this.editorGroup.add(outlinedLine(ringPoints, routeColor, { selected, renderOrder: 35 }))

        const [x, z] = item.center
        const userData = { objectId: item.id }
        const key = this.handleKey(userData)
        const hovered = key === this.hoveredHandleKey
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(selected ? 0.52 : hovered ? 0.44 : 0.34, 16, 10),
          new THREE.MeshBasicMaterial({ color: selected ? '#ff7a1a' : hovered ? '#ffe27a' : '#ffffff', depthTest: false })
        )
        handle.position.set(x, this.data.sampleHeight(x, z) + 0.52, z)
        handle.renderOrder = 46
        handle.userData = userData
        this.editorGroup.add(handle)
        this.handleMeshes.push(handle)
        const proxy = addHandleHitProxy(handle, selected ? 1.05 : 0.88, userData, this.handleMeshes)
        this.editorGroup.add(proxy)
        if (selected || hovered) this.editorGroup.add(selectionMarker(handle.position, { hovered: !selected && hovered }))
        return
      }

      const points =
        item.type === 'road'
          ? roadCurvePoints(item).map(([x, z]) => new THREE.Vector3(x, this.data.sampleHeight(x, z) + 0.28, z))
          : item.points.map(([x, z]) => new THREE.Vector3(x, this.data.sampleHeight(x, z) + 0.28, z))

      if (item.type === 'road' && item.points.length >= 2) {
        const outerBandMaterial = new THREE.MeshBasicMaterial({
          color: '#06151b',
          transparent: true,
          opacity: 0.96,
          depthTest: false,
          depthWrite: false,
        })
        const bandMaterial = new THREE.MeshBasicMaterial({
          color: routeColor,
          transparent: true,
          opacity: selected ? 0.86 : 0.7,
          depthTest: false,
          depthWrite: false,
        })
        const roadPoints = roadCurvePoints(item)
        const outer = new THREE.Mesh(
          roadRibbonGeometry(roadPoints, (item.width || 4) + 0.8, (x, z) => this.data.sampleHeight(x, z), 0.2),
          outerBandMaterial
        )
        outer.renderOrder = 30
        this.editorGroup.add(outer)
        const inner = new THREE.Mesh(
          roadRibbonGeometry(roadPoints, item.width || 4, (x, z) => this.data.sampleHeight(x, z), 0.26),
          bandMaterial
        )
        inner.renderOrder = 31
        this.editorGroup.add(inner)
        this.editorGroup.add(
          thickLine(
            roadPoints.map(([x, z]) => new THREE.Vector3(x, this.data.sampleHeight(x, z) + 0.42, z)),
            { color: '#ffffff', width: selected ? 5 : 3, opacity: selected ? 1 : 0.92, renderOrder: 33 }
          )
        )
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
            opacity: selected ? 0.42 : 0.28,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        )
        const averageHeight = item.points.reduce((sum, [x, z]) => sum + this.data.sampleHeight(x, z), 0) / item.points.length
        fill.rotation.x = -Math.PI / 2
        fill.position.y = averageHeight + 0.12
        fill.renderOrder = 25
        this.editorGroup.add(fill)
      }

      if (closed) points.push(points[0].clone())
      this.editorGroup.add(outlinedLine(points, routeColor, { selected, renderOrder: 35 }))

      if (item.type === 'road' && item.points.length >= 2) {
        const endpointOuterMaterial = new THREE.MeshBasicMaterial({ color: '#06151b', depthTest: false })
        const endpointMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false })
        for (const [x, z] of [item.points[0], item.points[item.points.length - 1]]) {
          const y = this.data.sampleHeight(x, z) + 0.44
          const outer = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.46, (item.width || 4) * 0.16), 16, 10), endpointOuterMaterial)
          outer.position.set(x, y, z)
          outer.renderOrder = 36
          this.editorGroup.add(outer)
          const endpoint = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.28, (item.width || 4) * 0.1), 16, 10), endpointMaterial)
          endpoint.position.set(x, y + 0.04, z)
          endpoint.renderOrder = 37
          this.editorGroup.add(endpoint)
        }
      }
      for (let i = 0; i < item.points.length; i++) {
        const [x, z] = item.points[i]
        const userData = { objectId: item.id, pointIndex: i }
        const key = this.handleKey(userData)
        const hovered = key === this.hoveredHandleKey
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(selected ? 0.62 : hovered ? 0.54 : 0.42, 16, 10),
          new THREE.MeshBasicMaterial({ color: selected ? '#5b2205' : '#06151b', depthTest: false })
        )
        halo.position.set(x, this.data.sampleHeight(x, z) + 0.38, z)
        halo.renderOrder = 43
        this.editorGroup.add(halo)
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(selected ? 0.42 : hovered ? 0.36 : 0.28, 16, 10),
          new THREE.MeshBasicMaterial({ color: selected ? '#ff7a1a' : hovered ? '#ffe27a' : '#ffffff', depthTest: false })
        )
        handle.position.set(x, this.data.sampleHeight(x, z) + 0.46, z)
        handle.renderOrder = 46
        handle.userData = userData
        this.editorGroup.add(handle)
        this.handleMeshes.push(handle)
        const proxy = addHandleHitProxy(handle, selected ? 0.95 : 0.78, userData, this.handleMeshes)
        this.editorGroup.add(proxy)
        if (selected || hovered) this.editorGroup.add(selectionMarker(handle.position, { hovered: !selected && hovered }))
      }
    }

    this.data.operators.forEach((item) =>
      addObjectVisual(item, true, item.type === 'mountain' || item.type === 'ridge' ? MASK_COLORS.blocked : '#ffd166')
    )
    this.data.splines.forEach((item) => addObjectVisual(item, false, MASK_COLORS.road))
    this.data.regions.forEach((item) => addObjectVisual(item, true, MASK_COLORS.buildable))

    if (this.draftPoints.length) {
      const draft = this.draftPoints.map(([x, z]) => new THREE.Vector3(x, this.data.sampleHeight(x, z) + 0.3, z))
      this.editorGroup.add(
        outlinedLine(draft, this.tool === 'area' ? '#ff4fc3' : '#2cf0a1', {
          selected: true,
          renderOrder: 41,
        })
      )
      draft.forEach((point) => {
        const handle = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }))
        handle.position.copy(point)
        handle.renderOrder = 41
        this.editorGroup.add(handle)
      })
    }
  }

  rebuildPcgPreview() {
    clearGroup(this.previewGroup)
    this.generated = { buildings: [] }
    if (!this.previewVisible) return

    const roadMaterial = new THREE.MeshStandardMaterial({ color: '#d87928', roughness: 0.9 })
    for (const spline of this.data.splines.filter((item) => item.type === 'road')) {
      const roadPoints = roadCurvePoints(spline, 10)
      const mesh = new THREE.Mesh(
        roadRibbonGeometry(roadPoints, spline.width, (x, z) => this.data.sampleHeight(x, z), 0.18),
        roadMaterial
      )
      this.previewGroup.add(mesh)
    }

    const fields = buildDerivedFields(this.data)
    const occupancy = new OccupancyLayer({ worldSize: this.data.worldSize, resolution: this.data.resolution })
    const buildings = generateBuildings({
      seed: this.params.seed,
      data: this.data,
      fields,
      occupancy,
      options: { density: 1, spacing: 3.4 },
    })
    this.generated.buildings = buildings

    const materials = {
      小房屋: new THREE.MeshStandardMaterial({ color: '#7f8791', roughness: 0.86 }),
      中型建筑: new THREE.MeshStandardMaterial({ color: '#69717c', roughness: 0.88 }),
      塔楼: new THREE.MeshStandardMaterial({ color: '#535b68', roughness: 0.82 }),
    }
    const roofMaterial = new THREE.MeshStandardMaterial({ color: '#d87928', roughness: 0.75 })

    for (const building of buildings) {
      const [width, height, depth] = building.scale
      const [x, y, z] = building.position
      const group = new THREE.Group()
      group.position.set(x, y, z)
      group.rotation.y = building.rotationY
      group.userData.generatedId = building.id

      const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[building.type] || materials.小房屋)
      body.position.y = height / 2 + 0.08
      group.add(body)

      if (building.type !== '塔楼') {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * 0.62, 0.5, 4), roofMaterial)
        roof.position.y = height + 0.42
        roof.rotation.y = Math.PI / 4
        group.add(roof)
      }

      this.previewGroup.add(group)
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
    this.setStatus(`${this.data.operators.length} 个地貌 / ${this.data.splines.length} 条样条 / ${this.data.regions.length} 个区域`)
  }

  getProject() {
    return {
      ...this.data.toJSON(),
      params: {
        source: this.params.source,
        seed: this.params.seed,
        scale: this.params.scale,
        octaves: this.params.octaves,
        lacunarity: this.params.lacunarity,
        gain: this.params.gain,
        amplitude: this.params.amplitude,
        warp: this.params.warp,
        detail: this.params.detail,
        detailScale: this.params.detailScale,
        demLocation: this.params.demLocation,
        demLat: this.params.demLat,
        demLon: this.params.demLon,
        demZoom: this.params.demZoom,
        demExaggeration: this.params.demExaggeration,
      },
    }
  }

  async importProjectFile() {
    const file = this.importInput.files?.[0]
    if (!file) return
    try {
      const project = JSON.parse(await file.text())
      validateTerrainProject(project)
      this.importProject(project)
      this.setStatus(
        `项目已载入 / ${project.operators?.length || 0} 个地貌 / ${project.splines?.length || 0} 条样条 / ${project.regions?.length || 0} 个区域`
      )
    } catch (error) {
      console.warn('Unable to import terrain project', error)
      this.setStatus(`项目 JSON 无效 / ${error.message}`)
    } finally {
      this.importInput.value = ''
    }
  }

  importProject(project) {
    validateTerrainProject(project)
    const seed = Number.isFinite(Number(project.params?.seed)) ? Number(project.params.seed) >>> 0 : this.params.seed
    this.params.seed = seed
    this.seedInput.value = String(seed)
    this.cancelDraft()
    this.selectedId = null
    this.dragging = null
    this.lastClickAt = 0
    if (project.params?.source === 'noise') {
      this.onTerrainPreset?.({ ...this.params, ...project.params, source: 'noise', seed })
      this.data.beginBatch()
      try {
        this.data.setBaseSampler(this.terrain.sample)
        this.data.loadJSON(project)
      } finally {
        this.data.endBatch()
      }
    } else {
      this.data.loadJSON(project)
    }
    this.syncTerrainSurface()
    this.overlay.update()
    this.refreshVisuals()
    this.rebuildPcgPreview()
    this.setMode('edit')
    this.refreshLandformForm()
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
    const selected = this.findObject(this.selectedId)
    this.landformSection.style.display = this.mode === 'edit' && (this.tool === 'landform' || selected?.center) ? 'block' : 'none'
    this.root.querySelector('.editor-help').style.display = this.mode === 'edit' ? 'flex' : 'none'
    this.renderer.domElement.style.cursor = this.dragging
      ? 'grabbing'
      : this.mode === 'edit'
        ? this.tool === 'select'
          ? this.hoveredHandleKey
            ? 'pointer'
            : 'default'
          : 'crosshair'
        : 'grab'
    if (this.mode === 'explore') this.setStatus('浏览 / 地形预览')
    else if (this.mode === 'masks') this.setStatus(`图层 / ${this.layerName(this.activeLayer)}`)
    else if (this.draftPoints.length) this.setStatus(`${TOOL_LABELS[this.tool]} / ${this.draftPoints.length} 个点`)
    else this.setStatus(`编辑 / ${TOOL_LABELS[this.tool]} / 就绪`)
  }

  dispose() {
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    clearGroup(this.editorGroup)
    clearGroup(this.previewGroup)
    this.overlay.dispose()
    this.root.remove()
  }
}
