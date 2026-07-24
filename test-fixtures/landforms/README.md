# 地貌测试地形

这些 JSON 文件可以直接使用编辑器中的“载入 JSON”打开。

| 文件 | 用途 | 重点检查 |
|---|---|---|
| `01-central-production-basin.json` | 中央生产盆地 | 盆地、中央平台、两侧高山、Min/Replace/Max |
| `02-twin-ridge-valley.json` | 双山脊谷地 | 旋转山脊、长条山谷、狭长平台 |
| `03-ringed-mountain-bowl.json` | 环形群山盆地 | 8 个外围山体、中央盆地、群山拼接 |
| `04-highland-plateaus.json` | 高原台地群 | 多级平台、高原边缘、局部盆地 |
| `05-boundary-mountain-walls.json` | 地图边界山墙 | 四边山脊、地图边界封闭、中央建设面 |
| `06-overlap-blend-stress.json` | 重叠混合压力 | Add/Min/Max/Replace 交叉、锐利和宽过渡组合 |

## 建议测试流程

1. 点击“载入 JSON”。
2. 选择一个测试文件。
3. 切换到“编辑”模式。
4. 选择每个地貌并拖动中心。
5. 修改高度、半径、过渡、尖锐度和混合模式。
6. 确认拖动中地形实时更新。
7. 切换 `buildable` 和 `blocked` Mask。
8. 导出 JSON，再重新载入确认一致。

所有测试地形只包含地貌 Operator，不包含道路、建筑、植被或水文内容。
