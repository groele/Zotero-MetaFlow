import { cleanupResourcesSync } from "../utils/cleanup";
import { getLocaleID, getString } from "../utils/locale";
import { createLogger } from "../utils/logger";
import { getPref } from "../utils/prefs";
import { refreshJournalPane } from "./journal-pane";
import {
  cleanseTLDRFromExtra,
  extractTLDRFromExtra,
  extractTLDRFromItem,
  saveTLDRToItem,
  saveTLDRToNote,
} from "./rules/tool-update-metadata/tldr";

const logger = createLogger("item-info-row");

let registeredRowID: string | false | undefined;
const prefObserverIDs: symbol[] = [];
const activeObservers = new Set<MutationObserver>();
const observedTables = new WeakSet<Node>();
const migratingItemIDs = new Set<number>();
let isPlacingTLDR = false;

export function registerInfoRows() {
  if (registeredRowID)
    return;
  if (typeof Zotero === "undefined" || !Zotero.ItemPaneManager?.registerInfoRow)
    return;

  try {
    registeredRowID = Zotero.ItemPaneManager.registerInfoRow({
      rowID: "tldr",
      pluginID: addon.data.config.addonID,
      label: {
        l10nID: getLocaleID("info-row-tldr") || "metaref-info-row-tldr",
        text: getString("field-tldr") || "撷论",
        value: getString("field-tldr") || "撷论",
      } as any,
      position: "end",
      multiline: true,
      nowrap: false,
      editable: true,
      onGetData({ item }) {
        if (!addon?.data?.alive || !item)
          return "";
        if (typeof item.isRegularItem === "function" && !item.isRegularItem())
          return "";
        return extractTLDRFromItem(item) || "";
      },
      onSetData({ item, value }) {
        if (!addon?.data?.alive || !item)
          return;
        void saveTLDRToItem(item, value)
          .then((saved) => {
            if (saved && item.id)
              void refreshJournalPane([item.id]);
          })
          .catch(err => logger.error("Failed to save edited TLDR:", err));
      },
      onItemChange({ item, setEnabled, setEditable }) {
        try {
          if (typeof setEnabled !== "function")
            return;
          if (!addon?.data?.alive || !item) {
            setEnabled(false);
            if (typeof setEditable === "function")
              setEditable(false);
            return;
          }
          const isRegular = typeof item.isRegularItem === "function" ? item.isRegularItem() : true;
          const isEditable = isRegular && (typeof item.isEditable === "function" ? item.isEditable() : true);
          const isTLDREnabled = getPref("workflow.tldrEnabled" as any, true);
          const showPref = isTLDREnabled && getPref("workflow.tldrShowInInfoPane" as any, true);
          const hasTLDR = Boolean(extractTLDRFromItem(item));
          const enabled = Boolean(isRegular && (showPref || hasTLDR));
          setEnabled(enabled);
          if (typeof setEditable === "function") {
            setEditable(Boolean(isEditable));
          }

          // 自动清洗历史条目 Extra 字段中残留的 TLDR，根治「两个都填充了」：
          // 若当前启用了「撷论」常驻行，且条目 Extra 字段仍残留有历史 TLDR 文本，
          // 自动将论点沉淀至专属子笔记，并从 Extra 字段彻底移除保存（仅当 target 偏好为 note 或 abstract 时），
          // 使「其他」字段恢复纯净（不再填充 TLDR），仅在专属的「撷论」行展示！
          // 注意：此处仅处理 TLDR/撷论 格式，绝不触碰用户的个人简记 (remark/简记)！
          if (isTLDREnabled && item && typeof item.getField === "function") {
            const target = getPref("workflow.tldrTarget" as any, "note");
            if (target === "note" || target === "abstract") {
              const currentExtra = String(item.getField("extra") || "");
              const fromExtra = extractTLDRFromExtra(currentExtra);
              const canEdit = typeof item.isEditable === "function" ? item.isEditable() : true;
              const itemID = typeof item.id === "number" ? item.id : 0;
              if (fromExtra && canEdit && (!itemID || !migratingItemIDs.has(itemID))) {
                if (itemID)
                  migratingItemIDs.add(itemID);
                void (async () => {
                  try {
                    const noteSaved = await saveTLDRToNote(item, fromExtra);
                    const cleansed = cleanseTLDRFromExtra(item);
                    if ((noteSaved || cleansed) && typeof item.saveTx === "function") {
                      await item.saveTx();
                      if (typeof Zotero !== "undefined" && Zotero.ItemPaneManager?.refreshInfoRow) {
                        Zotero.ItemPaneManager.refreshInfoRow("tldr");
                      }
                    }
                  }
                  catch (err) {
                    logger.error("Failed to auto-cleanse TLDR from extra:", err);
                  }
                  finally {
                    if (itemID)
                      migratingItemIDs.delete(itemID);
                  }
                })();
              }
            }
          }

          placeTLDRBeforeExtra();
          if (typeof setTimeout === "function") {
            setTimeout(placeTLDRBeforeExtra, 0);
            setTimeout(placeTLDRBeforeExtra, 50);
            setTimeout(placeTLDRBeforeExtra, 200);
          }
        }
        catch (err) {
          logger.error("Error in onItemChange for TLDR info row:", err);
        }
      },
    });

    if (prefObserverIDs.length === 0 && typeof Zotero.Prefs?.registerObserver === "function") {
      for (const pref of ["workflow.tldrShowInInfoPane", "workflow.tldrEnabled"]) {
        const id = Zotero.Prefs.registerObserver(
          `${addon.data.config.prefsPrefix}.${pref}`,
          () => {
            refreshTLDRInfoRow();
          },
          true,
        );
        if (id)
          prefObserverIDs.push(id);
      }
    }

    refreshTLDRInfoRow();
  }
  catch (error) {
    logger.error("Failed to register item info row:", error);
  }
}

