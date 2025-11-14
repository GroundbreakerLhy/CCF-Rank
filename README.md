# CCF-Rank

Zotero 插件，用于显示文献的 CCF (中国计算机学会) 会议和期刊等级。

## 功能特性

- 自动识别文献的 CCF 等级 (A/B/C)
- 显示 CCF 学科分类
- 支持手动设置和修改等级
- 包含完整的 CCF 2022 推荐列表 (362 个会议 + 233 个期刊)

## 安装

### 从源码安装

```bash
git clone https://github.com/GroundbreakerLhy/CCF-Rank.git
cd CCF-Rank
npm install
npm start
```

开发服务器会自动将插件安装到 Zotero 并在代码修改时自动重新加载。

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

### 手动设置等级

点击文献的 CCF 等级 单元格，在弹出菜单中选择等级或清除手动设置。

## 匹配逻辑

### 字段提取顺序

**会议论文**
1. proceedingsTitle
2. publicationTitle
3. conferenceName

**期刊论文**
- publicationTitle

### 匹配策略

1. 精确匹配简称 (如 "CVPR")
2. 精确匹配全称
3. 模糊匹配简称 (长度 >= 4 字符)
4. 模糊匹配全称 (长度 >= 20 字符)

## 数据更新

CCF 推荐列表存储在 `src/data/ccf-conferences.json`。数据来源于 [CCF 官方网站](https://ccf.atom.im/)。

更新数据：
```bash
python scripts/build-ccf-db.py
```

## 开发

### 项目结构

```
CCF-Rank/
├── src/
│   ├── modules/
│   │   └── ccfRank.ts    
│   ├── data/
│   │   └── ccf-conferences.json 
│   └── hooks.ts                 
├── scripts/
│   └── build-ccf-db.py         
└── addon/
    └── locale/              
```

## 许可证

AGPL-3.0

## 作者

Groundbreaker
