import { getString } from "../utils/locale";
import { preferenceListeners } from "../utils/preference-listeners";
import { getPref, setPref } from "../utils/prefs";
import { Rules } from "./rules";

export function workflowGroup(id: string) {
  id = id.toLowerCase();
  if (/attachment/.test(id))
    return "attachments";
  if (/creators/.test(id))
    return "creators";
  if (/title/.test(id) && !/publication/.test(id))
    return "title";
  if (/doi/.test(id))
    return "identifiers";
  if (/pages|volume|issue/.test(id))
    return "pagination";
  if (/journal|publication|conference/.test(id))
    return "publication";
  return "other";
}

export function setupWorkflowSettings(pane: Element) {
  const doc = pane.ownerDocument!;
  const listen = preferenceListeners(pane);
  const host = pane.querySelector("#metaref-core-workflows")!;
  const additional = host.querySelector("#metaref-additional-menu-options");
  const moveMenuControl = (id: string, target: Element) => {
    const row = pane.querySelector(`[data-core-menu-command='${id}']`)!;
    target.insertBefore(row, target.children[2] || null);
  };
  const makeCard = (id: string, heading: string, description: string, collapsed = false) => {
    const section = doc.createElementNS("http://www.w3.org/1999/xhtml", "section");
    section.id = id;
    section.className = `metaref-setting-card metaref-static-card metaref-collapsible-card${collapsed ? " is-collapsed" : ""}`;
    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "header");
    title.className = "metaref-card-heading";
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-expanded", String(!collapsed));
    doc.l10n!.setAttributes(title, heading);

    const toggle = () => {
      const isNowCollapsed = section.classList.toggle("is-collapsed");
      title.setAttribute("aria-expanded", String(!isNowCollapsed));
    };
    listen(title, "click", toggle);
    listen(title, "keydown", (e: Event) => {
      const key = (e as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    const note = doc.createElementNS("http://www.w3.org/1999/xhtml", "p");
    doc.l10n!.setAttributes(note, description);
    section.append(title, note);
    host.insertBefore(section, additional);
    return section;
  };
  const makeChoice = (id: string, target: Element) => {
    const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "label");
    label.className = "metaref-check-option metaref-workflow-module";
    const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input") as HTMLInputElement;
    input.type = "checkbox";
    input.id = `metaref-workflow-${id}`;
    const caption = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    caption.id = `${input.id}-label`;
    input.setAttribute("aria-labelledby", caption.id);
    doc.l10n!.setAttributes(caption, `metaref-workflow-${id}`);
    label.append(input, caption);
    target.append(label);
    return input;
  };
  const choice = (id: string, pref: string, fallback: boolean, target: Element) => {
    const input = makeChoice(id, target);
    input.setAttribute("preference", `${addon.data.config.prefsPrefix}.${pref}`);
    input.setAttribute("aria-label", getString(`workflow-${id}` as any));
    input.checked = getPref(pref as any, fallback) === true;
    listen(input, "change", () => setPref(pref as any, input.checked));
    return input;
  };
  const moveChoice = (pref: string, target: Element) => {
    const input = pane.querySelector(`[preference='${addon.data.config.prefsPrefix}.${pref}']`);
    if (!input)
      return;
    const control = input.closest(".metaref-check-option") || input;
    const description = control.nextElementSibling;
    target.append(control);
    if (description?.localName === "description")
      target.append(description);
  };
  const moveElement = (selector: string, target: Element) => {
    const el = pane.querySelector(selector);
    if (!el)
      return;
    target.append(el);
    const description = el.nextElementSibling;
    if (description?.localName === "description")
      target.append(description);
  };

  // 1. 高等级选项 A：【检查并修复元数据】（100% 纯本地离线执行，零网络通信）
  const card = makeCard("metaref-workflow-settings", "metaref-workflow-heading", "metaref-workflow-description");
  moveMenuControl("standard", card);
  for (const group of ["title", "creators", "identifiers", "pagination", "publication", "attachments", "other"]) {
    const rules = Rules.getStandard().filter(rule => rule.id !== "correct-doi-long" && workflowGroup(rule.id) === group);
    const input = makeChoice(group, card);
    const update = () => {
      const enabled = rules.filter(rule => getPref(`rule.${rule.id}` as any) === true).length;
      input.checked = enabled === rules.length && rules.length > 0;
      input.indeterminate = enabled > 0 && enabled < rules.length;
    };
    listen(input, "change", () => {
      for (const rule of rules) {
        setPref(`rule.${rule.id}` as any, input.checked);
        const child = pane.querySelector<HTMLInputElement>(`input[preference='${addon.data.config.prefsPrefix}.rule.${rule.id}']`);
        if (child)
          child.checked = input.checked;
      }
      update();
      pane.dispatchEvent(new (doc.defaultView! as Window & typeof globalThis).Event("command", { bubbles: true }));
    });
    listen(pane, "change", update);
    listen(pane, "command", update);
    update();
  }
  choice("check-duplicates", "workflow.reviewDuplicatesOnCheck", false, card);

  // 2. 高等级选项 B：【更新元数据】（集中收敛在线学术增强与自动补全）
  const update = makeCard("metaref-update-workflow-settings", "metaref-workflow-update-heading", "metaref-workflow-update-description");
  moveMenuControl("tool-update-metadata", update);
  pane.querySelector("#metaref-primary-menu-controls")?.remove();

  // (1) 在线书目核验与自动补全
  const bibliographic = choice("update-bibliographic", "workflow.updateBibliographic", true, update);

  // (2) 元数据来源优先级策略（作为“在线核验并补全书目元数据”的子选项，整体缩进 24px 对齐父级文字；单选组与标题左边缘完全对齐）
  const priorityGroup = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  priorityGroup.id = "metaref-metadata-source-priority-container";
  priorityGroup.style.cssText = "margin-inline-start: 24px; margin-block: 4px 10px;";

  const priorityHeading = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  priorityHeading.id = "metaref-metadata-source-priority-label";
  priorityHeading.style.cssText = "font-weight: 600; font-size: 13px; margin-block-end: 4px; color: inherit;";
  priorityHeading.textContent = getString("metadata-source-priority") || "元数据来源优先级";
  doc.l10n!.setAttributes(priorityHeading, "metaref-metadata-source-priority");
  priorityGroup.append(priorityHeading);

  const priorityOptions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
  priorityOptions.setAttribute("role", "radiogroup");
  priorityOptions.setAttribute("aria-labelledby", priorityHeading.id);
  priorityOptions.style.cssText = "display: flex; flex-direction: column; gap: 2px; margin-inline: 0;";

  const makeRadio = (value: string, l10nId: string, fallbackText: string) => {
    const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "label");
    label.className = "metaref-check-option metaref-radio-option";
    const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input") as HTMLInputElement;
    input.type = "radio";
    input.name = "metaref-metadata-source-priority-choice";
    input.value = value;
    input.id = `metaref-source-priority-${value}`;
    label.setAttribute("for", input.id);
    const caption = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    caption.id = `${input.id}-label`;
    caption.textContent = getString(l10nId.replace(/^metaref-/, "") as any) || fallbackText;
    input.setAttribute("aria-labelledby", caption.id);
    doc.l10n!.setAttributes(caption, l10nId);
    label.append(input, caption);
    priorityOptions.append(label);
    return { input, label };
  };

  const { input: radioLocal, label: labelLocal } = makeRadio("blank", "metaref-metadata-source-local", "优先本地数据（保留已有字段，补齐空白）");
  const { input: radioCloud, label: labelCloud } = makeRadio("all", "metaref-metadata-source-cloud", "优先云端数据（核验通过后更新差异字段）");

  priorityGroup.append(priorityOptions);

  const syncRadioUI = () => {
    const xulGroup = pane.querySelector("#metaref-metadata-source-priority") as any;
    const prefMode = getPref("rule.tool-update-metadata.option.mode");
    const currentMode = prefMode === "all" || (prefMode === undefined && xulGroup?.value === "all") ? "all" : "blank";
    radioCloud.checked = currentMode === "all";
    radioLocal.checked = currentMode === "blank";
    if (xulGroup && xulGroup.value !== currentMode)
      xulGroup.value = currentMode;
  };
  syncRadioUI();

  const handlePriorityChange = (mode: "all" | "blank") => {
    setPref("rule.tool-update-metadata.option.mode" as any, mode);
    syncRadioUI();
    const xulGroup = pane.querySelector("#metaref-metadata-source-priority") as any;
    if (xulGroup) {
      xulGroup.value = mode;
      xulGroup.dispatchEvent(new (doc.defaultView! as Window & typeof globalThis).Event("change", { bubbles: true }));
      xulGroup.dispatchEvent(new (doc.defaultView! as Window & typeof globalThis).Event("command", { bubbles: true }));
    }
  };

  listen(radioLocal, "change", () => {
    if (radioLocal.checked && !radioLocal.disabled)
      handlePriorityChange("blank");
  });
  listen(radioLocal, "click", () => {
    if (!radioLocal.disabled)
      handlePriorityChange("blank");
  });
  listen(labelLocal, "click", (e: Event) => {
    if (radioLocal.disabled)
      return;
    if (e.target !== radioLocal) {
      radioLocal.checked = true;
      handlePriorityChange("blank");
    }
  });

  listen(radioCloud, "change", () => {
    if (radioCloud.checked && !radioCloud.disabled)
      handlePriorityChange("all");
  });
  listen(radioCloud, "click", () => {
    if (!radioCloud.disabled)
      handlePriorityChange("all");
  });
  listen(labelCloud, "click", (e: Event) => {
    if (radioCloud.disabled)
      return;
    if (e.target !== radioCloud) {
      radioCloud.checked = true;
      handlePriorityChange("all");
    }
  });

  listen(pane, "change", syncRadioUI);
  listen(pane, "command", syncRadioUI);

  update.append(priorityGroup);

  // (3) 重点归纳项 1：按核验后的文献来源修复作者名单
  moveChoice("metadata.repairCreators", update);

  // (4) arXiv 预印本在线转正
  const versions = choice("update-versions", "workflow.updateVersions", false, update);

  // (5) 重点归纳项 2：网页快照与残缺条目学术复活
  moveChoice("workflow.reviveSnapshots", update);

  // (6) 重点归纳项 3：自动提炼并回填 Semantic Scholar TL;DR 核心论点摘要（撷论）及其子设置
  moveChoice("workflow.tldrEnabled", update);
  moveElement("#metaref-tldr-options", update);

  const tldrTargetSelect = pane.querySelector<HTMLSelectElement>("#metaref-tldr-target-select");
  if (tldrTargetSelect) {
    tldrTargetSelect.value = String(getPref("workflow.tldrTarget" as any, "note"));
    listen(tldrTargetSelect, "change", () => {
      setPref("workflow.tldrTarget" as any, tldrTargetSelect.value);
    });
  }

  const tldrCheckbox = pane.querySelector<HTMLInputElement>("#metaref-metadata-update-tldr-info-pane");
  const tldrOptions = pane.querySelector<HTMLElement>("#metaref-tldr-options");
  const getTldrEnabled = () => {
    const input = pane.querySelector<HTMLInputElement>(`input[preference='${addon.data.config.prefsPrefix}.workflow.tldrEnabled']`) || pane.querySelector<HTMLInputElement>("#metaref-metadata-update-tldr");
    return input ? input.checked : getPref("workflow.tldrEnabled" as any, true);
  };
  const updateTldrDependencies = () => {
    const isEnabled = getTldrEnabled();
    if (tldrCheckbox)
      tldrCheckbox.disabled = !isEnabled;
    if (tldrTargetSelect)
      tldrTargetSelect.disabled = !isEnabled;
    if (tldrOptions)
      tldrOptions.style.opacity = isEnabled ? "1" : "0.55";
  };

  // (7) EasyScholar 权威期刊指标在线更新
  moveChoice("metadata.updateJournalInfo", update);

  // (8) 更新后格式整理与查重
  choice("update-format", "workflow.formatAfterUpdate", true, update);
  choice("update-duplicates", "workflow.reviewDuplicatesOnUpdate", false, update);

  // (9) Semantic Scholar API Key 凭证输入
  moveElement("#metaref-metadata-provider-options", update);

  // 3. 在线搜索与候选补全（无 DOI 回退策略）
  const search = makeCard("metaref-search-workflow-settings", "metaref-workflow-search-heading", "metaref-workflow-search-description");
  const pdf = choice("scan-pdf", "workflow.scanPDF", false, search);
  const title = choice("search-title", "workflow.searchTitle", false, search);

  const updateDependencies = () => {
    versions.disabled = !bibliographic.checked;
    pdf.disabled = title.disabled = !bibliographic.checked;
    radioLocal.disabled = radioCloud.disabled = !bibliographic.checked;
    priorityGroup.style.opacity = bibliographic.checked ? "1" : "0.55";
    updateTldrDependencies();
  };
  listen(pane, "change", updateDependencies);
  listen(pane, "command", updateDependencies);
  updateDependencies();
}
