import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import ts from "typescript";
import * as core from "../.scaffold/citation-tests/core.js";
import * as service from "../.scaffold/citation-tests/service.js";
import * as http from "../.scaffold/citation-tests/http.js";
import * as providers from "../.scaffold/citation-tests/providers.js";

const config = { addonRef: "ccf-rank", addonID: "ccf-rank@euclpts.com" };
const code = ts.transpileModule(
  readFileSync(
    new URL("../src/modules/citationCount.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

class Element {
  children = [];
  listeners = new Map();
  attributes = {};
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  appendChild(node) {
    this.children.push(node);
    node.parent = this;
  }
  addEventListener(event, handler) {
    this.listeners.set(event, handler);
  }
  removeEventListener(event, handler) {
    if (this.listeners.get(event) === handler) this.listeners.delete(event);
  }
  remove() {
    this.parent.children = this.parent.children.filter((n) => n !== this);
  }
  fire(event) {
    this.listeners.get(event)?.();
  }
}

function fixture({ response } = {}) {
  const prefs = {
    "citation.enabled": true,
    "citation.autoUpdate": false,
    "citation.cacheDays": 7,
  };
  const item = {
    id: 1,
    libraryID: 1,
    key: "ABC123",
    deleted: false,
    isRegularItem: () => true,
    getField: (field) =>
      ({
        title: "Attention Is All You Need",
        DOI: "10.1234/example",
        date: "2017-06-12",
      })[field] || "",
    getCreators: () => [{ creatorTypeID: 1, lastName: "Vaswani" }],
    setField: () => {
      throw new Error("Must not mutate bibliographic fields");
    },
  };
  const menu = new Element();
  const doc = {
    getElementById: () => menu,
    createXULElement: () => new Element(),
    createElement: () => new Element(),
  };
  let selection = [item];
  const win = {
    document: doc,
    ZoteroPane: {
      getSelectedItems: () => selection,
      itemsView: { refreshAndMaintainSelection: async () => {} },
    },
  };
  const columns = new Map();
  const unregistered = [],
    writes = [],
    launched = [],
    errors = [],
    progress = [];
  const dialogs = [];
  let observer,
    requests = 0,
    promptValue = "0";
  const zotero = {
    DataDirectory: { dir: "D:\\Zotero" },
    HTTP: {
      request: async () => {
        requests++;
        return {
          status: 200,
          responseText: JSON.stringify(
            response || {
              id: "https://openalex.org/W1",
              doi: "https://doi.org/10.1234/example",
              display_name: "Attention Is All You Need",
              publication_year: 2017,
              cited_by_count: 0,
              authorships: [],
            },
          ),
          getResponseHeader: () => null,
        };
      },
    },
    Promise: { delay: async () => {} },
    File: { getContentsAsync: async () => "bad cache" },
    PreferencePanes: {
      register: async () => "citations-pane",
      unregister: (id) => {
        assert.equal(id, "citations-pane");
        unregistered.push("pane");
      },
    },
    ItemTreeManager: {
      registerColumns: async (options) => {
        columns.set(options.dataKey, options);
        return options.dataKey;
      },
      unregisterColumns: async (id) => {
        unregistered.push(id);
      },
    },
    Notifier: {
      registerObserver: (callback) => {
        observer = callback;
        return "observer";
      },
      unregisterObserver: (id) => {
        assert.equal(id, "observer");
        unregistered.push(id);
      },
    },
    Items: { get: () => item },
    CreatorTypes: { getID: () => 1 },
    getMainWindows: () => [win],
    logError: (error) => errors.push(error),
    launchURL: (url) => launched.push(url),
  };
  class ProgressWindow {
    createLine() {
      return this;
    }
    show() {
      return this;
    }
    changeLine(line) {
      progress.push(line.text);
      return this;
    }
    startCloseTimer() {}
  }
  class Dialog {
    window = {
      closed: false,
      close: () => {
        this.window.closed = true;
        this.data?.unloadCallback?.();
      },
    };
    setDialogData(data) {
      this.data = data;
      return this;
    }
    addCell(_row, _column, content) {
      this.content = content;
      return this;
    }
    addButton() {
      return this;
    }
    open() {
      dialogs.push(this);
      return this;
    }
  }
  const exported = {};
  vm.runInNewContext(code, {
    exports: exported,
    Zotero: zotero,
    rootURI: "file:///addon/",
    setTimeout,
    clearTimeout,
    ztoolkit: {
      ProgressWindow,
      Dialog,
      getGlobal: (name) =>
        ({
          PathUtils: { join: (...parts) => parts.join("\\") },
          IOUtils: { writeUTF8: async (...args) => writes.push(args) },
          Services: {
            prompt: {
              prompt: (_win, _title, _message, value) => {
                value.value = promptValue;
                return true;
              },
              alert: () => {},
            },
          },
        })[name],
    },
    require: (name) => {
      if (name.endsWith("package.json")) return { config };
      if (name.endsWith("/prefs")) return { getPref: (key) => prefs[key] };
      if (name.endsWith("/core")) return core;
      if (name.endsWith("/service")) return service;
      if (name.endsWith("/http")) return http;
      if (name.endsWith("/providers")) return providers;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const command = (label) =>
    menu.children[0].children[0].children
      .find((n) => n.attributes.label === label)
      .fire("command");
  return {
    factory: exported.CitationCountFactory,
    prefs,
    item,
    win,
    menu,
    columns,
    writes,
    errors,
    launched,
    progress,
    dialogs,
    requests: () => requests,
    observer: () => observer,
    unregistered,
    command,
    select: (items) => (selection = items),
    prompt: (value) => (promptValue = value),
  };
}

async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

test("Zotero startup tolerates corrupt cache, registers four columns and cleans up", async () => {
  const f = fixture();
  await f.factory.startup();
  f.factory.registerMenu(f.win);
  f.factory.registerMenu(f.win);
  assert.equal(f.columns.size, 4);
  assert.equal(f.menu.children.length, 1);
  assert.equal(f.columns.get("citationCount").dataProvider(f.item), "");
  assert.equal(f.columns.get("citationStatus").dataProvider(f.item), "未查询");
  assert.equal(f.requests(), 0);
  await f.factory.shutdown();
  assert.equal(f.menu.children.length, 0);
  assert.equal(f.menu.listeners.size, 0);
  assert.equal(f.unregistered.length, 6);
});

test("batch command fetches zero, preserves metadata and writes atomic cache", async () => {
  const f = fixture();
  await f.factory.startup();
  f.factory.registerMenu(f.win);
  f.command("更新所选条目的被引次数");
  await drain();
  const col = f.columns.get("citationCount"),
    data = col.dataProvider(f.item);
  assert.equal(Number(data), 0);
  assert.equal(data.length, 16);
  assert.equal(
    col.renderCell(0, data, { className: "test" }, false, f.win.document)
      .textContent,
    "0",
  );
  assert.equal(
    f.columns.get("citationSource").dataProvider(f.item),
    "OpenAlex",
  );
  assert.equal(f.columns.get("citationStatus").dataProvider(f.item), "已更新");
  assert.equal(f.requests(), 1);
  assert.ok(f.progress.at(-1).includes("已处理 1/1"));
  await f.factory.shutdown();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][2].tmpPath, `${f.writes[0][0]}.tmp`);
  assert.equal(JSON.parse(f.writes[0][1]).items["1:ABC123"].result.count, 0);
  assert.equal(f.errors.length, 0);
});

test("manual values, attachments, disabling and trash cleanup behave correctly", async () => {
  const f = fixture();
  await f.factory.startup();
  f.factory.registerMenu(f.win);
  f.prompt("7");
  f.command("手动填写被引次数…");
  f.command("更新所选条目的被引次数");
  await drain();
  assert.equal(f.requests(), 0);
  assert.equal(Number(f.columns.get("citationCount").dataProvider(f.item)), 7);
  f.item.deleted = true;
  f.observer().notify("trash", "item", [1], {});
  f.item.deleted = false;
  assert.equal(f.columns.get("citationCount").dataProvider(f.item), "");
  f.item.isRegularItem = () => false;
  assert.equal(f.columns.get("citationStatus").dataProvider(f.item), "");
  f.item.isRegularItem = () => true;
  f.prefs["citation.enabled"] = false;
  assert.equal(f.columns.get("citationStatus").dataProvider(f.item), "");
  f.factory.settingsChanged();
  await f.factory.shutdown();
});

test("automatic column reads share a request; Scholar and single-item actions work", async () => {
  const f = fixture();
  await f.factory.startup();
  f.factory.registerMenu(f.win);
  f.prefs["citation.autoUpdate"] = true;
  for (const column of f.columns.values()) column.dataProvider(f.item);
  await drain();
  assert.equal(f.requests(), 1);
  f.command("在 Google Scholar 中核对");
  assert.ok(f.launched[0].startsWith("https://scholar.google.com/scholar?q="));
  f.select([f.item, { ...f.item, id: 2, key: "XYZ123" }]);
  f.menu.fire("popupshowing");
  const nodes = f.menu.children[0].children[0].children;
  assert.equal(
    nodes.find((n) => n.attributes.label === "手动填写被引次数…").attributes
      .disabled,
    "true",
  );
  assert.equal(
    nodes.find((n) => n.attributes.label === "更新所选条目的被引次数")
      .attributes.disabled,
    "false",
  );
  await f.factory.shutdown();
});

function findButtons(dialog) {
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(dialog.content);
  return nodes.filter((node) => node.tag === "button");
}

test("confirmation window shows missing metadata and binds the chosen paper for automatic refresh", async () => {
  const f = fixture();
  await f.factory.startup();
  f.factory.registerMenu(f.win);
  f.command("确认 OpenAlex 论文…");
  await drain();
  assert.equal(f.dialogs.length, 1);
  assert.ok(JSON.stringify(f.dialogs[0].content).includes("OpenAlex 未提供"));
  const buttons = findButtons(f.dialogs[0]);
  buttons
    .find((button) => button.properties.textContent === "打开论文页面")
    .listeners[0].listener();
  assert.equal(f.launched[0], "https://openalex.org/W1");
  buttons
    .find((button) => button.properties.textContent === "确认此论文并自动更新")
    .listeners[0].listener();
  await drain();
  assert.equal(f.dialogs[0].window.closed, true);
  assert.equal(
    f.columns.get("citationSource").dataProvider(f.item),
    "OpenAlex",
  );
  await f.factory.shutdown();
  const saved = JSON.parse(f.writes.at(-1)[1]).items["1:ABC123"];
  assert.equal(saved.boundPaperID, "https://openalex.org/W1");
  assert.equal(saved.result.matchedBy, "confirmed");
  assert.equal(f.requests(), 2);
});

test("metadata changes after opening confirmation cannot bind a stale candidate", async () => {
  const f = fixture();
  await f.factory.startup();
  f.factory.registerMenu(f.win);
  f.command("确认 OpenAlex 论文…");
  await drain();
  const dialog = f.dialogs[0];
  const old = f.item.getField;
  f.item.getField = (field) =>
    field === "title" ? "An entirely corrected paper title" : old(field);
  findButtons(dialog)
    .find((button) => button.properties.textContent === "确认此论文并自动更新")
    .listeners[0].listener();
  await drain();
  assert.equal(f.writes.length, 0);
  assert.equal(dialog.window.closed, true);
  await f.factory.shutdown();
});

test("closing a parent window cleans up its candidate dialog and manual count is the last menu action", async () => {
  const f = fixture();
  await f.factory.startup();
  f.factory.registerMenu(f.win);
  const actions = f.menu.children[0].children[0].children;
  assert.equal(actions.at(-1).attributes.label, "手动填写被引次数…");
  f.command("确认 OpenAlex 论文…");
  await drain();
  f.factory.unloadWindow(f.win);
  assert.equal(f.dialogs[0].window.closed, true);
  await f.factory.shutdown();
});
