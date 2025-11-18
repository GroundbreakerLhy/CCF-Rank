/**
 * CCF 等级查询模块
 */

import ccfData from "../data/ccf-conferences.json";

/**
 * 安全的日志输出函数
 */
function safeLog(...args: any[]) {
  try {
    if (typeof addon !== "undefined" && addon?.data?.ztoolkit?.log) {
      addon.data.ztoolkit.log(...args);
    }
  } catch (e) {
    // 忽略日志错误
  }
}

interface CCFEntry {
  abbr: string;
  fullName: string;
  rank: "A" | "B" | "C";
  category: string;
}

class CCFRankService {
  private conferences: CCFEntry[];
  private journals: CCFEntry[];
  private abbrsMap: Map<string, CCFEntry>;
  private fullNamesMap: Map<string, CCFEntry>;

  constructor() {
    this.conferences = (ccfData as any).conferences || [];
    this.journals = (ccfData as any).journals || [];
    this.abbrsMap = new Map();
    this.fullNamesMap = new Map();

    // 构建索引 - 会议和期刊一起索引
    const allEntries = [...this.conferences, ...this.journals];
    allEntries.forEach((entry) => {
      this.abbrsMap.set(entry.abbr.toLowerCase(), entry);
      this.fullNamesMap.set(entry.fullName.toLowerCase(), entry);
    });
  }

  /**
   * 查询会议/期刊的 CCF 信息
   *
   * 匹配策略（按优先级）：
   * 1. 精确匹配简称（如 "CVPR"）
   * 2. 精确匹配全称（如 "IEEE Conference on Computer Vision and Pattern Recognition"）
   * 3. 模糊匹配简称（输入包含简称，如 "CVPR 2024" 包含 "CVPR"）
   * 4. 模糊匹配全称（输入包含全称，如长会议名称的部分匹配）
   *
   * @param name 会议或期刊的名称
   * @returns CCF 条目信息或 null（未找到）
   */
  getEntry(name: string): CCFEntry | null {
    if (!name) return null;

    // 预处理：标准化输入文本，移除常见前缀、后缀和干扰信息
    const original = name;
    let normalized = name.trim().toLowerCase();
    normalized = normalized
      // 移除 "Proceedings of the 2024 on ..." 格式的前缀
      .replace(/^proceedings of (the )?\d{4}\s+(on\s+)?/i, "")
      // 移除 "Proceedings of (the) ..." 格式的前缀
      .replace(/^proceedings of (the )?/i, "")
      // 移除 "Proc. of (the) ..." 格式的前缀
      .replace(/^proc\.? of (the )?/i, "")
      // 移除 "ICML '24:" 或 "AAAI'23:" 格式的前缀
      .replace(/^[a-z]+\s*['']\d{2,4}:\s*/i, "")
      // 移除年份前缀，如 "2024 International Conference..."
      .replace(/^\d{4}\s+/, "")
      // 移除年份后缀，如 "Conference on AI 2024"
      .replace(/\s*\d{4}$/, "")
      // 移除括号内容，如 "Conference (ICML)"
      .replace(/\s*\([^)]*\)$/, "")
      .trim();

    safeLog(
      `[CCF Match] Original: "${original}" -> Normalized: "${normalized}"`,
    );

    // 策略 1: 精确匹配简称（大小写不敏感）
    // 适用场景：用户输入 "cvpr" 或 "CVPR"
    let entry = this.abbrsMap.get(normalized);
    if (entry) {
      safeLog(
        `[CCF Match] Found by abbr exact: ${entry.abbr} -> ${entry.rank}`,
      );
      return entry;
    }

    // 策略 2: 精确匹配全称（大小写不敏感）
    // 适用场景：用户输入完整的会议全称
    entry = this.fullNamesMap.get(normalized);
    if (entry) {
      safeLog(
        `[CCF Match] Found by fullName exact: ${entry.abbr} -> ${entry.rank}`,
      );
      return entry;
    }

    // 策略 3: 模糊匹配简称（检查输入是否包含简称）
    // 适用场景：输入 "CVPR 2024" 包含简称 "cvpr"
    // 防护机制：简称长度 >= 4，避免误匹配短简称（如 "AI", "SC"）
    for (const [key, value] of this.abbrsMap.entries()) {
      if (key.length >= 4 && normalized.includes(key)) {
        safeLog(
          `[CCF Match] Found by abbr fuzzy: "${normalized}" contains "${key}" -> ${value.abbr} ${value.rank}`,
        );
        return value;
      }
    }

