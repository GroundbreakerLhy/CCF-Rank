import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { CitationCountFactory } from "./citationCount";

export async function registerPrefsScripts(window: Window) {
  for (const name of ["enabled", "autoUpdate"] as const) {
    const input = window.document.getElementById(
      `${config.addonRef}-citation-${name}`,
    ) as HTMLInputElement | null;
    if (!input) continue;
    input.checked = Boolean(getPref(`citation.${name}`));
    input.addEventListener("change", () => {
      setPref(`citation.${name}`, input.checked);
      CitationCountFactory.settingsChanged();
    });
  }
  for (const name of ["openAlexKey", "cacheDays"] as const) {
    const input = window.document.getElementById(
      `${config.addonRef}-citation-${name}`,
    ) as HTMLInputElement | null;
    if (!input) continue;
    input.value = String(getPref(`citation.${name}`) ?? "");
    input.addEventListener("change", () => {
      if (name === "cacheDays") {
        const value = Number(input.value);
        if (!Number.isInteger(value) || value < 1 || value > 365) {
          input.value = String(getPref("citation.cacheDays"));
          return;
        }
        setPref("citation.cacheDays", value);
      } else setPref(`citation.${name}`, input.value.trim());
      CitationCountFactory.settingsChanged();
    });
  }
}
