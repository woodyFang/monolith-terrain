import * as THREE from 'three'

// Screen-space FUI layer: sector data block, telemetry, POI markers with
// leader lines, and a selection panel. Anchored elements are projected from
// world space every frame.

const el = (cls, html = '') => {
  const d = document.createElement('div')
  d.className = cls
  d.innerHTML = html
  return d
}

export function createHud2D({ onSelectPoi, onDeselect }) {
  const root = el('hud')
  document.body.appendChild(root)

  // ---- static frame: corner brackets
  root.appendChild(el('hud-corner tl'))
  root.appendChild(el('hud-corner tr'))
  root.appendChild(el('hud-corner bl'))
  root.appendChild(el('hud-corner br'))

  // ---- top-left sector block
  const sector = el(
    'hud-block hud-tl',
    `<div class="hud-kicker"><span class="sq"></span>区域</div>
     <div class="hud-dim" data-t="sectorId">区域编号：—</div>
     <div class="hud-rule"></div>
     <div class="hud-strong">程序山地</div>
     <div class="hud-dim" data-t="gps">坐标：—</div>
     <div class="hud-dim" data-t="meta">—</div>`
  )
  root.appendChild(sector)

  // ---- bottom-right telemetry block
  const telem = el(
    'hud-block hud-brt',
    `<div class="hud-kicker"><span class="sq"></span>遥测</div>
     <div class="hud-row"><span>镜头方位</span><b data-t="az">—</b></div>
     <div class="hud-row"><span>镜头俯仰</span><b data-t="el">—</b></div>
     <div class="hud-row"><span>对焦</span><b data-t="focus">—</b></div>
     <div class="hud-row"><span>帧率</span><b data-t="fps">—</b></div>
     <div class="hud-row"><span>时间</span><b data-t="clock">—</b></div>`
  )
  root.appendChild(telem)

  // ---- selection panel (anchored below the clicked marker)
  const panel = el(
    'hud-panel',
    `<div class="hud-panel-head"><span class="sq"></span><b data-t="pName">—</b><button class="hud-x" title="关闭并恢复视角">✕</button></div>
     <div class="hud-row"><span>类型</span><b data-t="pKind">—</b></div>
     <div class="hud-row"><span>海拔</span><b data-t="pElev">—</b></div>
     <div class="hud-row"><span>网格</span><b data-t="pGrid">—</b></div>
     <div class="hud-row"><span>状态</span><b class="accent">已锁定</b></div>`
  )
  panel.style.display = 'none'
  root.appendChild(panel)
  panel.querySelector('.hud-x').addEventListener('click', () => onDeselect?.())

  const q = (parent, key) => parent.querySelector(`[data-t="${key}"]`)

  // ---- POI markers
  let poiEls = []
  let selected = -1
  const v = new THREE.Vector3()

  function setPois(pois) {
    poiEls.forEach((p) => p.remove())
    poiEls = pois.map((p, i) => {
      const kind = p.kind === 'PEAK' ? '山峰' : p.kind === 'BASIN' ? '盆地' : p.kind
      const m = el(
        'hud-poi',
        `<span class="tag"><b>${p.id}</b><i>${kind} · ${p.feet.toLocaleString()} 英尺</i></span>`
      )
      m.addEventListener('click', () => onSelectPoi?.(i))
      root.appendChild(m)
      return m
    })
  }

  function project(camera, w, h, world, out) {
    v.copy(world).project(camera)
    out.visible = v.z < 1
    out.x = (v.x * 0.5 + 0.5) * w
    out.y = (-v.y * 0.5 + 0.5) * h
    return out
  }

  const pos = { x: 0, y: 0, visible: true }
  let acc = 0

  return {
    root,
    setPois,
    setStatic(p) {
      const real = p.source === 'real'
      q(sector, 'sectorId').textContent = `区域编号：465-NKJ-${String(p.seed).padStart(4, '0')}K`
      sector.querySelector('.hud-strong').textContent = real ? p.demLocation.toUpperCase() : '程序山地'
      q(sector, 'gps').textContent = real
        ? `坐标：${p.demLat.toFixed(4)}, ${p.demLon.toFixed(4)} · Z${p.demZoom}`
        : '坐标：46.4076, 11.8524 · 网格 56×56'
      q(sector, 'meta').textContent = real
        ? '高程：Terrain Tiles © MAPZEN/TILEZEN'
        : `种子：${String(p.seed).padStart(4, '0')} · 网格：${p.resolution}²`
    },
    setSelected(i, poi) {
      selected = i
      poiEls.forEach((m, j) => m.classList.toggle('active', j === i))
      if (i >= 0 && poi) {
        q(panel, 'pName').textContent = poi.id
      q(panel, 'pKind').textContent = poi.kind === 'PEAK' ? '山峰' : poi.kind === 'BASIN' ? '盆地' : poi.kind
      q(panel, 'pElev').textContent = `${poi.feet.toLocaleString()} 英尺`
        q(panel, 'pGrid').textContent = poi.grid
        panel.style.display = 'block'
      } else {
        panel.style.display = 'none'
      }
    },
    update(dt, camera, w, h, data) {
      // anchored: POI markers
      data.pois.forEach((p, i) => {
        const m = poiEls[i]
        if (!m) return
        project(camera, w, h, p.top, pos)
        m.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`
        m.style.opacity = pos.visible ? 1 : 0
      })

      // anchored: selection panel follows its marker, just below the tag
      if (selected >= 0 && data.pois[selected]) {
        project(camera, w, h, data.pois[selected].top, pos)
        const px = Math.min(Math.max(pos.x + 14, 10), w - 270)
        const py = Math.min(pos.y + 16, h - 190)
        panel.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`
        panel.style.opacity = pos.visible ? 1 : 0
      }

      // throttled text refresh
      acc += dt
      if (acc > 0.15) {
        acc = 0
        q(telem, 'az').textContent = `${data.az.toFixed(1)}°`
        q(telem, 'el').textContent = `${data.el.toFixed(1)}°`
        q(telem, 'focus').textContent = data.focus.toFixed(2)
        q(telem, 'fps').textContent = String(Math.round(data.fps))
        q(telem, 'clock').textContent = data.clock
      }
    },
    setVisible(vis) {
      root.style.display = vis ? 'block' : 'none'
    },
    setOpacity(o) {
      root.style.opacity = o
    },
  }
}