    // 策略 4: 模糊匹配全称（检查输入是否包含全称）
    // 适用场景：输入的长会议名称包含数据库中的全称
    // 防护机制：全称长度 >= 20，避免误匹配短全称（如 "Computer Science"）
    for (const [key, value] of this.fullNamesMap.entries()) {
      if (key.length >= 20 && normalized.includes(key)) {
        safeLog(
          `[CCF Match] Found by fullName fuzzy: "${normalized}" contains "${key}" -> ${value.abbr} ${value.rank}`,
        );
        return value;
      }
    }

    safeLog(`[CCF Match] No match found for: "${normalized}"`);
    return null;
  }

  /**
   * 查询会议的 CCF 等级（兼容旧接口）
   * @param name 会议或期刊的名称
   * @returns CCF 等级（A/B/C）或 null（未找到）
   */
  getRank(name: string): string | null {
    const entry = this.getEntry(name);
    return entry ? entry.rank : null;
  }

  /**
   * 从 Zotero 条目中查询 CCF 等级
   *
   * 字段提取策略（按文献类型）：
   *
   * 【会议论文 conferencePaper】
   * 优先级：proceedingsTitle > publicationTitle > conferenceName
   * - proceedingsTitle: IEEE/ACM 导入的论文通常只有这个字段有完整会议名
   * - publicationTitle: 部分导入工具会填充这个字段
   * - conferenceName: 备用字段
   *
   * 【期刊论文 journalArticle】
   * - publicationTitle: 期刊名称
   *
   * 【通用备用方案】
   * - 从文章标题（title）中提取括号内的会议简称（如 "Paper Title (CVPR)"）
   *
   * @param item Zotero 文献条目
   * @returns CCF 等级（A/B/C）或 null（未找到）
   */
  getRankFromItem(item: Zotero.Item): string | null {
    const entry = this.getEntryFromItem(item);
    return entry ? entry.rank : null;
  }

  /**
   * 从 Zotero 条目中获取 CCF 分类
   *
   * 获取逻辑与 getRankFromItem() 一致，但返回分类信息而非等级
   * 分类示例："计算机网络"、"人工智能"、"软件工程" 等
   *
   * @param item Zotero 文献条目
   * @returns CCF 分类字符串或 null（未找到）
   */
  getCategoryFromItem(item: Zotero.Item): string | null {
    const entry = this.getEntryFromItem(item);
    return entry ? entry.category : null;
  }

  /**
   * 从 Zotero 条目中获取 CCF 条目信息（内部方法）
   *
   * @param item Zotero 文献条目
   * @returns CCF 条目信息或 null（未找到）
   */
  private getEntryFromItem(item: Zotero.Item): CCFEntry | null {
    if (!item) return null;

    try {
      const itemType = item.itemType;
      safeLog(`[CCF] Processing item type: ${itemType}`);

      // 策略 1: 会议论文 - 按优先级依次尝试三个字段
      if (itemType === "conferencePaper") {
        // 1.1 优先检查 proceedingsTitle（最可靠的字段）
        // 很多 IEEE/ACM 论文导入后只有这个字段包含完整会议名称
        const proceedingsTitle = item.getField("proceedingsTitle") as string;
        safeLog(
          `[CCF] Conference paper proceedingsTitle: "${proceedingsTitle}"`,
        );
        if (proceedingsTitle) {
          const entry = this.getEntry(proceedingsTitle);
          if (entry) return entry;
        }

        // 1.2 尝试 publicationTitle（部分导入工具使用此字段）
        const publicationTitle = item.getField("publicationTitle") as string;
        safeLog(
          `[CCF] Conference paper publicationTitle: "${publicationTitle}"`,
        );
        if (publicationTitle) {
          const entry = this.getEntry(publicationTitle);
          if (entry) return entry;
        }

        // 1.3 尝试 conferenceName（手动输入或特定导入工具使用）
        const conferenceName = item.getField("conferenceName") as string;
        safeLog(`[CCF] Conference paper conferenceName: "${conferenceName}"`);
        if (conferenceName) {
          const entry = this.getEntry(conferenceName);
          if (entry) return entry;
        }
      }

      // 策略 2: 期刊论文 - 从 publicationTitle 获取期刊名
      if (itemType === "journalArticle") {
        const publicationTitle = item.getField("publicationTitle") as string;
        safeLog(
          `[CCF] Journal article publicationTitle: "${publicationTitle}"`,
        );
        if (publicationTitle) {
          const entry = this.getEntry(publicationTitle);
          if (entry) return entry;
        }
      }

      // 策略 3: 通用兜底 - 尝试 publicationTitle（适用于其他文献类型）
      const publicationTitle = item.getField("publicationTitle") as string;
      safeLog(`[CCF] Generic publicationTitle: "${publicationTitle}"`);
      if (publicationTitle) {
        const entry = this.getEntry(publicationTitle);
        if (entry) return entry;
      }

      // 策略 4: 从文章标题中提取会议简称（最后的备用方案）
      // 适用场景：标题格式为 "Paper Title (CVPR)" 或 "Paper Title (AAAI'21)"
      const title = item.getField("title") as string;
      if (title) {
        // 正则匹配：括号内的大写字母+可选的年份标记
        const match = title.match(/\(([A-Z]+['']?\d*)\)/);
        if (match) {
          // 移除年份标记，只保留简称（如 "AAAI'21" -> "AAAI"）
          const entry = this.getEntry(match[1].replace(/[''].*/, ""));
          if (entry) return entry;
        }
      }
    } catch (e) {
      safeLog("Error getting CCF rank:", e);
    }

    return null;
  }
}

