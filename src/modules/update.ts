import { config } from "../../package.json";

const VERSION_KEY = "extensions.ccfRank.lastShownVersion";

interface UpdateLog {
  version: string;
  notes: string[];
}

// 版本日志表：只保留最近若干版本的条目
const UPDATE_LOGS: UpdateLog[] = [
  {
    version: "1.6.0",
    notes: [
      "新增 CCF 简称列",
      "右键菜单支持手动选择 CCF 简称（会议/期刊 → 分类 → 按等级分组），等级与分类自动带出",
      "新增“恢复自动匹配”菜单项",
      "移除手动设置等级/分类入口，数据存储逻辑重构",
    ],
  },
];

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function showUpdateDialogIfNeeded() {
  const current = (config as any).version;
  const stored = Zotero.Prefs.get(VERSION_KEY, true) as string;

  // 全新安装：只记录版本，不弹窗
  if (!stored) {
    Zotero.Prefs.set(VERSION_KEY, current, true);
    return;
  }

  if (compareVersions(current, stored) <= 0) return;

  // 先记录版本，避免多窗口重复弹窗
  Zotero.Prefs.set(VERSION_KEY, current, true);

  const logs = UPDATE_LOGS.filter(
    (log) =>
      compareVersions(log.version, stored) > 0 &&
      compareVersions(log.version, current) <= 0,
  );
  if (logs.length === 0) return;

  const html = logs
    .map(
      (log) => `
      <div>
        <h3 style="margin: 0 0 6px; font-size: 14px;">v${log.version}</h3>
        <ul style="margin: 0 0 10px; padding-left: 20px;">
          ${log.notes.map((note) => `<li style="margin: 2px 0;">${note}</li>`).join("")}
        </ul>
      </div>`,
    )
    .join("");

  const dialog = new ztoolkit.Dialog(1, 1);
  dialog
    .addCell(0, 0, {
      tag: "div",
      properties: { innerHTML: html },
    })
    .addButton("确定", "ok")
    .open(`${config.addonName} 更新日志`, {
      centerscreen: true,
      fitContent: true,
      resizable: false,
    });
}