function getAllItemDocuments(doc?: Document): Document[] {
  if (doc)
    return [doc];
  if (typeof Zotero === "undefined")
    return [];

  const docs = new Set<Document>();
  if (typeof Zotero.getMainWindows === "function") {
    for (const win of Zotero.getMainWindows()) {
      if (win?.document)
        docs.add(win.document);
    }
  }

  if (typeof Services !== "undefined" && Services.wm?.getEnumerator) {
    try {
      const enumerator = Services.wm.getEnumerator("");
      while (enumerator.hasMoreElements()) {
        const win = enumerator.getNext() as any;
        if (win?.document && !docs.has(win.document)) {
          if (win.document.querySelector?.("info-box, #info-table, .item-box")) {
            docs.add(win.document);
          }
        }
      }
    }
    catch {
      // Ignore if Services is not available
    }
  }

  return [...docs];
}

function findExtraRow(infoTable: HTMLElement | Element): HTMLElement | null {
  const candidates = [
    ".meta-row[data-fieldname='extra']",
    ".meta-row-extra",
    ".meta-label-extra",
    ".meta-label[fieldname='extra']",
    "[fieldname='extra']",
    "[data-fieldname='extra']",
    "#itembox-field-value-extra",
    "#itembox-field-extra-label",
    "[data-l10n-id*='extra']",
  ];
  for (const selector of candidates) {
    const elem = infoTable.querySelector?.(selector) as HTMLElement | null;
    if (elem) {
      if (elem.parentElement === infoTable)
        return elem;
      const row = (elem.closest?.(".meta-row") || elem.parentElement) as HTMLElement | null;
      if (row && (row.parentElement === infoTable || !row.parentElement))
        return row;
      return elem;
    }
  }

  if (infoTable.children) {
    for (const child of Array.from(infoTable.children) as HTMLElement[]) {
      if (child.classList?.contains("meta-row-tldr") || child.getAttribute?.("data-fieldname") === "tldr" || child.getAttribute?.("data-custom-row-id") === "tldr")
        continue;
      if (child.querySelector?.(".meta-label-extra, [fieldname='extra'], [data-fieldname='extra'], #itembox-field-value-extra, [data-l10n-id*='extra']"))
        return child;
      const label = child.querySelector?.(".meta-label, label, .label");
      const labelText = (label?.textContent || "").trim();
      if (labelText === "其他" || labelText.toLowerCase() === "extra")
        return child;
    }
  }
  return null;
}

function getExtraFieldValue(extraRow: HTMLElement, infoTable: HTMLElement | Element): {
  extraText: string;
  valElem: any;
  inputElem: HTMLTextAreaElement | HTMLInputElement | null;
} {
  const valElem = (extraRow.querySelector(".meta-data > .value, .value, editable-text, [fieldname='extra'].value")
    || extraRow.querySelector(".meta-data")
    || extraRow) as any;
  const inputElem = extraRow.querySelector("textarea, input") as HTMLTextAreaElement | HTMLInputElement | null;
  let extraText = "";

  // 1. 优先从 info-box 宿主元素绑定的 Zotero Item 实体直接读取权威 Extra 字段
  try {
    const infoBox = infoTable.closest("info-box") as any;
    const item = infoBox?.item
      || (typeof Zotero !== "undefined" && Zotero.getActiveZoteroPane?.()?.getSelectedItems?.()?.[0])
      || (typeof Zotero !== "undefined" && (Zotero as any).Pane?.item);
    if (item && typeof item.getField === "function") {
      const fieldVal = item.getField("extra");
      if (typeof fieldVal === "string" && fieldVal.trim()) {
        extraText = fieldVal.trim();
      }
    }
  }
  catch {
    // ignore
  }

  // 2. 从 editable-text 组件的 value 属性或 DOM attribute 读取
  if (!extraText && valElem) {
    if (typeof valElem.value === "string" && valElem.value.trim()) {
      extraText = valElem.value.trim();
    }
    else {
      const attrVal = valElem.getAttribute?.("value");
      if (attrVal && attrVal.trim()) {
        extraText = attrVal.trim();
      }
    }
  }

  // 3. 从 textarea / input 原生表单元素的 value 读取
  if (!extraText && inputElem && typeof inputElem.value === "string" && inputElem.value.trim()) {
    extraText = inputElem.value.trim();
  }

  // 4. 回退至 DOM textContent（去除开头的行标签“其他”或“Extra”）
  if (!extraText && valElem?.textContent?.trim()) {
    extraText = valElem.textContent.trim();
  }
  if (!extraText && extraRow.textContent?.trim()) {
    const raw = extraRow.textContent.trim();
    extraText = raw.replace(/^(?:其他|Extra)[:：\s]*/i, "").trim();
  }

  return { extraText, valElem, inputElem };
}

