/**
 * CCF 等级查询模块
 */

import ccfData from "../data/ccf-conferences.json";

/**
 * 安全的日志输出函数
 */
function safeLog(...args: any[]) {
  if (typeof addon !== "undefined" && addon?.data?.ztoolkit?.log) {
    addon.data.ztoolkit.log(...args);
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
  "NETWORKING",
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
      input.split(" ").filter((x) => this.isMeaningfulToken(x.toLowerCase())),
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
    const yearStyle = input.match(
      /^\s*([A-Za-z][A-Za-z0-9+/-]{1,})\s*['’]\d{2,4}\b/,
    );
    if (yearStyle) {
      candidates.add(this.normalizeAbbr(yearStyle[1]));
    }

    return Array.from(candidates).filter((x) => x.length >= 2);
  }

  private classifyInputHint(normalizedInput: string): EntryKind | null {
    const words = new Set(normalizedInput.split(" "));
    const conferenceHints = [
      "conference",
      "symposium",
      "workshop",
      "proceedings",
    ];
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

      // 子串包含 — 降低分值避免误匹配（如 cryptographic 包含 crypto 误匹配 CRYPTO）
      // 必须配合其他得分（如 token overlap 或类型偏好）才能跨过 760 阈值
      if (lowerAlias.length >= 4 && normalizedInput.includes(lowerAlias)) {
        score = Math.max(score, 650 + Math.min(30, alias.length));
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
      ...this.conferences.map((entry) => ({
        entry,
        kind: "conference" as const,
      })),
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

      const fullNameEntries =
        this.exactFullNameMap.get(normalizedFullName) || [];
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
      if (
        !new Set(["ACM", "IEEE", "INTERNATIONAL", "PROCEEDINGS"]).has(tokenKey)
      ) {
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
      const hintedKind =
        preferredKind || this.classifyInputHint(normalizedInput);
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

  getRank(name: string): string | null {
    const entry = this.getEntry(name);
    return entry ? entry.rank : null;
  }

  getRankFromItem(item: Zotero.Item): string | null {
    const entry = this.getEntryFromItem(item);
    return entry ? entry.rank : null;
  }

  getCategoryFromItem(item: Zotero.Item): string | null {
    const entry = this.getEntryFromItem(item);
    return entry ? entry.category : null;
  }

  getEntryFromItem(item: Zotero.Item): CCFEntry | null {
    if (!item) return null;

    const itemType = item.itemType;

    if (itemType === "conferencePaper") {
      const proceedingsTitle = item.getField("proceedingsTitle") as string;
      if (proceedingsTitle) {
        const entry = this.getEntry(proceedingsTitle, "conference");
        if (entry) return entry;
      }

      const publicationTitle = item.getField("publicationTitle") as string;
      if (publicationTitle) {
        const entry = this.getEntry(publicationTitle, "conference");
        if (entry) return entry;
      }

      const conferenceName = item.getField("conferenceName") as string;
      if (conferenceName) {
        const entry = this.getEntry(conferenceName, "conference");
        if (entry) return entry;
      }
    }

    if (itemType === "journalArticle") {
      const publicationTitle = item.getField("publicationTitle") as string;
      if (publicationTitle) {
        const entry = this.getEntry(publicationTitle, "journal");
        if (entry) return entry;
      }
    }

    const publicationTitle = item.getField("publicationTitle") as string;
    if (publicationTitle) {
      const entry = this.getEntry(publicationTitle);
      if (entry) return entry;
    }

    const title = item.getField("title") as string;
    if (title) {
      const match = title.match(/\(([A-Z]+['']?\d*)\)/);
      if (match) {
        const entry = this.getEntry(match[1].replace(/[''].*/, ""));
        if (entry) return entry;
      }
    }

    return null;
  }
}

const ccfService = new CCFRankService();

/**
 * CCF 条目数据：每条记录只有一种 mode，互斥
 * - auto:    自动匹配结果
 * - manual:  用户手动设置
 * - ignored: 用户选择忽略
 */
interface ItemCCFData {
  mode: "auto" | "manual" | "ignored";
  rank: string;
  category: string;
  abbr: string;
}

interface ItemDataStore {
  version: number;
  items: Record<number, ItemCCFData>;
}

const DATA_STORAGE_KEY = "extensions.ccfRank.itemData";
const DATA_VERSION = 1;

class UnifiedCCFDataService {
  private cache: Map<number, ItemCCFData> = new Map();

  constructor() {
    this.load();
    this.migrate();
  }

  private load() {
    const raw = Zotero.Prefs.get(DATA_STORAGE_KEY, true) as string;
    if (!raw) return;
    const store: ItemDataStore = JSON.parse(raw);
    if (store.version === DATA_VERSION && store.items) {
      for (const [idStr, entry] of Object.entries(store.items)) {
        this.cache.set(parseInt(idStr), entry as ItemCCFData);
      }
    }
    safeLog(`[CCF Data] Loaded ${this.cache.size} items`);
  }

  private save() {
    const store: ItemDataStore = {
      version: DATA_VERSION,
      items: Object.fromEntries(this.cache),
    };
    Zotero.Prefs.set(DATA_STORAGE_KEY, JSON.stringify(store), true);
  }

  private migrate() {
    const oldRanks = Zotero.Prefs.get(
      "extensions.ccfRank.manualRanks", true) as string;
    const oldCats = Zotero.Prefs.get(
      "extensions.ccfRank.manualCategories", true) as string;
    const oldIgnore = Zotero.Prefs.get(
      "extensions.ccfRank.ignoreItems", true) as string;

    if (!oldRanks && !oldCats && !oldIgnore) return;

    safeLog("[CCF Data] Migrating old format...");

    if (oldRanks) {
      const rankData = JSON.parse(oldRanks);
      let catData: Record<string, string> = {};
      if (oldCats) {
        catData = JSON.parse(oldCats);
      }
      for (const [idStr, rank] of Object.entries(rankData)) {
        const id = parseInt(idStr);
        if (!this.cache.has(id)) {
          this.cache.set(id, {
            mode: "manual", rank: rank as string,
            category: catData[idStr] || "", abbr: "",
          });
        }
      }
    }

    if (oldCats) {
      const catData = JSON.parse(oldCats);
      for (const [idStr, category] of Object.entries(catData)) {
        const id = parseInt(idStr);
        if (!this.cache.has(id)) {
          this.cache.set(id, {
            mode: "manual", rank: "",
            category: category as string, abbr: "",
          });
        }
      }
    }

    if (oldIgnore) {
      const ignoreData = JSON.parse(oldIgnore) as number[];
      for (const id of ignoreData) {
        if (!this.cache.has(id)) {
          this.cache.set(id, {
            mode: "ignored", rank: "", category: "", abbr: "",
          });
        }
      }
    }

    Zotero.Prefs.set("extensions.ccfRank.manualRanks", "", true);
    Zotero.Prefs.set("extensions.ccfRank.manualCategories", "", true);
    Zotero.Prefs.set("extensions.ccfRank.ignoreItems", "", true);

    this.save();
    safeLog(`[CCF Data] Migration done, ${this.cache.size} items`);
  }

  getItemData(itemID: number): ItemCCFData | undefined {
    return this.cache.get(itemID);
  }

  isIgnored(itemID: number): boolean {
    return this.cache.get(itemID)?.mode === "ignored";
  }

  setAuto(itemID: number, rank: string, category: string, abbr: string) {
    const existing = this.cache.get(itemID);
    if (existing && existing.mode !== "auto") return;
    this.cache.set(itemID, { mode: "auto", rank, category, abbr });
    this.save();
  }

  setManualRank(itemID: number, rank: string) {
    const existing = this.cache.get(itemID);
    const category = existing?.mode === "manual" ? existing.category : "";
    this.cache.set(itemID, { mode: "manual", rank, category, abbr: "" });
    this.save();
  }

  setManualCategory(itemID: number, category: string) {
    const existing = this.cache.get(itemID);
    const rank = existing?.mode === "manual" ? existing.rank : "";
    this.cache.set(itemID, { mode: "manual", rank, category, abbr: "" });
    this.save();
  }

  clearManualRank(itemID: number) {
    const existing = this.cache.get(itemID);
    if (existing?.mode !== "manual") return;
    if (existing.category) {
      existing.rank = "";
      this.save();
    } else {
      this.clearManual(itemID);
    }
  }

  clearManualCategory(itemID: number) {
    const existing = this.cache.get(itemID);
    if (existing?.mode !== "manual") return;
    if (existing.rank) {
      existing.category = "";
      this.save();
    } else {
      this.clearManual(itemID);
    }
  }

  clearManual(itemID: number) {
    this.cache.delete(itemID);
    const item = Zotero.Items.get(itemID);
    if (item?.isRegularItem()) {
      const entry = ccfService.getEntryFromItem(item as Zotero.Item);
      if (entry) {
        this.cache.set(itemID, {
          mode: "auto", rank: entry.rank,
          category: entry.category, abbr: entry.abbr,
        });
      }
    }
    this.save();
  }

  ignoreItem(itemID: number) {
    this.cache.set(itemID, { mode: "ignored", rank: "", category: "", abbr: "" });
    this.save();
  }

  unignoreItem(itemID: number) {
    this.cache.delete(itemID);
    const item = Zotero.Items.get(itemID);
    if (item?.isRegularItem()) {
      const entry = ccfService.getEntryFromItem(item as Zotero.Item);
      if (entry) {
        this.cache.set(itemID, {
          mode: "auto", rank: entry.rank,
          category: entry.category, abbr: entry.abbr,
        });
      }
    }
    this.save();
  }

  needsAutoDetect(itemID: number): boolean {
    return !this.cache.has(itemID);
  }
}

const dataService = new UnifiedCCFDataService();

const CCF_CATEGORIES = Array.from(
  new Set(
    [...(ccfData as any).conferences, ...(ccfData as any).journals]
      .map((entry: CCFEntry) => entry.category)
      .filter((category: string) => category && category.trim()),
  ),
).sort((a, b) => a.localeCompare(b, "zh-CN"));

/**
 * CCF 等级列工厂
 */
export class CCFRankFactory {
  static async registerCCFColumn() {
    await Zotero.ItemTreeManager.registerColumns({
      pluginID: addon.data.config.addonID,
      dataKey: "ccfRank",
      label: "CCF 等级",
      width: "75",
      fixedWidth: true,
      dataProvider: (item: Zotero.Item, dataKey: string) => {
        const d = dataService.getItemData(item.id);
        if (!d) return ccfService.getRankFromItem(item) || "";
        if (d.mode === "ignored") return "";
        return d.rank || "";
      },
      renderCell(index, data, column, isFirstColumn, doc) {
        const span = doc.createElement("span");
        span.className = `cell ${column.className}`;
        span.style.display = "flex";
        span.style.width = "100%";
        span.style.justifyContent = "center";
        span.style.alignItems = "center";

        if (data) {
          span.innerText = data;
          span.classList.add("ccf-rank-cell");
        } else {
          span.innerText = "-";
          span.classList.add("ccf-rank-cell", "ccf-rank-cell-empty");
        }

        return span;
      },
    });

    await Zotero.ItemTreeManager.registerColumns({
      pluginID: addon.data.config.addonID,
      dataKey: "ccfCategory",
      label: "CCF 分类",
      dataProvider: (item: Zotero.Item, dataKey: string) => {
        const d = dataService.getItemData(item.id);
        if (!d) return ccfService.getCategoryFromItem(item) || "";
        if (d.mode === "ignored") return "";
        return d.category || "";
      },
      renderCell(index, data, column, isFirstColumn, doc) {
        const span = doc.createElement("span");
        span.className = `cell ${column.className}`;

        if (data) {
          span.innerText = data;
          span.classList.add("ccf-category-cell");
        } else {
          span.innerText = "-";
          span.classList.add("ccf-category-cell", "ccf-category-cell-empty");
        }

        return span;
      },
    });

    safeLog("CCF Rank columns registered successfully");
  }

  static registerRightClickMenu(win: _ZoteroTypes.MainWindow) {
    const doc = win.document;
    const menu = doc.getElementById("zotero-itemmenu");
    if (!menu) {
      safeLog("[CCF Manual] Item context menu not found");
      return;
    }

    const existing = doc.getElementById("ccf-info-menu");
    if (existing) return;

    const menuNode = doc.createXULElement("menu");
    menuNode.setAttribute("id", "ccf-info-menu");
    menuNode.setAttribute("label", "设置 CCF 信息");

    const popup = doc.createXULElement("menupopup");
    menuNode.appendChild(popup);

    const addItem = (
      targetPopup: Element,
      label: string,
      onCommand: () => void,
      options?: { type?: string },
    ) => {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", label);
      if (options?.type) {
        item.setAttribute("type", options.type);
      }
      item.addEventListener("command", onCommand);
      targetPopup.appendChild(item);
      return item;
    };

    const rankMenu = doc.createXULElement("menu");
    rankMenu.setAttribute("id", "ccf-rank-menu");
    rankMenu.setAttribute("label", "设置 CCF 等级");
    const rankPopup = doc.createXULElement("menupopup");
    rankMenu.appendChild(rankPopup);
    popup.appendChild(rankMenu);

    const rankItems: Record<"A" | "B" | "C", Element> = {
      A: addItem(rankPopup, "A", () => this.setManualRank("A"), {
        type: "checkbox",
      }),
      B: addItem(rankPopup, "B", () => this.setManualRank("B"), {
        type: "checkbox",
      }),
      C: addItem(rankPopup, "C", () => this.setManualRank("C"), {
        type: "checkbox",
      }),
    };

    const separator = doc.createXULElement("menuseparator");
    rankPopup.appendChild(separator);

    addItem(rankPopup, "清除手动设置", () => this.clearManualRank());
    const categoryMenu = doc.createXULElement("menu");
    categoryMenu.setAttribute("id", "ccf-category-menu");
    categoryMenu.setAttribute("label", "设置 CCF 分类");
    const categoryPopup = doc.createXULElement("menupopup");
    categoryMenu.appendChild(categoryPopup);
    popup.appendChild(categoryMenu);

    const categoryItems = new Map<string, Element>();
    CCF_CATEGORIES.forEach((category) => {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", category);
      item.setAttribute("type", "checkbox");
      item.addEventListener("command", () => this.setManualCategory(category));
      categoryPopup.appendChild(item);
      categoryItems.set(category, item);
    });

    const categorySeparator = doc.createXULElement("menuseparator");
    categoryPopup.appendChild(categorySeparator);
    const clearCategoryItem = doc.createXULElement("menuitem");
    clearCategoryItem.setAttribute("label", "清除手动分类");
    clearCategoryItem.addEventListener("command", () =>
      this.clearManualCategory(),
    );
    categoryPopup.appendChild(clearCategoryItem);
    const ignoreItem = addItem(
      popup,
      "忽略此条目（不显示等级）",
      () => this.toggleIgnoreItems(),
      { type: "checkbox" },
    );

    popup.addEventListener("popupshowing", () => {
      const items = Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
      let selectedRank: "A" | "B" | "C" | null = null;
      let selectedCategory: string | null = null;
      let rankMixed = false;
      let categoryMixed = false;
      let ignoreState: boolean | null = null;

      for (const item of items) {
        const d = dataService.getItemData(item.id);
        const rank =
          d?.mode === "manual" && d.rank
            ? (d.rank as "A" | "B" | "C")
            : null;
        const category =
          d?.mode === "manual" && d.category ? d.category : null;
        const ignored = d?.mode === "ignored";

        if (!rankMixed) {
          if (!rank) {
            selectedRank = null;
            rankMixed = true;
          } else if (!selectedRank) {
            selectedRank = rank;
          } else if (selectedRank !== rank) {
            selectedRank = null;
            rankMixed = true;
          }
        }

        if (!categoryMixed) {
          if (!category) {
            selectedCategory = null;
            categoryMixed = true;
          } else if (!selectedCategory) {
            selectedCategory = category;
          } else if (selectedCategory !== category) {
            selectedCategory = null;
            categoryMixed = true;
          }
        }

        if (ignoreState === null) {
          ignoreState = ignored;
        } else if (ignoreState !== ignored) {
          ignoreState = null;
        }
      }

      (Object.keys(rankItems) as Array<keyof typeof rankItems>).forEach(
        (key) => {
          if (selectedRank === key) {
            rankItems[key].setAttribute("checked", "true");
          } else {
            rankItems[key].removeAttribute("checked");
          }
        },
      );

      categoryItems.forEach((item, category) => {
        if (selectedCategory === category) {
          item.setAttribute("checked", "true");
        } else {
          item.removeAttribute("checked");
        }
      });

      if (ignoreState) {
        ignoreItem.setAttribute("checked", "true");
      } else {
        ignoreItem.removeAttribute("checked");
      }
    });

    menu.appendChild(menuNode);
    safeLog("CCF Rank right-click menu registered successfully");
  }

  static setManualRank(rank: "A" | "B" | "C") {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    for (const item of items) {
      dataService.setManualRank(item.id, rank);
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Set rank ${rank} for ${items.length} items`);
  }

  static clearManualRank() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    for (const item of items) {
      dataService.clearManualRank(item.id);
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Cleared manual rank for ${items.length} items`);
  }

  static setManualCategory(category: string) {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    for (const item of items) {
      dataService.setManualCategory(item.id, category);
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Set category ${category} for ${items.length} items`);
  }

  static clearManualCategory() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    for (const item of items) {
      dataService.clearManualCategory(item.id);
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Cleared manual category for ${items.length} items`);
  }

  static ignoreItems() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    for (const item of items) {
      dataService.ignoreItem(item.id);
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Ignored ${items.length} items`);
  }

  static toggleIgnoreItems() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    const allIgnored = items.every((item) =>
      dataService.isIgnored(item.id),
    );

    for (const item of items) {
      if (allIgnored) {
        dataService.unignoreItem(item.id);
      } else {
        dataService.ignoreItem(item.id);
      }
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(
      `[CCF] ${allIgnored ? "Unignored" : "Ignored"} ${items.length} items`,
    );
  }

  private static notifierID: string | null = null;

  static registerNotifier() {
    const callback = {
      notify: (
        event: string,
        type: string,
        ids: (string | number)[],
        extraData: Record<string, any>,
      ) => {
        if (event === "add" && type === "item") {
          // 延迟处理，等 Zotero 完成元数据填充
          setTimeout(() => {
            this.autoLookupByIds(ids as number[]);
          }, 10000);
        }
      },
    };

    this.notifierID = Zotero.Notifier.registerObserver(callback, ["item"]);
    safeLog("[CCF] Notifier registered");
  }

  static unregisterNotifier() {
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }
  }

  private static async autoLookupByIds(ids: number[]) {
    const items = Zotero.Items.get(ids).filter((item: Zotero.Item) =>
      item.isRegularItem(),
    );
    if (items.length === 0) return;
    await this.autoLookupItems(items);
  }

  static async autoLookupItems(items: Zotero.Item[]) {
    for (const item of items) {
      if (!dataService.needsAutoDetect(item.id)) continue;

      const entry = ccfService.getEntryFromItem(item);
      if (entry) {
        dataService.setAuto(item.id, entry.rank, entry.category, entry.abbr);
      }
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Auto-lookup completed for ${items.length} items`);
  }
}
