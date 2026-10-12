import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import {
  DAY,
  countSortKey,
  normalizeDOI,
  fingerprint,
  type Identity,
  type RecordEntry,
} from "./citations/core";
import { CitationService } from "./citations/service";
import { CitationHTTP } from "./citations/http";
import { OpenAlexProvider } from "./citations/providers";

const SOURCE_LABELS = {
  openalex: "OpenAlex",
  manual: "手动",
};

export class CitationCountFactory {
  private static service: CitationService;
  private static alive = false;
  private static observer: string | null = null;
  private static columns: string[] = [];
  private static menus = new Map<
    Window,
    { node: Element; parent: Element; listener: () => void }
  >();
  private static itemKeys = new Map<number, string>();
  private static writes: Promise<void> = Promise.resolve();
  private static refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private static cachePath: string;
  private static paneID: string;
  private static dialogs = new Map<{ window: Window }, Window>();

  static async startup(): Promise<void> {
    this.alive = true;
    this.cachePath = ztoolkit
      .getGlobal("PathUtils")
      .join(Zotero.DataDirectory.dir, "ccf-rank-citations.json");
    const http = new CitationHTTP(
      async (url, headers) => {
        const response = await Zotero.HTTP.request("GET", url, {
          headers,
          responseType: "text",
          timeout: 15_000,
          successCodes: false,
        });
        return {
          status: response.status,
          data:
            response.status === 200
              ? JSON.parse(response.responseText || "")
              : null,
          retryAfter: response.getResponseHeader("Retry-After") || undefined,
        };
      },
      Date.now,
      (ms) => Zotero.Promise.delay(ms),
      () => this.alive && this.enabled(),
    );
    this.service = new CitationService({
      provider: new OpenAlexProvider(http, () => ({
        openAlexKey: getPref("citation.openAlexKey") || "",
      })),
      now: Date.now,
      ttl: () =>
        Math.max(1, Math.min(365, Number(getPref("citation.cacheDays")) || 7)) *
        DAY,
      changed: () => {
        this.persist();
        this.refreshViews();
      },
    });
    try {
      this.service.load(
        (await Zotero.File.getContentsAsync(this.cachePath)) as string,
      );
    } catch {
      // Missing cache is expected on first startup.
    }
    this.paneID = await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      label: "CCF Rank",
      src: `${rootURI}content/preferences.xhtml`,
    });
    await this.registerColumns();
    this.observer = Zotero.Notifier.registerObserver(
      {
        notify: (
          event: string,
          type: string,
          ids: (string | number)[],
          extraData: Record<string, any>,
        ) => {
          if (type !== "item" || !this.alive) return;
          for (const rawID of ids) {
            const id = Number(rawID);
            if (event === "delete") {
              const data = extraData[id];
              const key =
                this.itemKeys.get(id) ||
                (data?.libraryID && data?.key
                  ? `${data.libraryID}:${data.key}`
                  : undefined);
              if (key) this.service.remove(key);
              this.itemKeys.delete(id);
            } else if (
              event === "add" ||
              event === "modify" ||
              event === "trash"
            ) {
              const item = Zotero.Items.get(id);
              if (!item) continue;
              const identity = this.identity(item);
              if (item.deleted) {
                this.service.remove(`${item.libraryID}:${item.key}`);
              } else if (
                identity &&
                this.enabled() &&
                getPref("citation.autoUpdate")
              ) {
                void this.service.refresh(identity);
              }
            }
          }
        },
      },
      ["item"],
    );
  }

  private static enabled(): boolean {
    return getPref("citation.enabled") !== false;
  }

  static settingsChanged(): void {
    this.service.cancelPending();
    this.refreshViews();
  }

  private static identity(item: Zotero.Item): Identity | undefined {
    if (!item.isRegularItem() || !item.key || item.deleted) return undefined;
    const field = (name: string) => String(item.getField(name) || "");
    const key = `${item.libraryID}:${item.key}`;
    this.itemKeys.set(item.id, key);
    const year = field("date").match(/\b(\d{4})\b/);
    const firstAuthor = item
      .getCreators()
      .find((c) => c.creatorTypeID === Zotero.CreatorTypes.getID("author"));
    return {
      key,
      title: field("title"),
      doi: normalizeDOI(field("DOI")),
      year: year ? Number(year[1]) : undefined,
      author: firstAuthor?.lastName || undefined,
    };
  }

  private static persist(): void {
    const raw = this.service.serialize();
    this.writes = this.writes
      .then(async () => {
        await ztoolkit
          .getGlobal("IOUtils")
          .writeUTF8(this.cachePath, raw, { tmpPath: `${this.cachePath}.tmp` });
      })
      .catch(() => {
        Zotero.logError(
          new Error(
            "CCF Rank：被引次数缓存保存失败，请检查 Zotero 数据目录权限",
          ),
        );
      });
  }

  private static refreshViews(): void {
    if (this.refreshTimer || !this.alive) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (!this.alive) return;
      for (const win of Zotero.getMainWindows()) {
        const view = win.ZoteroPane.itemsView;
        if (view) void view.refreshAndMaintainSelection();
      }
    }, 200);
  }

  private static state(identity: Identity, entry?: RecordEntry): string {
    if (entry?.result?.source === "manual") return "手动";
    if (this.service.isPending(identity))
      return entry?.result ? "更新中（保留旧值）" : "查询中";
    if (!entry) return "未查询";
    if (entry.status === "error")
      return entry.result ? "更新失败（保留旧值）" : "查询失败";
    if (entry.status === "ambiguous")
      return entry.result ? "需核对（保留旧值）" : "需核对";
    if (entry.status === "not-found")
      return entry.result ? "未找到（保留旧值）" : "未找到";
    return this.service.isStale(entry) ? "待更新" : "已更新";
  }

  private static async registerColumns(): Promise<void> {
    for (const [key, label] of [
      ["citationCount", "被引次数"],
      ["citationSource", "被引数据源"],
      ["citationUpdated", "被引更新时间"],
      ["citationStatus", "被引状态"],
    ]) {
      const registered = await Zotero.ItemTreeManager.registerColumns({
        pluginID: config.addonID,
        dataKey: key,
        label,
        dataProvider: (item: Zotero.Item) => {
          if (!this.enabled()) return "";
          const identity = this.identity(item);
          if (!identity) return "";
          const entry = this.service.get(identity);
          if (getPref("citation.autoUpdate"))
            void this.service.refresh(identity);
          if (key === "citationCount")
            return entry?.result ? countSortKey(entry.result.count) : "";
          if (key === "citationSource")
            return entry?.result ? SOURCE_LABELS[entry.result.source] : "";
          if (key === "citationUpdated")
            return entry?.result
              ? new Date(entry.result.updatedAt).toISOString().slice(0, 10)
              : "";
          return this.state(identity, entry);
        },
        renderCell: (_index, data, column, _first, doc) => {
          const span = doc.createElement("span");
          span.className = `cell ${column.className}`;
          span.textContent =
            key === "citationCount" && data ? String(Number(data)) : data || "";
          return span;
        },
      });
      if (registered) this.columns.push(registered as string);
    }
  }

  static registerMenu(win: _ZoteroTypes.MainWindow): void {
    const doc = win.document;
    const parent = doc.getElementById("zotero-itemmenu");
    if (!parent || this.menus.has(win)) return;
    const menu = doc.createXULElement("menu");
    menu.id = `${config.addonRef}-citations-menu`;
    menu.setAttribute("label", "被引次数");
    const popup = doc.createXULElement("menupopup");
    menu.appendChild(popup);
    const add = (label: string, action: () => void, single = false) => {
      const node = doc.createXULElement("menuitem");
      node.setAttribute("label", label);
      node.addEventListener("command", action);
      popup.appendChild(node);
      return { node, single };
    };
    const actions = [
      add("更新所选条目的被引次数", () => {
        void this.refreshSelected(win);
      }),
      add(
        "确认 OpenAlex 论文…",
        () => {
          void this.confirmFromMenu(win);
        },
        true,
      ),
      add(
        "查看查询详情",
        () => {
          const item = this.selected(win)[0];
          const identity = item && this.identity(item);
          if (!identity) return;
          const entry = this.service.get(identity);
          const result = entry?.result;
          ztoolkit
            .getGlobal("Services")
            .prompt.alert(
              win,
              "被引次数详情",
              [
                identity.title,
                `状态：${this.state(identity, entry)}`,
                `被引次数：${result?.count ?? "未知"}`,
                `数据源：${result ? SOURCE_LABELS[result.source] : "未知"}`,
                `匹配方式：${result ? { doi: "DOI", title: "标题与元数据", confirmed: "人工确认论文（自动更新次数）", manual: "手动填写次数" }[result.matchedBy] : "未知"}`,
                `数据更新时间：${result ? new Date(result.updatedAt).toLocaleString() : "未知"}`,
                `最近查询时间：${entry ? new Date(entry.checkedAt).toLocaleString() : "未知"}`,
                entry?.error ? `查询错误：${entry.error}` : "",
                entry?.detail ? `匹配说明：${entry.detail}` : "",
                entry?.candidates?.length
                  ? `可确认候选：${entry.candidates.length} 个，请使用“确认 OpenAlex 论文…”`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            );
        },
        true,
      ),
      add("清除记录并恢复自动查询", () => {
        for (const item of this.selected(win)) {
          const identity = this.identity(item);
          if (identity) {
            this.service.remove(identity.key);
            void this.service.refresh(identity, true);
          }
        }
      }),
      add(
        "打开数据源记录",
        () => {
          const item = this.selected(win)[0];
          const identity = item && this.identity(item);
          const url = identity && this.service.get(identity)?.result?.url;
          if (url && /^https:\/\/openalex\.org\/W\d+$/i.test(url))
            Zotero.launchURL(url);
        },
        true,
      ),
      add(
        "在 Google Scholar 中核对",
        () => {
          const item = this.selected(win)[0];
          if (item)
            Zotero.launchURL(
              `https://scholar.google.com/scholar?q=${encodeURIComponent(String(item.getField("title")))}`,
            );
        },
        true,
      ),
      add("手动填写被引次数…", () => this.setManual(win), true),
    ];
    const listener = () => {
      const count = this.selected(win).length;
      menu.setAttribute("disabled", String(!this.enabled() || !count));
      for (const { node, single } of actions)
        node.setAttribute(
          "disabled",
          String(!count || (single && count !== 1)),
        );
    };
    parent.addEventListener("popupshowing", listener);
    parent.appendChild(menu);
    this.menus.set(win, { node: menu, parent, listener });
  }

  private static selected(win: _ZoteroTypes.MainWindow): Zotero.Item[] {
    return win.ZoteroPane.getSelectedItems().filter(
      (i) => i.isRegularItem() && !i.deleted,
    );
  }

  private static async confirmFromMenu(
    win: _ZoteroTypes.MainWindow,
  ): Promise<void> {
    const item = this.selected(win)[0];
    const identity = item && this.identity(item);
    if (!identity || !this.alive || !this.enabled()) return;
    const signature = fingerprint(identity);
    const progress = new ztoolkit.ProgressWindow("查找 OpenAlex 论文", {
      closeOnClick: true,
    });
    progress.createLine({ text: "正在检索可确认的候选论文…" }).show();
    try {
      const lookup = await this.service.findCandidates(identity);
      if (!this.alive || !this.enabled() || win.closed) return;
      const current = this.identity(item);
      if (!current || fingerprint(current) !== signature) return;
      const candidates = lookup.candidates?.length ? lookup.candidates : [];
      const dialog = new ztoolkit.Dialog(1, 1);
      dialog.setDialogData({
        unloadCallback: () => this.dialogs.delete(dialog),
      });
      dialog.addCell(0, 0, {
        tag: "div",
        namespace: "html",
        styles: {
          padding: "12px",
          width: "620px",
          maxHeight: "480px",
          overflowY: "auto",
        },
        children: [
          {
            tag: "p",
            namespace: "html",
            properties: { textContent: `当前文献：${identity.title}` },
          },
          {
            tag: "p",
            namespace: "html",
            properties: {
              textContent:
                lookup.detail || "请核对并确认论文，后续由 OpenAlex 自动更新。",
            },
          },
          ...candidates.map((candidate) => ({
            tag: "section",
            namespace: "html",
            styles: {
              border: "1px solid #888",
              borderRadius: "6px",
              padding: "12px",
              marginBottom: "12px",
            },
            children: [
              {
                tag: "h3",
                namespace: "html",
                properties: { textContent: candidate.title },
              },
              {
                tag: "div",
                namespace: "html",
                styles: { whiteSpace: "pre-wrap" },
                properties: {
                  textContent: [
                    `作者：${candidate.authors.join("、") || "OpenAlex 未提供"}`,
                    `年份：${candidate.year || "OpenAlex 未提供"}`,
                    `出版物：${candidate.venue || "OpenAlex 未提供"}`,
                    `DOI：${candidate.doi || "未提供"}`,
                    `OpenAlex 被引次数：${candidate.count}`,
                    candidate.reasons.length
                      ? `需注意：${candidate.reasons.join("；")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              },
              {
                tag: "button",
                namespace: "html",
                properties: { textContent: "打开论文页面" },
                listeners: [
                  {
                    type: "click",
                    listener: () => Zotero.launchURL(candidate.url),
                  },
                ],
              },
              {
                tag: "button",
                namespace: "html",
                properties: { textContent: "确认此论文并自动更新" },
                listeners: [
                  {
                    type: "click",
                    listener: () => {
                      const latest = this.identity(item);
                      if (
                        !this.alive ||
                        !this.enabled() ||
                        !latest ||
                        fingerprint(latest) !== signature
                      ) {
                        ztoolkit
                          .getGlobal("Services")
                          .prompt.alert(
                            dialog.window,
                            "确认论文",
                            "文献信息已改变，请重新检索并确认。",
                          );
                        dialog.window.close();
                        return;
                      }
                      this.service.confirmCandidate(latest, candidate);
                      void this.service.refresh(latest, true);
                      dialog.window.close();
                    },
                  },
                ],
              },
            ],
          })),
          ...(!candidates.length
            ? [
                {
                  tag: "p",
                  namespace: "html",
                  properties: {
                    textContent:
                      "未找到候选，请核对 DOI 和标题，或到 Google Scholar 核对。",
                  },
                },
              ]
            : []),
        ],
      });
      dialog.addButton("Google Scholar 核对", "scholar", {
        noClose: true,
        callback: () =>
          Zotero.launchURL(
            `https://scholar.google.com/scholar?q=${encodeURIComponent(identity.title)}`,
          ),
      });
      dialog.addButton("关闭", "close");
      this.dialogs.set(dialog, win);
      dialog.open("确认 OpenAlex 论文", {
        centerscreen: true,
        resizable: true,
        fitContent: true,
      });
    } catch (error) {
      if (this.alive && !win.closed)
        ztoolkit
          .getGlobal("Services")
          .prompt.alert(
            win,
            "查找 OpenAlex 论文",
            error instanceof Error ? error.message : "查询失败，请稍后重试",
          );
    } finally {
      progress.startCloseTimer(500);
    }
  }

  private static async refreshSelected(
    win: _ZoteroTypes.MainWindow,
  ): Promise<void> {
    const items = this.selected(win);
    const progress = new ztoolkit.ProgressWindow("被引次数更新", {
      closeOnClick: true,
    });
    progress
      .createLine({ text: `正在更新 ${items.length} 个条目…`, progress: 0 })
      .show();
    let done = 0;
    let errors = 0;
    let manual = 0;
    let unmatched = 0;
    for (const item of items) {
      if (!this.alive || !this.enabled()) break;
      const identity = this.identity(item);
      if (identity) {
        await this.service.refresh(identity, true);
        const entry = this.service.get(identity);
        if (entry?.status === "error") errors++;
        else if (entry?.result?.source === "manual") manual++;
        else if (entry?.status !== "ok") unmatched++;
      }
      done++;
      progress.changeLine({
        text: `已处理 ${done}/${items.length}`,
        progress: (done / items.length) * 100,
      });
    }
    progress.changeLine({
      text: `已处理 ${done}/${items.length}；失败 ${errors}，待核对/未找到 ${unmatched}，手动记录 ${manual}`,
    });
    progress.startCloseTimer(6000);
    this.refreshViews();
  }

  private static setManual(win: _ZoteroTypes.MainWindow): void {
    const item = this.selected(win)[0];
    const identity = item && this.identity(item);
    if (!identity) return;
    const value = {
      value: String(this.service.get(identity)?.result?.count ?? ""),
    };
    const prompt = ztoolkit.getGlobal("Services").prompt;
    if (
      !prompt.prompt(
        win,
        "手动填写被引次数",
        "请输入非负整数（手动记录会保留，直到清除或文献信息改变）",
        value,
        null,
        { value: false },
      )
    )
      return;
    if (
      !/^\d+$/.test(value.value.trim()) ||
      !Number.isSafeInteger(Number(value.value))
    ) {
      prompt.alert(win, "被引次数", "请输入有效的非负整数。");
      return;
    }
    this.service.setManual(identity, Number(value.value));
  }

  static unloadWindow(win: Window): void {
    for (const [dialog, owner] of this.dialogs)
      if (owner === win) dialog.window?.close();
    const menu = this.menus.get(win);
    menu?.parent.removeEventListener("popupshowing", menu.listener);
    menu?.node.remove();
    this.menus.delete(win);
  }

  static async shutdown(): Promise<void> {
    this.alive = false;
    this.service?.stop();
    for (const dialog of this.dialogs.keys()) dialog.window?.close();
    this.dialogs.clear();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.observer) Zotero.Notifier.unregisterObserver(this.observer);
    for (const win of this.menus.keys()) this.unloadWindow(win);
    for (const key of this.columns)
      await Zotero.ItemTreeManager.unregisterColumns(key);
    Zotero.PreferencePanes.unregister(this.paneID);
    await this.writes;
  }
}
