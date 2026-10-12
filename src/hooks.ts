import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { CCFRankFactory } from "./modules/ccfRank";
import { showUpdateDialogIfNeeded } from "./modules/update";
import { CitationCountFactory } from "./modules/citationCount";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  await CCFRankFactory.registerCCFColumn();
  CCFRankFactory.registerNotifier();
  await CitationCountFactory.startup();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  showUpdateDialogIfNeeded();

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  CCFRankFactory.registerRightClickMenu(win);
  CitationCountFactory.registerMenu(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  CitationCountFactory.unloadWindow(win);
  ztoolkit.unregisterAll();
}

async function onShutdown(): Promise<void> {
  await CitationCountFactory.shutdown();
  CCFRankFactory.unregisterNotifier();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
