# CCF-Rank

Zotero 插件，用于显示文献的 CCF (中国计算机学会) 会议和期刊等级。

## 功能特性

- 自动识别文献的 CCF 等级 (A/B/C)
- 显示 CCF 学科分类
- 支持手动设置和修改等级
- 包含完整的 CCF 2026 推荐列表

## 安装

### 从发布版安装

1. 从 Releases 页面下载 .xpi 文件
2. 打开 Zotero -> 工具 -> 附加组件
3. 点击右上角齿轮图标 -> Install Add-on From File
4. 选择下载的 .xpi 文件

## 使用方法

### 显示 CCF 等级列

1. 在 Zotero 文献列表的表头右键点击
2. 勾选 "CCF 等级" 和 "CCF 分类"
3. 插件会自动识别并显示对应的 CCF 等级

## 匹配逻辑

### 字段提取顺序

**会议论文**

1. proceedingsTitle
2. publicationTitle
3. conferenceName

**期刊论文**

- publicationTitle
  > **注意：** 由于某些期刊喜欢取顶刊相似名字打擦边球，极易出现误判，因此设计了手动忽略功能。如果用户发现误判，可以将该文献加入忽略列表，插件将不再显示其 CCF 分类。而且都发期刊了谁还看 CCF 啊👉👈

## 数据更新

CCF 推荐列表存储在 `src/data/ccf-conferences.json`。当前数据根据官方 PDF `中国计算机学会推荐国际学术会议和期刊目录第七版（2026年3月更新）.pdf` 整理为 JSON 后直接随仓库维护。

官方链接：[中国计算机学会推荐国际学术会议和期刊目录](https://www.ccf.org.cn/Academic_Evaluation/By_category/)。推荐便捷查询[网站](https://ccf.atom.im/)。

## 开发

### 项目结构

```
CCF-Rank/
├── src/
│   ├── modules/
│   │   └── ccfRank.ts
│   ├── data/
│   │   └── ccf-conferences.json
│   │   └── 中国计算机学会推荐国际学术会议和期刊目录第七版（2026年3月更新）.pdf
│   └── hooks.ts
└── addon/
    └── locale/
```

## 许可证

AGPL-3.0

## 作者

Groundbreaker