// 单例
const ccfService = new CCFRankService();

/**
 * 手动 CCF 等级管理服务
 * 存储用户手动设置的 CCF 等级，优先级高于数据库匹配结果
 */
class ManualCCFRankService {
  private storageKey = "extensions.ccfRank.manualRanks";
  private ignoreKey = "extensions.ccfRank.ignoreItems";
  private cache: Map<number, string> = new Map();
  private ignoreSet: Set<number> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * 从 Zotero 偏好设置加载手动设置的等级和忽略列表
   */
  private loadFromStorage() {
    try {
      // 加载手动设置的等级
      const stored = Zotero.Prefs.get(this.storageKey, true) as string;
      if (stored) {
        const data = JSON.parse(stored);
        this.cache = new Map(
          Object.entries(data).map(([k, v]) => [parseInt(k), v as string]),
        );
        safeLog(
          `[CCF Manual] Loaded ${this.cache.size} manual ranks from storage`,
        );
      }

      // 加载忽略列表
      const ignoredStr = Zotero.Prefs.get(this.ignoreKey, true) as string;
      if (ignoredStr) {
        const ignoredIds = JSON.parse(ignoredStr);
        this.ignoreSet = new Set(ignoredIds);
        safeLog(
          `[CCF Manual] Loaded ${this.ignoreSet.size} ignored items from storage`,
        );
      }
    } catch (e) {
      safeLog("[CCF Manual] Error loading from storage:", e);
    }
  }

  /**
   * 保存到 Zotero 偏好设置
   */
  private saveToStorage() {
    try {
      // 保存手动设置的等级
      const obj: Record<number, string> = {};
      this.cache.forEach((value, key) => {
        obj[key] = value;
      });
      Zotero.Prefs.set(this.storageKey, JSON.stringify(obj), true);

      // 保存忽略列表
      const ignoredIds = Array.from(this.ignoreSet);
      Zotero.Prefs.set(this.ignoreKey, JSON.stringify(ignoredIds), true);

      safeLog(
        `[CCF Manual] Saved ${this.cache.size} manual ranks and ${this.ignoreSet.size} ignored items`,
      );
    } catch (e) {
      safeLog("[CCF Manual] Error saving to storage:", e);
    }
  }

  /**
   * 设置条目的手动 CCF 等级
   * @param itemID 条目 ID
   * @param rank CCF 等级（A/B/C）
   */
  setRank(itemID: number, rank: "A" | "B" | "C") {
    this.cache.set(itemID, rank);
    this.ignoreSet.delete(itemID);
    this.saveToStorage();
    safeLog(`[CCF Manual] Set item ${itemID} to rank ${rank}`);
  }

  /**
   * 获取条目的手动 CCF 等级
   * @param itemID 条目 ID
   * @returns 手动设置的等级，如果没有手动设置则返回 null
   */
  getRank(itemID: number): string | null {
    return this.cache.get(itemID) || null;
  }

  /**
   * 清除条目的手动 CCF 等级
   * @param itemID 条目 ID
   */
  clearRank(itemID: number) {
    this.cache.delete(itemID);
    this.ignoreSet.delete(itemID);
    this.saveToStorage();
    safeLog(`[CCF Manual] Cleared manual rank for item ${itemID}`);
  }

  /**
   * 检查条目是否有手动设置的等级
   * @param itemID 条目 ID
   */
  hasManualRank(itemID: number): boolean {
    return this.cache.has(itemID);
  }

  /**
   * 将条目加入忽略列表（不显示自动匹配的等级）
   * @param itemID 条目 ID
   */
  ignoreItem(itemID: number) {
    this.ignoreSet.add(itemID);
    this.cache.delete(itemID); // 加入忽略时移除手动设置
    this.saveToStorage();
    safeLog(`[CCF Manual] Added item ${itemID} to ignore list`);
  }

