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

type EntryKind = "conference" | "journal";

interface IndexedEntry {
  entry: CCFEntry;
  kind: EntryKind;
  normalizedFullName: string;
  fullTokens: Set<string>;
  aliases: string[];
}

const GENERIC_TOKENS = new Set([
  "acm",
  "and",
  "annual",
  "architecture",
  "architectural",
  "association",
  "computer",
  "conference",
  "design",
  "for",
  "ieee",
  "in",
  "international",
  "journal",
  "on",
  "of",
  "proceedings",
  "sig",
  "sigact",
  "sigplan",
  "sigsoft",
  "symposium",
  "systems",
  "the",
  "theory",
  "to",
  "transactions",
  "workshop",
]);

const INVALID_ABBRS = new Set([
  "DBLP",
  "INTERNATIONAL",
  "PROCEEDINGS",
  "SYMPOSIUM",
  "CONFERENCE",
  "JOURNAL",
  "TRANSACTIONS",
]);

class CCFRankService {
  private conferences: CCFEntry[];
  private journals: CCFEntry[];
  private exactAbbrMap: Map<string, IndexedEntry[]>;
  private exactFullNameMap: Map<string, IndexedEntry[]>;
  private indexedEntries: IndexedEntry[];

  constructor() {
    this.conferences = (ccfData as any).conferences || [];
    this.journals = (ccfData as any).journals || [];
    this.exactAbbrMap = new Map();
    this.exactFullNameMap = new Map();
    this.indexedEntries = [];

    this.buildIndexes();
  }

