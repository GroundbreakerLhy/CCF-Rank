# CCF-Rank

[![zotero target version](https://img.shields.io/badge/Zotero-7%20%7C%208-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![GitHub stars](https://img.shields.io/github/stars/GroundbreakerLhy/CCF-Rank?style=social)](https://github.com/GroundbreakerLhy/CCF-Rank)
[![GitHub release](https://img.shields.io/github/v/release/GroundbreakerLhy/CCF-Rank?style=flat-square)](https://github.com/GroundbreakerLhy/CCF-Rank/releases)

Zotero 插件，用于自动显示文献的 CCF（中国计算机学会）会议和期刊等级，包含完整的 CCF 2026 推荐列表。

### 功能特性

- 自动识别文献的 CCF 等级（A/B/C）
- 显示 CCF 学科分类
- 支持右键菜单手动设置、清除等级或忽略条目

## 安装

1. 从 [Releases](https://github.com/GroundbreakerLhy/CCF-Rank/releases) 页面下载最新的 `.xpi` 文件
2. 打开 Zotero → 工具 → 附加组件
3. 点击右上角齿轮图标 → Install Add-on From File
4. 选择下载的 `.xpi` 文件

## 使用方法

### 显示 CCF 等级列

1. 在 Zotero 文献列表的表头右键点击
2. 勾选「CCF 等级」和「CCF 分类」
3. 插件会自动识别并显示对应的 CCF 等级

### 手动设置等级

右键选中的文献，在「设置 CCF 等级」菜单中可以：

1. 手动指定 A / B / C 等级
2. 清除手动设置（恢复自动匹配）
3. 忽略此条目（不显示等级）

## 数据更新

CCF 推荐列表存储在 `src/data/ccf-conferences.json`，当前数据根据官方 PDF「中国计算机学会推荐国际学术会议和期刊目录第七版（2026年3月更新）」整理。

官方链接：[中国计算机学会推荐国际学术会议和期刊目录](https://www.ccf.org.cn/Academic_Evaluation/By_category/)

便捷查询：[ccf.atom.im](https://ccf.atom.im/)

## 致谢

本项目的开发参考并借鉴了以下优秀的 Zotero 插件，在此表示感谢：

- [Zotero-Scholar-Rank](https://github.com/SiriusXT/Zotero-Scholar-Rank)
- [zotero-ccf-info](https://github.com/TimeTrapzz/zotero-ccf-info)

## 作者

[Groundbreaker](https://github.com/GroundbreakerLhy)
