export function getAllItemDocuments(doc?: Document): Document[] {
  if (doc)
    return [doc];
  if (typeof Zotero === "undefined")
    return [];

  const docs = new Set<Document>();
  if (typeof Zotero.getMainWindows === "function") {
    for (const win of Zotero.getMainWindows()) {
      if (win?.document && !win.closed)
        docs.add(win.document);
    }
  }

  if (typeof Services !== "undefined" && Services.wm?.getEnumerator) {
    try {
      const enumerator = Services.wm.getEnumerator("");
      while (enumerator.hasMoreElements()) {
        const win = enumerator.getNext() as any;
        if (win?.document && !win.closed && !docs.has(win.document)) {
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

export function findExtraRow(infoTable: HTMLElement | Element): HTMLElement | null {
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

export function getExtraFieldValue(extraRow: HTMLElement, infoTable: HTMLElement | Element): {
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
