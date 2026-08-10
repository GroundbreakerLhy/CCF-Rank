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

  getAbbrFromItem(item: Zotero.Item): string | null {
    const entry = this.getEntryFromItem(item);
    return entry ? entry.abbr : null;
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
 * CCF 条目数据：自动匹配结果，ignored 表示用户选择忽略
 */
interface ItemCCFData {
  rank: string;
  category: string;
  abbr: string;
  ignored: boolean;
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

  private normalizeLegacy(entry: any): ItemCCFData {
    if (entry.ignored || entry.mode === "ignored") {
      return { rank: "", category: "", abbr: "", ignored: true };
    }
    // 旧 manual/auto 数据统一转为普通数据，不再有手动语义
    return {
      rank: entry.rank || "",
      category: entry.category || "",
      abbr: entry.abbr || "",
      ignored: false,
    };
  }

  private load() {
    const raw = Zotero.Prefs.get(DATA_STORAGE_KEY, true) as string;
    if (!raw) return;
    const store: ItemDataStore = JSON.parse(raw);
    if (store.items) {
      for (const [idStr, entry] of Object.entries(store.items)) {
        this.cache.set(parseInt(idStr), this.normalizeLegacy(entry));
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
      "extensions.ccfRank.manualRanks",
      true,
    ) as string;
    const oldCats = Zotero.Prefs.get(
      "extensions.ccfRank.manualCategories",
      true,
    ) as string;
    const oldIgnore = Zotero.Prefs.get(
      "extensions.ccfRank.ignoreItems",
      true,
    ) as string;

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
            rank: rank as string,
            category: catData[idStr] || "",
            abbr: "",
            ignored: false,
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
            rank: "",
            category: category as string,
            abbr: "",
            ignored: false,
          });
        }
      }
    }

    if (oldIgnore) {
      const ignoreData = JSON.parse(oldIgnore) as number[];
      for (const id of ignoreData) {
        if (!this.cache.has(id)) {
          this.cache.set(id, {
            rank: "",
            category: "",
            abbr: "",
            ignored: true,
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
    return this.cache.get(itemID)?.ignored === true;
  }

  setAuto(itemID: number, rank: string, category: string, abbr: string) {
    if (this.cache.has(itemID)) return;
    this.cache.set(itemID, { rank, category, abbr, ignored: false });
    this.save();
  }

  setManualAbbr(itemID: number, entry: CCFEntry) {
    this.cache.set(itemID, {
      rank: entry.rank,
      category: entry.category,
      abbr: entry.abbr,
      ignored: false,
    });
    this.save();
  }

  ignoreItem(itemID: number) {
    this.cache.set(itemID, {
      rank: "",
      category: "",
      abbr: "",
      ignored: true,
    });
    this.save();
  }

  unignoreItem(itemID: number) {
    this.cache.delete(itemID);
    const item = Zotero.Items.get(itemID);
    if (item && item.isRegularItem()) {
      const entry = ccfService.getEntryFromItem(item);
      if (entry) {
        this.cache.set(itemID, {
          rank: entry.rank,
          category: entry.category,
          abbr: entry.abbr,
          ignored: false,
        });
      }
    }
    this.save();
  }

  resetAuto(itemID: number) {
    this.unignoreItem(itemID);
  }

  needsAutoDetect(itemID: number): boolean {
    return !this.cache.has(itemID);
  }
}

const dataService = new UnifiedCCFDataService();

/**
 * 按 类型→分类 分组的简称菜单数据，重复简称用全称标注区分
 */
const CCF_ABBR_GROUPS: Array<{
  kind: "conference" | "journal";
  categories: Array<{
    category: string;
    items: Array<{ label: string; entry: CCFEntry }>;
  }>;
}> = (() => {
  const all = [
    ...(ccfData as any).conferences,
    ...(ccfData as any).journals,
  ] as CCFEntry[];
  const seenCount = new Map<string, number>();
  for (const entry of all) {
    seenCount.set(entry.abbr, (seenCount.get(entry.abbr) || 0) + 1);
  }
  const groupByKind = (kind: "conference" | "journal") => {
    const groups = new Map<string, Array<{ label: string; entry: CCFEntry }>>();
    const entries =
      kind === "conference"
        ? (ccfData as any).conferences
        : (ccfData as any).journals;
    for (const entry of entries as CCFEntry[]) {
      const label = entry.abbr
        ? (seenCount.get(entry.abbr) || 0) > 1
          ? `${entry.abbr} (${entry.fullName})`
          : entry.abbr
        : entry.fullName;
      const list = groups.get(entry.category) || [];
      list.push({ label, entry });
      groups.set(entry.category, list);
    }
    return Array.from(groups.entries())
      .map(([category, items]) => ({ category, items }))
      .sort((a, b) => a.category.localeCompare(b.category, "zh-CN"));
  };
  return [
    { kind: "conference" as const, categories: groupByKind("conference") },
    { kind: "journal" as const, categories: groupByKind("journal") },
  ];
})();

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
        if (d.ignored) return "";
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
        if (d.ignored) return "";
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

    await Zotero.ItemTreeManager.registerColumns({
      pluginID: addon.data.config.addonID,
      dataKey: "ccfAbbr",
      label: "CCF 简称",
      dataProvider: (item: Zotero.Item, dataKey: string) => {
        const d = dataService.getItemData(item.id);
        if (!d) return ccfService.getAbbrFromItem(item) || "";
        if (d.ignored) return "";
        return d.abbr || "";
      },
      renderCell(index, data, column, isFirstColumn, doc) {
        const span = doc.createElement("span");
        span.className = `cell ${column.className}`;

        if (data) {
          span.innerText = data;
          span.classList.add("ccf-abbr-cell");
        } else {
          span.innerText = "-";
          span.classList.add("ccf-abbr-cell", "ccf-abbr-cell-empty");
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
      safeLog("[CCF] Item context menu not found");
      return;
    }

    const existing = doc.getElementById("ccf-info-menu");
    if (existing) return;

    const menuNode = doc.createXULElement("menu");
    menuNode.setAttribute("id", "ccf-info-menu");
    menuNode.setAttribute("label", "CCF 选项");

    const popup = doc.createXULElement("menupopup");
    menuNode.appendChild(popup);

    // 设置 CCF 简称：按分类分组，选择后 rank/category 自动带出
    const abbrMenu = doc.createXULElement("menu");
    abbrMenu.setAttribute("id", "ccf-abbr-menu");
    abbrMenu.setAttribute("label", "设置 CCF 简称");
    const abbrPopup = doc.createXULElement("menupopup");
    abbrMenu.appendChild(abbrPopup);
    popup.appendChild(abbrMenu);

    const abbrItems = new Map<string, Element[]>();
    for (const group of CCF_ABBR_GROUPS) {
      const kindMenu = doc.createXULElement("menu");
      kindMenu.setAttribute(
        "label",
        group.kind === "conference" ? "会议" : "期刊",
      );
      const kindPopup = doc.createXULElement("menupopup");
      kindMenu.appendChild(kindPopup);
      for (const cat of group.categories) {
        const catMenu = doc.createXULElement("menu");
        catMenu.setAttribute("label", cat.category);
        const catPopup = doc.createXULElement("menupopup");
        catMenu.appendChild(catPopup);
        // 按 A/B/C 排序，等级切换处分隔
        const rankOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
        const sorted = [...cat.items].sort(
          (a, b) =>
            (rankOrder[a.entry.rank] ?? 9) - (rankOrder[b.entry.rank] ?? 9),
        );
        let prevRank: string | null = null;
        for (const { label, entry } of sorted) {
          if (prevRank !== null && entry.rank !== prevRank) {
            catPopup.appendChild(doc.createXULElement("menuseparator"));
          }
          prevRank = entry.rank;
          const item = doc.createXULElement("menuitem");
          item.setAttribute("label", label);
          item.setAttribute("type", "checkbox");
          item.addEventListener("command", () =>
            this.setManualAbbrFromMenu(entry),
          );
          catPopup.appendChild(item);
          const list = abbrItems.get(entry.abbr) || [];
          list.push(item);
          abbrItems.set(entry.abbr, list);
        }
        kindPopup.appendChild(catMenu);
      }
      abbrPopup.appendChild(kindMenu);
    }

    const resetItem = doc.createXULElement("menuitem");
    resetItem.setAttribute("label", "恢复自动匹配");
    resetItem.addEventListener("command", () => this.resetAutoFromMenu());
    popup.appendChild(resetItem);

    const separator = doc.createXULElement("menuseparator");
    popup.appendChild(separator);

    const ignoreItem = doc.createXULElement("menuitem");
    ignoreItem.setAttribute("label", "忽略此条目（不显示等级）");
    ignoreItem.setAttribute("type", "checkbox");
    ignoreItem.addEventListener("command", () => this.toggleIgnoreItems());
    popup.appendChild(ignoreItem);

    popup.addEventListener("popupshowing", () => {
      const items = Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
      const allIgnored = items.every((item) => dataService.isIgnored(item.id));

      if (allIgnored) {
        ignoreItem.setAttribute("checked", "true");
      } else {
        ignoreItem.removeAttribute("checked");
      }

      // 全部选中条目 abbr 一致时勾选对应菜单项
      let currentAbbr: string | null = null;
      const firstData =
        items.length > 0 ? dataService.getItemData(items[0].id) : undefined;
      if (
        firstData &&
        !firstData.ignored &&
        firstData.abbr &&
        items.every(
          (item) => dataService.getItemData(item.id)?.abbr === firstData.abbr,
        )
      ) {
        currentAbbr = firstData.abbr;
      }

      for (const [abbr, elements] of abbrItems) {
        if (currentAbbr === abbr) {
          elements.forEach((el) => el.setAttribute("checked", "true"));
        } else {
          elements.forEach((el) => el.removeAttribute("checked"));
        }
      }
    });

    menu.appendChild(menuNode);
    safeLog("CCF Rank right-click menu registered successfully");
  }

  static setManualAbbrFromMenu(entry: CCFEntry) {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    for (const item of items) {
      dataService.setManualAbbr(item.id, entry);
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Set abbr ${entry.abbr} for ${items.length} items`);
  }

  static resetAutoFromMenu() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    for (const item of items) {
      dataService.resetAuto(item.id);
    }

    const itemsView = Zotero.getActiveZoteroPane()?.itemsView;
    if (itemsView) {
      (itemsView as any).refreshAndMaintainSelection();
    }

    safeLog(`[CCF] Reset auto for ${items.length} items`);
  }

  static toggleIgnoreItems() {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems();
    if (!items || items.length === 0) return;

    const allIgnored = items.every((item) => dataService.isIgnored(item.id));

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
