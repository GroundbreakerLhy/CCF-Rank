# CCF-Rank

[![zotero target version](https://img.shields.io/badge/Zotero-7%20%7C%208%20%7C%209%20%7C%2010-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![GitHub stars](https://img.shields.io/github/stars/GroundbreakerLhy/CCF-Rank?style=social)](https://github.com/GroundbreakerLhy/CCF-Rank)
[![GitHub release](https://img.shields.io/github/v/release/GroundbreakerLhy/CCF-Rank?style=flat-square)](https://github.com/GroundbreakerLhy/CCF-Rank/releases)

Zotero 插件，用于自动显示文献的 CCF（中国计算机学会）会议和期刊等级，包含完整的 CCF 2026 推荐列表。

### 功能特性

- 自动识别文献的 CCF 等级（A/B/C）、学科分类与官方简称
- 文献列表中一键勾选显示「CCF 等级」「CCF 分类」「CCF 简称」三列
- 自动匹配结果不准确时，可通过右键菜单手动指定 CCF 简称（会议 / 期刊 → 学科分类 → 等级分组），等级与分类自动带出
- 支持「恢复自动匹配」与「忽略条目」
- 匹配结果有误时，可通过右键菜单「报告匹配问题」一键向作者反馈（自动打开预填充的 GitHub Issue）
- OpenAlex 被引次数查询、缓存与批量更新

![效果展示](./src/data/效果展示.png)
![手动设置](./src/data/手动设置.png)

## 安装

1. 从 [Releases](https://github.com/GroundbreakerLhy/CCF-Rank/releases) 页面下载最新的 `.xpi` 文件
2. 打开 Zotero → 工具 → 插件
3. 点击右上角齿轮图标 → Install Plugin From File
4. 选择下载的 `.xpi` 文件

## 使用方法

### 显示 CCF 信息列

1. 在 Zotero 文献列表的表头右键点击
2. 勾选「CCF 等级」「CCF 分类」「CCF 简称」列
3. 插件会自动识别文献所属会议 / 期刊并显示对应信息

### 手动指定简称

自动匹配结果不准确时，右键选中的文献 →「CCF 选项」→「设置 CCF 简称」：

1. 选择类型：会议 / 期刊
2. 选择学科分类
3. 在按 A / B / C 等级分组列表中勾选对应简称，等级与分类自动带出

### 其他操作

- **恢复自动匹配**：清除手动指定的简称，重新自动识别
- **忽略条目**：勾选后该条目不显示任何 CCF 信息

## 被引次数

表头勾选「被引次数」及所需的来源、更新时间、状态列，右键文献 →「被引次数」→「更新所选条目的被引次数」。

自动更新默认关闭，缓存默认有效 7 天，可在设置 → CCF Rank 中调整并填写 OpenAlex API Key。查询会向 OpenAlex 发送 DOI 或标题；缓存和密钥仅保存在本机，不修改文献字段。未找到不记为 0，更新失败保留旧值。

匹配有歧义时使用「确认 OpenAlex 论文…」，确认后继续自动更新。无对应记录时可到 Google Scholar 核对，最后再手动填写次数；手动值不会被自动刷新覆盖。

## 数据更新

CCF 推荐列表存储在 `src/data/ccf-conferences.json`，当前数据根据官方 PDF「第七版中国计算机学会推荐国际学术会议和期刊目录（正式版）（2026年4月更新）」整理。

### 数据状态

- 当前版本：2026-04
- 更新时间：2026-09-16
- 会议（conferences）：385 条
- 期刊（journals）：295 条
- 勘误：CASA 已更名为 CASAXR（International Conference on Computer Animation, Social Agents, and Extended Reality），旧称 CASA 及旧全称通过 `aliases` 字段保留兼容

官方链接：[中国计算机学会推荐国际学术会议和期刊目录](https://www.ccf.org.cn/Academic_Evaluation/By_category/)

便捷查询：[ccf.atom.im](https://ccf.atom.im/)

## 致谢

本项目的开发参考并借鉴了以下优秀的 Zotero 插件，在此表示感谢：

- [Zotero-Scholar-Rank](https://github.com/SiriusXT/Zotero-Scholar-Rank)
- [zotero-ccf-info](https://github.com/TimeTrapzz/zotero-ccf-info)

## 作者

[Groundbreaker](https://github.com/GroundbreakerLhy)
