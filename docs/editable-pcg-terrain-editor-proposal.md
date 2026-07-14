# 可编辑 PCG 地形编辑器方案

## 1. 文档目的

本文档把 MONOLITH 当前的 Three.js 地形展示项目，规划为一个面向 PCG 的可编辑地形工作台。

首版目标不是立即完成城市生成器或完整自然侵蚀系统，而是先建立稳定的数据闭环：

```text
生成 / 加载地形
  -> 区域与样条编辑
  -> Height Edit 与 Mask 图层
  -> Three.js 场景实时预览
  -> 导出给城市或野外 PCG 使用
```

参考体验方向：[Bruno Simon](https://bruno-simon.com/) 的沉浸式 3D 世界、地图、重置、质量设置和多输入交互。首版参考其探索感和空间反馈，不直接复制车辆物理系统。

## 2. 产品定位

### 2.1 一句话定位

一个面向 Three.js PCG 的地形作者工具：用户可以在地形上直接绘制道路、河流、地块、植被区和禁建区，并将这些编辑结果作为高度数据、Mask 图层和场景对象交给后续生成器。

### 2.2 首版优先工作流

首版优先服务“城市 / 道路 / 地块”工作流，同时保留野外生成需要的通用 Mask。

原因：道路、河流、可建设区、禁建区都天然适合区域和样条表达，能够最快验证编辑器对 PCG 的价值；森林、草地、山脊和野外路径可以复用同一套数据结构。

### 2.3 服务对象

城市 PCG：

- 道路网络和道路等级
- 可建设地块
- 广场、平台和公共空间
- 河道、湖泊、岸线
- 公园和绿化带
- 禁建区、保护区和陡坡区

野外 PCG：

- 山脊、峡谷和河谷
- 徒步路径和公路
- 森林、草地、岩地
- 营地、资源点和 POI
- 水域、湿地和不可达区域

## 3. 当前项目基础

当前项目已经具备可复用的渲染和地形基础：

- `Terrain` 管理地形网格和材质。
- `sample(x, z)` 可以查询任意世界坐标的高度。
- 支持真实 DEM 和程序化噪声两种地形来源。
- 支持等高线、测绘网格、渐变着色、坡度着色和扫描波。
- 支持 POI 标记、点击聚焦、返回原镜头和 Tour。
- `lil-gui` 已经负责组织复杂参数。
- `onBeforeCompile` 已经用于地形 Shader 的视觉叠加。

主要基础文件：

- [src/terrain.js](../src/terrain.js)：地形网格、材质、采样和重建。
- [src/noise.js](../src/noise.js)：程序化地形噪声。
- [src/dem.js](../src/dem.js)：真实地形瓦片加载。
- [src/main.js](../src/main.js)：场景初始化、交互和参数面板。
- [src/hud2d.js](../src/hud2d.js)：屏幕 HUD 和 POI 交互。

不重写现有渲染器，而是在基础地形采样和 `Terrain.rebuild()` 之间增加可编辑数据层。

## 4. 总体交互模型

顶部工具栏分为四个工作模式：

```text
[Explore] [Edit] [Masks] [Export]
```

### 4.1 Explore 模式

用于查看和验证最终效果：

| 操作 | 交互 | 结果 |
|---|---|---|
| 旋转 | 鼠标左键拖动 | Orbit 环绕查看 |
| 缩放 | 滚轮 | 拉近或拉远 |
| 平移 | 鼠标右键拖动 | 移动观察范围 |
| 点击 POI | 点击标记 | 镜头飞近并显示信息 |
| 返回 | 点击面板关闭 | 恢复原镜头 |
| Tour | 选择起点和终点 | 进行空间导览 |
| Scan | 点击 Scan | 触发扫描波和地形反馈 |

Explore 模式下不允许误触修改地形。

### 4.2 Edit 模式

Edit 模式负责创建和修改编辑对象。建议进入编辑模式时默认切换为略带俯视的相机角度，但仍保留 3D 透视预览。

工具：

- `Select`：选择、移动、修改已有对象。
- `Spline`：创建道路、河流、山脊和边界线。
- `Area`：创建矩形、圆形或多边形区域。
- `Erase`：删除样条、区域或清除指定 Mask。
- `Measure`：测量距离、坡度和高度差。

### 4.3 Masks 模式

Masks 模式负责查看和管理语义图层：

- 切换当前编辑图层。
- 显示或隐藏单个图层。
- 调整颜色、不透明度和强度。
- 调整混合方式。
- 锁定图层，避免误修改。
- 清空、重建或导出图层。

### 4.4 Export 模式

Export 模式提供：

- 保存项目文件。
- 加载项目文件。
- 导出 Three.js 场景。
- 导出 Mask 纹理。
- 复制场景 JSON。
- 复制可复现的分享链接。

## 5. 区域工具设计

### 5.1 创建流程

```text
点击 Add Area
  -> 点击多个顶点
  -> 双击或按 Enter 完成区域
  -> 拖动顶点编辑形状
  -> 拖动边中点插入新顶点
  -> Delete 删除区域
```

### 5.2 区域类型

- `Buildable`：可建设区域。
- `Water`：湖泊、湿地或水库。
- `Vegetation`：森林、草地或公园。
- `Blocked`：禁建、保护或危险区域。
- `Platform`：广场、机场、营地和其他平整区域。

### 5.3 区域属性

```js
{
  id: 'area-001',
  type: 'buildable',
  points: [[x, z], [x, z], [x, z]],
  fill: 1,
  edgeFalloff: 0.8,
  heightMode: 'flatten',
  heightTarget: null,
  heightStrength: 1,
  affectedMasks: ['buildable']
}
```

`heightMode` 建议支持：

- `none`：只修改 Mask，不改变地形。
- `flatten`：区域内平整到目标高度。
- `smooth`：平滑区域内部或边缘。
- `terrace`：生成台阶式地形。
- `raise`：抬升区域。
- `lower`：降低区域。

## 6. 样条工具设计

### 6.1 创建流程

```text
点击 Add Spline
  -> 点击设置控制点
  -> 拖动控制点调整路径
  -> 调整切线手柄改变曲率
  -> 双击或按 Enter 完成
```

### 6.2 样条类型

- `Road`：道路或公路。
- `River`：河流、排水沟或水渠。
- `Trail`：徒步路径。
- `Ridge`：山脊线。
- `Cliff`：悬崖边界。
- `Boundary`：城市、地块或生成区域边界。

### 6.3 样条属性

```js
{
  id: 'spline-001',
  type: 'road',
  points: [[x, z], [x, z], [x, z]],
  width: 4,
  falloff: 1.2,
  heightMode: 'flatten',
  heightStrength: 0.8,
  maskLayer: 'road',
  maskValue: 1
}
```

### 6.4 样条行为

道路：

```text
中心线 road = 1
向两侧按 falloff 衰减
道路主体 flatten
路肩 smooth
周边可附加 buildable
```

河流：

```text
中心线 water = 1
河床 carve
边缘 smooth
两侧可附加 vegetation
```

样条本身应被保存为语义对象，而不是只烘焙为不可编辑的像素结果。

## 7. Mask 图层设计

### 7.1 首版图层

| 图层 | 含义 | 城市 PCG | 野外 PCG |
|---|---|---|---|
| `height` | 高度数据 | 楼层、地块高差 | 山体、峡谷、坡面 |
| `slope` | 坡度数据 | 排除陡坡建筑 | 悬崖、岩地、登山难度 |
| `road` | 道路或路径 | 道路网络、街区骨架 | 山路、徒步路径 |
| `buildable` | 可建设区域 | 建筑、广场、设施 | 营地、观景点、资源点 |
| `water` | 水域 | 河道、湖泊、岸线 | 河流、湿地、湖泊 |
| `vegetation` | 植被倾向 | 公园、绿化带 | 森林、草地、灌木 |
| `blocked` | 禁止生成区域 | 保护区、危险区 | 不可达区、悬崖 |
| `spawnDensity` | 生成密度 | 建筑和设施密度 | 树、石头、资源密度 |

Mask 值为 `0..1` 的浮点数：

```text
0   = 不属于该语义
0.5 = 过渡或部分权重
1   = 完全属于该语义
```

### 7.2 图层操作

每个图层支持：

- `visible`：显示或隐藏。
- `locked`：锁定，避免误编辑。
- `opacity`：预览不透明度。
- `color`：预览颜色。
- `strength`：编辑强度。
- `blend`：`replace`、`add`、`subtract`、`multiply`、`max`、`min`。
- `clear`：清空当前图层。
- `export`：导出为 PNG 或 `DataTexture`。

### 7.3 编辑反馈

建议使用地形上方的半透明 Overlay Mesh 作为首版实现：

- `road`：橙黄色。
- `buildable`：蓝绿色。
- `water`：蓝色。
- `vegetation`：绿色。
- `blocked`：红色。
- `spawnDensity`：紫色热力图。

Overlay Mesh 首版更容易独立控制开关，也不会立即增加现有 Terrain Shader 的复杂度。数据结构稳定后，再考虑把多层 Mask 合并到 Terrain Shader。

## 8. 数据结构

### 8.1 EditableTerrainData

```js
class EditableTerrainData {
  constructor({ size, resolution, worldSize })

  baseHeight: Float32Array
  editDelta: Float32Array
  finalHeight: Float32Array

  masks: {
    road: Float32Array,
    buildable: Float32Array,
    water: Float32Array,
    vegetation: Float32Array,
    blocked: Float32Array,
    spawnDensity: Float32Array
  }

  worldToGrid(x, z)
  gridToWorld(ix, iz)
  sampleHeight(x, z)
  sampleMask(layer, x, z)
  rebuildFinalHeight()
}
```

数据分为三层：

```text
Base Terrain
  DEM / procedural noise

Edit Layer
  height delta / flatten / smooth / carve / raise

Semantic Layers
  road / buildable / water / vegetation / blocked / spawnDensity
```

最终高度：

```text
finalHeight = baseHeight + editDelta
```

真实 DEM 必须保留为 Base，所有编辑进入 Edit Layer，从而支持重置编辑层而不破坏原始地形。

### 8.2 分辨率策略

当前渲染最高支持 `1024 x 1024`。首版编辑数据建议使用 `512 x 512`：

- 足够支持区域和样条编辑。
- 内存和 CPU 成本可控。
- 拖动编辑点时更容易保持实时反馈。
- 渲染网格可以使用 512 或 1024，再从编辑数据双线性采样。

拖动控制点期间只更新 Overlay；松开鼠标或点击 Apply 后再重建地形网格。

## 9. 鼠标和键盘交互

### 9.1 Raycast 流程

```text
屏幕坐标
  -> Raycaster
  -> terrain.mesh
  -> 世界坐标 x / y / z
  -> 编辑控制点或写入 Mask
```

### 9.2 快捷键

| 操作 | 行为 |
|---|---|
| 左键点击 | 添加点或选择对象 |
| 左键拖动 | 移动控制点 |
| 双击 | 完成当前区域或样条 |
| Enter | 应用当前编辑 |
| Escape | 取消当前编辑 |
| Delete | 删除选中对象 |
| Shift | 吸附到网格或追加控制点 |
| Alt | 临时反向操作或减少 Mask |
| Space | 临时恢复镜头导航 |
| R | 重置当前工具 |
| M | 显示/隐藏 Mask 面板 |
| 1 / 2 / 3 | 切换 Select / Spline / Area |

### 9.3 OrbitControls 冲突处理

- Explore 模式：OrbitControls 正常工作。
- Edit 模式：左键优先用于编辑，OrbitControls 暂停。
- 右键或按住 Space：临时进入镜头导航。
- 拖动控制点时：完全禁用镜头旋转。
- 完成或取消编辑后：恢复 OrbitControls。

## 10. Three.js 输出

### 10.1 项目文件

项目文件用于再次编辑，建议扩展名为 `.terrain.json`：

```json
{
  "version": 1,
  "terrain": {
    "source": "procedural",
    "seed": 7,
    "resolution": 512,
    "worldSize": 56
  },
  "regions": [],
  "splines": [],
  "masks": {
    "buildable": "mask-buildable.png",
    "road": "mask-road.png",
    "water": "mask-water.png"
  }
}
```

### 10.2 Three.js 运行时对象

提供统一入口：

```js
const scene = createTerrainScene(project)
```

建议场景结构：

```text
Scene
├── Terrain
│   ├── terrain mesh
│   ├── height data
│   └── material
├── Regions
├── Splines
├── Masks
│   ├── buildable
│   ├── road
│   ├── water
│   └── vegetation
└── userData.pcg
```

`userData.pcg` 保存 PCG 需要的元数据：

```js
scene.userData.pcg = {
  sampleHeight,
  sampleMask,
  masks,
  regions,
  splines,
  worldSize,
  resolution
}
```

城市 PCG 可以读取：

```js
const road = scene.userData.pcg.masks.road
const buildable = scene.userData.pcg.masks.buildable
const blocked = scene.userData.pcg.masks.blocked
const height = scene.userData.pcg.sampleHeight(x, z)
```

野外 PCG 可以读取：

```js
const vegetation = scene.userData.pcg.masks.vegetation
const water = scene.userData.pcg.masks.water
const spawnDensity = scene.userData.pcg.masks.spawnDensity
```

## 11. 推荐代码结构

```text
src/editor/
├── editorState.js
├── commandHistory.js
├── editableTerrainData.js
├── terrainEditor.js
├── splineTool.js
├── areaTool.js
├── maskLayer.js
├── maskComposer.js
├── maskOverlay.js
├── selectionOverlay.js
├── editorMath.js
└── exportScene.js
```

职责：

- `editableTerrainData.js`：高度、Mask、坐标转换和采样。
- `terrainEditor.js`：编辑模式、工具切换、Raycast、选择和控制器协调。
- `splineTool.js`：样条点、曲线、宽度、Falloff 和样条操作。
- `areaTool.js`：矩形、圆形、多边形区域和区域操作。
- `maskComposer.js`：将区域、样条和高度条件写入 Mask。
- `maskOverlay.js`：Mask 可视化。
- `commandHistory.js`：为后续 Undo/Redo 预留命令接口。
- `exportScene.js`：项目文件和 Three.js 场景导出。

## 12. 开发里程碑

### Milestone 1：可编辑地形数据底座

目标：让当前 DEM 和程序化地形都可以进入编辑数据层。

工作内容：

- 实现 `EditableTerrainData`。
- 从现有 `terrain.sample` 烘焙 `baseHeight`。
- 实现 `editDelta` 和 `finalHeight`。
- 让 `Terrain` 支持从 editable sampler 重建。
- 暴露 `sampleHeight` 和 `sampleMask`。

验收：

- DEM 和程序化模式均可初始化编辑数据。
- 不编辑时视觉结果与当前版本一致。
- 可以通过控制台查询任意点高度。
- 可以清空 Edit Layer 并恢复原地形。

### Milestone 2：Spline Mask 工具

目标：能在地形上绘制道路或河流，并实时显示 Mask。

工作内容：

- Terrain Raycast。
- Spline 模式和控制点。
- 曲线 Overlay。
- 宽度和 Falloff。
- 写入 `road` 或 `water` Mask。
- Mask Overlay 显示。

验收：

- 可以绘制、选择、移动和删除样条。
- 修改宽度时 Mask 实时更新。
- 可以清除样条对 Mask 的影响。
- 样条数据仍保持可编辑，不只保留烘焙结果。

### Milestone 3：Spline 地形变形

目标：道路和河流除了写入 Mask，还能改变高度。

工作内容：

- 道路 Flatten。
- 道路边缘 Smooth。
- 河流 Carve。
- 统一的 `heightMode` 和 `heightStrength`。

验收：

- 道路区域可以平整。
- 河流区域可以下切。
- 边缘没有明显断层。
- 重置编辑层后恢复 Base Terrain。

### Milestone 4：Area Mask 工具

目标：支持地块、植被区、水域和禁建区。

工作内容：

- 多边形区域。
- 顶点拖动和边中点插入。
- `buildable`、`vegetation`、`water`、`blocked` Mask。
- 区域 Overlay。
- Flatten、Smooth、Terrace。

验收：

- 可以围出可建设区域。
- 可以创建森林、水域和禁建区。
- 可以切换不同 Mask 的预览。
- 区域属性可保存和再次加载。

### Milestone 5：PCG Preview 和 Export

目标：验证 Mask 可以被后续生成器直接消费。

工作内容：

- 根据 `road` 生成简单道路 Mesh。
- 根据 `buildable` 生成简单建筑块。
- 根据 `vegetation` 生成树或点云。
- 根据 `water` 生成水面。
- 导出 `.terrain.json`。
- 导出 `createTerrainScene(project)` 所需的数据。

验收：

- 修改 Mask 后 PCG 预览实时变化。
- 城市和野外预览可以切换。
- 导出的项目可以重新加载。
- PCG 模块可以通过统一接口读取高度和 Mask。

## 13. 首个垂直切片

为了避免一次实现过大，第一轮只做以下闭环：

```text
程序化地形
  -> Buildable Mask
  -> 多边形区域
  -> Road Spline
  -> 3D Mask 预览
  -> 简单道路和建筑块预览
  -> Three.js 场景导出
```

首个垂直切片必须支持：

1. 进入 Edit 模式。
2. 绘制和编辑一个 `buildable` 区域。
3. 绘制和编辑一条 `road` 样条。
4. 调整道路宽度和区域 Falloff。
5. 实时查看 Mask 颜色覆盖。
6. 根据 Mask 生成简单道路和建筑块。
7. 导出并重新加载同一场景。

## 14. 性能和风险控制

### 14.1 地形重建成本

`1024 x 1024` 地形频繁重建可能造成卡顿。建议：

- 编辑数据默认使用 512 分辨率。
- 拖动控制点时只刷新 Overlay。
- 松开鼠标后再重建 Terrain Mesh。
- 对连续拖动使用节流或 `requestAnimationFrame`。
- 后续再考虑局部 Mesh 更新。

### 14.2 OrbitControls 冲突

编辑时左键用于点选和拖动，镜头导航改用右键或 Space 临时启用。所有工具都必须有明确的完成、取消和删除状态。

### 14.3 DEM 保护

真实 DEM 作为 Base Terrain 保存。任何道路、区域和河流操作都进入 Edit Layer，不能直接覆盖原始 DEM。

### 14.4 Mask 与高度解耦

Mask 不一定都要改变地形：

- `vegetation` 通常只影响植被生成。
- `buildable` 可以只表示语义，也可以选择 Flatten。
- `road` 可以只标记道路，也可以同时 Flatten。
- `water` 可以只标记水域，也可以 Carve。

因此每个编辑对象都需要独立的 `heightMode`。

## 15. 首版暂不做

- 完整城市生成器。
- 复杂节点图编辑器。
- 高级侵蚀模拟。
- 多人协作。
- 大世界分块流式编辑。
- 生产级 GIS 坐标系统。
- 复杂驾驶物理。
- 仅用于美术的自由笔刷雕刻。

首版的核心验证标准是：用户能否快速塑造一块适合 PCG 的地形，并将高度、区域、样条和 Mask 可靠地交给 Three.js 生成系统。

## 16. 下一步执行

建议立即开始实现：

```text
Milestone 1 + Milestone 2
```

即先完成：

1. `EditableTerrainData`。
2. Spline Road 工具。
3. `road` Mask Overlay。
4. 一个最小的 `buildable` Area 工具。
5. 简单道路和建筑块预览。

完成这一步后，项目就会从“地形展示 Demo”变成“可以在地形上绘制 PCG 约束的编辑器”。