  /**
   * 检查条目是否在忽略列表中
   * @param itemID 条目 ID
   */
  isIgnored(itemID: number): boolean {
    return this.ignoreSet.has(itemID);
  }
}

// 手动等级服务单例
const manualRankService = new ManualCCFRankService();

/**
 * CCF 等级列工厂
 */
export class CCFRankFactory {
  /**
   * 注册 CCF 等级列
   */
  static async registerCCFColumn() {
    // 注册 CCF 等级列
    await Zotero.ItemTreeManager.registerColumns({
      pluginID: addon.data.config.addonID,
      dataKey: "ccfRank",
      label: "CCF 等级",
      dataProvider: (item: Zotero.Item, dataKey: string) => {
        // 如果在忽略列表中，不显示任何等级
        if (manualRankService.isIgnored(item.id)) {
          return "";
        }
        // 优先使用手动设置的等级
        const manualRank = manualRankService.getRank(item.id);
        if (manualRank) {
          return manualRank;
        }
        // 否则使用数据库匹配结果
        return ccfService.getRankFromItem(item) || "";
      },
      renderCell(index, data, column, isFirstColumn, doc) {
        const span = doc.createElement("span");
        span.className = `cell ${column.className}`;
        span.style.textAlign = "center";

        if (data) {
          span.innerText = data;
          span.style.fontWeight = "bold";
          span.style.color = "#000000";
        } else {
          span.innerText = "-";
          span.style.color = "#9ca3af";
        }

        return span;
      },
    });

    // 注册 CCF 分类列
    await Zotero.ItemTreeManager.registerColumns({
      pluginID: addon.data.config.addonID,
      dataKey: "ccfCategory",
      label: "CCF 分类",
      dataProvider: (item: Zotero.Item, dataKey: string) => {
        // 如果在忽略列表中，不显示分类
        if (manualRankService.isIgnored(item.id)) {
          return "";
        }
        return ccfService.getCategoryFromItem(item) || "";
      },
      renderCell(index, data, column, isFirstColumn, doc) {
        const span = doc.createElement("span");
        span.className = `cell ${column.className}`;
        span.style.fontSize = "11px";

        if (data) {
          span.innerText = data;
          span.style.color = "#000000";
        } else {
          span.innerText = "-";
          span.style.color = "#9ca3af";
        }

        return span;
      },
    });

    safeLog("CCF Rank columns registered successfully");
  }

  /**
   * 注册右键菜单项，用于手动设置 CCF 等级
   */
  static registerRightClickMenu() {
    // 注册 CCF 等级设置菜单
    ztoolkit.Menu.register("item", {
      tag: "menu",
      label: "设置 CCF 等级",
      children: [
        {
          tag: "menuitem",
          label: "A",
          commandListener: () => this.setManualRank("A"),
        },
        {
          tag: "menuitem",
          label: "B",
          commandListener: () => this.setManualRank("B"),
        },
        {
          tag: "menuitem",
          label: "C",
          commandListener: () => this.setManualRank("C"),
        },
        {
          tag: "menuseparator",
        },
        {
          tag: "menuitem",
          label: "清除手动设置",
          commandListener: () => this.clearManualRank(),
        },
        {
          tag: "menuitem",
          label: "忽略此条目（不显示等级）",
          commandListener: () => this.ignoreItems(),
        },
      ],
    });

    safeLog("CCF Rank right-click menu registered successfully");
  }

  /**
   * 为选中的条目设置手动 CCF 等级
   * @param rank CCF 等级（A/B/C）
   */
  static setManualRank(rank: "A" | "B" | "C") {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) {
      safeLog("[CCF Manual] No items selected");
      return;
    }

    items.forEach((item) => {
      manualRankService.setRank(item.id, rank);
    });

    // 刷新列表显示
    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF Manual] Set rank ${rank} for ${items.length} items`);
  }

  /**
   * 清除选中条目的手动 CCF 等级
   */
  static clearManualRank() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) {
      safeLog("[CCF Manual] No items selected");
      return;
    }

    items.forEach((item) => {
      manualRankService.clearRank(item.id);
    });

    // 刷新列表显示
    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF Manual] Cleared manual rank for ${items.length} items`);
  }

  /**
   * 忽略选中的条目（不显示自动匹配的等级）
   */
  static ignoreItems() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) {
      safeLog("[CCF Manual] No items selected");
      return;
    }

    items.forEach((item) => {
      manualRankService.ignoreItem(item.id);
    });

    // 刷新列表显示
    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF Manual] Ignored ${items.length} items`);
  }
}