  private normalizeText(input: string): string {
    return input
      .toLowerCase()
      .replace(/\b([a-z]+)\s*['’]\d{2,4}\b/g, "$1")
      .replace(/[“”"'’`]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9+/\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private normalizeAbbr(input: string): string {
    return input
      .toUpperCase()
      .replace(/[“”"'’`]/g, "")
      .replace(/[^A-Z0-9+/\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isMeaningfulToken(token: string): boolean {
    if (token.length < 3) return false;
    if (GENERIC_TOKENS.has(token)) return false;
    return true;
  }

  private tokenizeMeaningful(input: string): Set<string> {
    return new Set(
      input
        .split(" ")
        .filter((x) => this.isMeaningfulToken(x.toLowerCase())),
    );
  }

  private isUsableAlias(alias: string): boolean {
    const normalized = this.normalizeAbbr(alias);
    if (!normalized || normalized.length < 2) return false;
    if (INVALID_ABBRS.has(normalized)) return false;

    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length > 0) {
      const allGeneric = tokens.every((token) =>
        GENERIC_TOKENS.has(token.toLowerCase()),
      );
      if (allGeneric) return false;
    }

    return true;
  }

  private extractCandidateAbbrs(input: string): string[] {
    const candidates = new Set<string>();

    // Match bracketed abbreviations: (ICLR), (NeurIPS), (ASPLOS)
    const bracketed = input.matchAll(/\(([A-Za-z][A-Za-z0-9+/-]{1,})\)/g);
    for (const match of bracketed) {
      candidates.add(this.normalizeAbbr(match[1]));
    }

    // Match forms like: ASPLOS '20: ...
    const yearStyle = input.match(/^\s*([A-Za-z][A-Za-z0-9+/-]{1,})\s*['’]\d{2,4}\b/);
    if (yearStyle) {
      candidates.add(this.normalizeAbbr(yearStyle[1]));
    }

    return Array.from(candidates).filter((x) => x.length >= 2);
  }

  private classifyInputHint(normalizedInput: string): EntryKind | null {
    const words = new Set(normalizedInput.split(" "));
    const conferenceHints = ["conference", "symposium", "workshop", "proceedings"];
    const journalHints = ["journal", "transactions", "letters"];

    const hasConferenceHint = conferenceHints.some((x) => words.has(x));
    const hasJournalHint = journalHints.some((x) => words.has(x));

    if (hasConferenceHint && !hasJournalHint) return "conference";
    if (hasJournalHint && !hasConferenceHint) return "journal";
    return null;
  }

  private removeBoilerplate(input: string): string {
    return input
      .replace(/^proceedings of (the )?/i, "")
      .replace(/^proc\.? of (the )?/i, "")
      .replace(/^in:\s*/i, "")
      .replace(/^\d{4}\s+/, "")
      .replace(/\s*\(.*?\)\s*$/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private generateAbbrAliases(abbr: string): string[] {
    const aliases = new Set<string>();
    const base = this.normalizeAbbr(abbr);
    if (!this.isUsableAlias(base)) return [];

    aliases.add(base);
    aliases.add(base.replace(/\s+/g, ""));

    const prefixPattern = /^(INTERNATIONAL|IEEE|ACM|EUROPEAN|THE)\s+/;
    let stripped = base;
    while (prefixPattern.test(stripped)) {
      stripped = stripped.replace(prefixPattern, "").trim();
      if (this.isUsableAlias(stripped)) {
        aliases.add(stripped);
        aliases.add(stripped.replace(/\s+/g, ""));
      }
    }

    return Array.from(aliases).filter((x) => this.isUsableAlias(x));
  }

  private containsAlias(normalizedInput: string, alias: string): boolean {
    const escaped = alias
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return re.test(normalizedInput);
  }

  private scoreEntry(
    inputText: string,
    normalizedInput: string,
    inputTokens: Set<string>,
    indexed: IndexedEntry,
  ): number {
    let score = 0;

    if (normalizedInput === indexed.normalizedFullName) {
      return 1000;
    }

    for (const alias of indexed.aliases) {
      if (!this.isUsableAlias(alias)) continue;
      const lowerAlias = alias.toLowerCase();
      if (this.containsAlias(normalizedInput, alias)) {
        // Prefer direct abbreviation mention.
        score = Math.max(score, 900 + Math.min(50, alias.length));
      }

      if (lowerAlias.length >= 4 && normalizedInput.includes(lowerAlias)) {
        score = Math.max(score, 820 + Math.min(30, alias.length));
      }
    }

    if (normalizedInput.includes(indexed.normalizedFullName)) {
      score = Math.max(score, 780);
    }

    // Token overlap for resilient fuzzy matching on long titles.
    let overlap = 0;
    for (const token of inputTokens) {
      if (indexed.fullTokens.has(token)) {
        overlap += 1;
      }
    }
    if (overlap >= 3) {
      const precision = overlap / Math.max(1, inputTokens.size);
      const recall = overlap / Math.max(1, indexed.fullTokens.size);
      const f1 =
        (2 * precision * recall) / Math.max(0.0001, precision + recall);
      score = Math.max(score, 600 + Math.round(f1 * 200));
    }

    // Small bonus when exact abbreviation appears in raw text with punctuation.
    if (
      this.isUsableAlias(indexed.entry.abbr) &&
      inputText.toUpperCase().includes(indexed.entry.abbr.toUpperCase())
    ) {
      score += 10;
    }

    return score;
  }

  private pickBestCandidate(
    candidates: IndexedEntry[],
    rawInput: string,
    normalizedInput: string,
    inputTokens: Set<string>,
    preferredKind?: EntryKind,
  ): IndexedEntry | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const hintedKind = preferredKind || this.classifyInputHint(normalizedInput);

    let best: IndexedEntry | null = null;
    let bestScore = -1;
    let secondBestScore = -1;

    for (const candidate of candidates) {
      let score = this.scoreEntry(
        rawInput,
        normalizedInput,
        inputTokens,
        candidate,
      );

      if (hintedKind && candidate.kind === hintedKind) {
        score += 160;
      }

      if (
        normalizedInput === candidate.normalizedFullName ||
        normalizedInput.includes(candidate.normalizedFullName)
      ) {
        score += 120;
      }

      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        best = candidate;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    // 歧义保护：如果前两名过于接近且输入过短，宁可不返回避免误判。
    const veryShort = normalizedInput.replace(/\s+/g, "").length <= 8;
    if (veryShort && bestScore - secondBestScore < 80) {
      return null;
    }

    return best;
  }

  private buildIndexes() {
    const allEntries: Array<{ entry: CCFEntry; kind: EntryKind }> = [
      ...this.conferences.map((entry) => ({ entry, kind: "conference" as const })),
      ...this.journals.map((entry) => ({ entry, kind: "journal" as const })),
    ];

    allEntries.forEach(({ entry, kind }) => {
      const normalizedFullName = this.normalizeText(entry.fullName);
      const fullTokens = this.tokenizeMeaningful(normalizedFullName);
      const aliases = this.generateAbbrAliases(entry.abbr);

      const indexed: IndexedEntry = {
        entry,
        kind,
        normalizedFullName,
        fullTokens,
        aliases,
      };

      const fullNameEntries = this.exactFullNameMap.get(normalizedFullName) || [];
      fullNameEntries.push(indexed);
      this.exactFullNameMap.set(normalizedFullName, fullNameEntries);

      aliases.forEach((alias) => {
        const abbrEntries = this.exactAbbrMap.get(alias) || [];
        abbrEntries.push(indexed);
        this.exactAbbrMap.set(alias, abbrEntries);
      });

      this.indexedEntries.push(indexed);
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
  getEntry(name: string, preferredKind?: EntryKind): CCFEntry | null {
    if (!name) return null;

    const original = name.trim();
    const stripped = this.removeBoilerplate(original);
    const normalizedInput = this.normalizeText(stripped);
    const inputAbbr = this.normalizeAbbr(stripped);
    const inputTokens = this.tokenizeMeaningful(normalizedInput);

    // Phase 0: explicit short-name hints in the raw title.
    for (const abbr of this.extractCandidateAbbrs(original)) {
      const byExtractedAbbr = this.exactAbbrMap.get(abbr) || [];
      const picked = this.pickBestCandidate(
        byExtractedAbbr,
        stripped,
        normalizedInput,
        inputTokens,
        preferredKind,
      );
      if (picked) {
        safeLog(
          `[CCF Match] Found by extracted abbr: ${picked.entry.abbr} ${picked.entry.rank}`,
        );
        return picked.entry;
      }
    }

    safeLog(
      `[CCF Match] Original: "${original}" -> Stripped: "${stripped}" -> Normalized: "${normalizedInput}"`,
    );

    // Phase 1: exact abbreviation / alias match.
    let abbrCandidates = this.exactAbbrMap.get(inputAbbr) || [];
    let picked = this.pickBestCandidate(
      abbrCandidates,
      stripped,
      normalizedInput,
      inputTokens,
      preferredKind,
    );
    if (picked) {
      safeLog(
        `[CCF Match] Found by abbr exact/alias: ${picked.entry.abbr} ${picked.entry.rank}`,
      );
      return picked.entry;
    }

    // Handle patterns like "CCS '18: ..." by extracting the leading token.
    const leadingToken = stripped.match(/^([A-Za-z][A-Za-z0-9+/-]{1,})\b/);
    if (leadingToken) {
      const tokenKey = this.normalizeAbbr(leadingToken[1]);
      if (!new Set(["ACM", "IEEE", "INTERNATIONAL", "PROCEEDINGS"]).has(tokenKey)) {
        abbrCandidates = this.exactAbbrMap.get(tokenKey) || [];
        picked = this.pickBestCandidate(
          abbrCandidates,
          stripped,
          normalizedInput,
          inputTokens,
          preferredKind,
        );
        if (picked) {
          safeLog(
            `[CCF Match] Found by leading token: ${picked.entry.abbr} ${picked.entry.rank}`,
          );
          return picked.entry;
        }
      }
    }

    // Phase 2: exact full-name match.
    const fullNameCandidates = this.exactFullNameMap.get(normalizedInput) || [];
    picked = this.pickBestCandidate(
      fullNameCandidates,
      stripped,
      normalizedInput,
      inputTokens,
      preferredKind,
    );
    if (picked) {
      safeLog(
        `[CCF Match] Found by fullName exact: ${picked.entry.abbr} ${picked.entry.rank}`,
      );
      return picked.entry;
    }

    // Phase 3: score-based fuzzy match (abbr containment + token overlap).
    let best: CCFEntry | null = null;
    let bestScore = 0;

    for (const indexed of this.indexedEntries) {
      const score = this.scoreEntry(
        stripped,
        normalizedInput,
        inputTokens,
        indexed,
      );
      const hintedKind = preferredKind || this.classifyInputHint(normalizedInput);
      const adjusted =
        hintedKind && indexed.kind === hintedKind ? score + 120 : score;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = indexed.entry;
      }
    }

    // Confidence threshold keeps false positives low.
    if (best && bestScore >= 760) {
      safeLog(
        `[CCF Match] Found by fuzzy score: ${best.abbr} ${best.rank}, score=${bestScore}`,
      );
      return best;
    }

    safeLog(
      `[CCF Match] No match found for: "${normalizedInput}" (bestScore=${bestScore})`,
    );
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
          const entry = this.getEntry(proceedingsTitle, "conference");
          if (entry) return entry;
        }

        // 1.2 尝试 publicationTitle（部分导入工具使用此字段）
        const publicationTitle = item.getField("publicationTitle") as string;
        safeLog(
          `[CCF] Conference paper publicationTitle: "${publicationTitle}"`,
        );
        if (publicationTitle) {
          const entry = this.getEntry(publicationTitle, "conference");
          if (entry) return entry;
        }

        // 1.3 尝试 conferenceName（手动输入或特定导入工具使用）
        const conferenceName = item.getField("conferenceName") as string;
        safeLog(`[CCF] Conference paper conferenceName: "${conferenceName}"`);
        if (conferenceName) {
          const entry = this.getEntry(conferenceName, "conference");
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
          const entry = this.getEntry(publicationTitle, "journal");
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