export function placeTLDRBeforeExtra(doc?: Document) {
  if (typeof Zotero === "undefined" || isPlacingTLDR)
    return;

  isPlacingTLDR = true;
  try {
    const docs = getAllItemDocuments(doc);

    for (const d of docs) {
      try {
        const tables = d.querySelectorAll<HTMLElement>("#info-table");
        for (const table of Array.from<HTMLElement>(tables)) {
          if (!observedTables.has(table) && typeof MutationObserver !== "undefined") {
            try {
              const observer = new MutationObserver(() => {
                placeTLDRBeforeExtra(d);
              });
              observer.observe(table, { childList: true, subtree: true });
              activeObservers.add(observer);
              observedTables.add(table);
            }
            catch (err) {
              logger.error("Failed to observe infoTable mutations:", err);
            }
          }
        }

        const tldrRows = d.querySelectorAll<HTMLElement>(".meta-row[data-custom-row-id=\"tldr\"]");
        for (const tldrRow of Array.from<HTMLElement>(tldrRows)) {
          const infoTable = tldrRow.parentElement;
          if (!infoTable)
            continue;

          if (!observedTables.has(infoTable) && typeof MutationObserver !== "undefined") {
            try {
              const observer = new MutationObserver(() => {
                placeTLDRBeforeExtra(d);
              });
              observer.observe(infoTable, { childList: true, subtree: true });
              activeObservers.add(observer);
              observedTables.add(infoTable);
            }
            catch (err) {
              logger.error("Failed to observe infoTable mutations:", err);
            }
          }

          const labelElem = tldrRow.querySelector?.(".meta-label");
          if (labelElem && labelElem.classList) {
            if (!labelElem.classList.contains("meta-label-tldr"))
              labelElem.classList.add("meta-label-tldr");
            if (typeof labelElem.hasAttribute === "function" && !labelElem.hasAttribute("fieldname"))
              labelElem.setAttribute("fieldname", "tldr");
            if (typeof labelElem.setAttribute === "function" && !labelElem.hasAttribute("data-fieldname"))
              labelElem.setAttribute("data-fieldname", "tldr");
          }
          if (tldrRow.classList && !tldrRow.classList.contains("meta-row-tldr")) {
            tldrRow.classList.add("meta-row-tldr");
          }
          if (typeof tldrRow.setAttribute === "function" && !tldrRow.hasAttribute("data-fieldname")) {
            tldrRow.setAttribute("data-fieldname", "tldr");
          }

          const valueElem = tldrRow.querySelector?.(".meta-data > .value");
          if (valueElem && valueElem.classList) {
            if (!valueElem.classList.contains("meta-value-tldr"))
              valueElem.classList.add("meta-value-tldr");
            if (typeof valueElem.setAttribute === "function" && !valueElem.hasAttribute("data-fieldname"))
              valueElem.setAttribute("data-fieldname", "tldr");
          }

          const extraRow = findExtraRow(infoTable);

          const dateAddedRow = (infoTable.querySelector(".meta-row[data-fieldname='dateAdded']") as HTMLElement | null)
            || (infoTable.querySelector(".meta-row-dateAdded") as HTMLElement | null)
            || (infoTable.querySelector("[fieldname='dateAdded']")?.closest?.(".meta-row") as HTMLElement | null)
            || (infoTable.querySelector(".meta-label-dateAdded")?.closest?.(".meta-row") as HTMLElement | null)
            || (infoTable.querySelector(".meta-label-dateAdded")?.parentElement as HTMLElement | null)
            || null;

          const anchorRow = extraRow || dateAddedRow;

          if (anchorRow && anchorRow.parentElement === infoTable) {
            if (tldrRow.nextElementSibling !== anchorRow) {
              infoTable.insertBefore(tldrRow, anchorRow);
            }
          }

          // 彻底消除“其他”与“撷论”两行重复：当常驻「撷论」行显示时，检查原生「其他」行
          const isTLDRVisible = Boolean(
            tldrRow
            && tldrRow.style.display !== "none"
            && !tldrRow.hidden
            && (tldrRow as any).style?.visibility !== "hidden",
          );

          if (extraRow && extraRow.style) {
            if (isTLDRVisible) {
              const { extraText, valElem: extraValElem, inputElem: extraInputElem } = getExtraFieldValue(extraRow, infoTable);
              const isTLDRLine = (line: string) => /(?:^|[:：\s])(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(line.trim()) || /^(?:其他|Extra)?[:：\s]*(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(line.trim());
              const hasTLDR = /(?:💡\s*)?(?:TL;?DR|撷论)\s*[:：]/i.test(extraText);

              if (hasTLDR) {
                const lines = extraText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                const nonTLDRLines = lines.filter(l => !isTLDRLine(l));
                if (nonTLDRLines.length === 0) {
                  // Extra 仅包含 TLDR，且信息面板已有独立「撷论」行，隐藏原生「其他」行，彻底消除重复显示
                  // 若包含用户的简记 (remark:) 或其他元数据，绝不隐藏！
                  if (!extraRow.hidden || extraRow.style.display !== "none") {
                    extraRow.hidden = true;
                    extraRow.style.setProperty("display", "none", "important");
                  }
                }
                else {
                  // Extra 还包含其他元数据（如 Citation Key 等），保留「其他」行，但在 DOM 视图中过滤掉 TLDR，避免重复显示
                  if (extraRow.hidden || extraRow.style.display === "none") {
                    extraRow.hidden = false;
                    extraRow.style.display = "";
                  }
                  const filteredText = nonTLDRLines.join("\n");
                  if (extraValElem) {
                    if ("value" in extraValElem && extraValElem.value !== filteredText)
                      extraValElem.value = filteredText;
                    if (extraValElem.getAttribute?.("value") !== filteredText)
                      extraValElem.setAttribute?.("value", filteredText);
                    if (typeof extraValElem.render === "function") {
                      try {
                        extraValElem.render();
                      }
                      catch {
                        // ignore
                      }
                    }
                  }
                  if (extraInputElem && extraInputElem.value !== filteredText) {
                    extraInputElem.value = filteredText;
                  }
                }
              }
              else if (extraRow.hidden || extraRow.style.display === "none") {
                extraRow.hidden = false;
                extraRow.style.display = "";
              }
            }
            else if (extraRow.hidden || extraRow.style.display === "none") {
              // 当「撷论」行不可见时，确保原生 Extra 行恢复显示
              extraRow.hidden = false;
              extraRow.style.display = "";
            }
          }
        }
      }
      catch (err) {
        logger.error("Failed to position TLDR before extra row:", err);
      }
    }
  }
  finally {
    isPlacingTLDR = false;
  }
}

export function refreshTLDRInfoRow(rowID = "tldr") {
  try {
    if (typeof Zotero !== "undefined" && typeof Zotero.ItemPaneManager?.refreshInfoRow === "function") {
      Zotero.ItemPaneManager.refreshInfoRow(rowID);
    }
    placeTLDRBeforeExtra();
    if (typeof setTimeout === "function") {
      setTimeout(placeTLDRBeforeExtra, 0);
      setTimeout(placeTLDRBeforeExtra, 50);
      setTimeout(placeTLDRBeforeExtra, 200);
    }
  }
  catch (error) {
    logger.error("Failed to refresh info row:", error);
  }
}

export function unregisterInfoRows() {
  const id = registeredRowID;
  registeredRowID = undefined;
  cleanupResourcesSync([
    () => {
      for (const obs of activeObservers) {
        try {
          obs.disconnect();
        }
        catch {
          // ignore
        }
      }
      activeObservers.clear();
    },
    () => {
      if (typeof Zotero.Prefs?.unregisterObserver === "function") {
        while (prefObserverIDs.length) {
          const obsId = prefObserverIDs.pop();
          if (obsId)
            Zotero.Prefs.unregisterObserver(obsId);
        }
      }
    },
    () => {
      if (id && typeof Zotero !== "undefined") {
        if (typeof Zotero.ItemPaneManager?.unregisterInfoRow === "function") {
          Zotero.ItemPaneManager.unregisterInfoRow(id);
        }
        else if (typeof Zotero.ItemPaneManager?.unregisterSection === "function") {
          Zotero.ItemPaneManager.unregisterSection(id);
        }
      }
    },
  ], error => logger.error("Item info row cleanup failed:", error));
}
