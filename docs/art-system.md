# Xmission 主题美术系统

任务数据只保存形态与分类的语义值；显示时由主题映射到各自的图案。这让换肤不改动已有任务，也避免把 JRPG 的剑、卷轴和宝箱带进农场或小岛。

| 主题 | 分类与道具素材 | 形态标签 | 字体 |
| --- | --- | --- | --- |
| 暮色 JRPG | `src/assets/icons/` 原有像素道具与分类素材 | 金色双线像素牌 | Fusion Pixel |
| 羊皮纸手账 | `src/assets/icon-atlases/journal-items.png` | `src/assets/badges/journal-ribbon.png` 蓝墨丝带 | Journal Serif 标题、雅黑正文 |
| 动森小岛 | `src/assets/icon-atlases/island-items.png` | `src/assets/badges/island-tag.png` 叶片缝线牌 | Island Round |
| 星露谷农场 | `src/assets/icon-atlases/farm-items.png` | `src/assets/badges/farm-ribbon.png` 木条布旗 | Ark Pixel CN / Latin |

三个图集与三个无字标签由内置图像生成工具制作，均为真正透明底。生成提示以 `docs/ui-concepts/v3-parchment-journal.png`、`v4-animal-crossing.png`、`v5-stardew.png` 作为风格参考；图集各含 4×4 个独立物件，标签保留无字中心以便中文由界面实时排版。提示重点分别是“古籍雕版墨线、旧铜与蓝墨”“圆润奶油色手工小岛道具”“暖色 16 位像素农场物件”；共同约束是无文字、无水印、透明底、图案彼此分离。图集与标签保留原始输出，`ThemeIcon.tsx` 和 `FormBadge.tsx` 通过可调整的裁切坐标显示各组件，不依赖系统缓存外的文件。

新增字体的开放许可分别保存在 `public/fonts/LICENSES/ark-pixel/`、`zcool-kuaile/` 和 `zcool-xiaowei/`。修改主题图案时先更新图集映射，再检查任务页、图案选择器与 520×700 悬浮窗；形态文字必须保持 HTML 文本，不烘焙进图片。
