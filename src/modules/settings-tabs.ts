import { version } from "../../package.json";
import { getString } from "../utils/locale";
import { preferenceListeners } from "../utils/preference-listeners";

const HTML_NS = "http://www.w3.org/1999/xhtml";

export type SettingsTabId = "overview" | "rules" | "journals" | "duplicates" | "tools" | "maintenance";

export interface SettingsTabSpec {
  id: SettingsTabId;
  l10nId: string;
  sectionHeadings: readonly string[];
}

export const SETTINGS_TABS: readonly SettingsTabSpec[] = [
  {
    id: "overview",
    l10nId: "metaref-settings-tab-overview",
    sectionHeadings: ["section-general", "core-workflows-heading"],
  },
  {
    id: "rules",
    l10nId: "metaref-settings-tab-rules",
    sectionHeadings: ["section-rules"],
  },
  {
    id: "journals",
    l10nId: "metaref-settings-tab-journals",
    sectionHeadings: ["section-article-esi", "section-article-abbreviation", "insights-share-heading"],
  },
  {
    id: "duplicates",
    l10nId: "metaref-settings-tab-duplicates",
    sectionHeadings: ["duplicates-heading"],
  },
  {
    id: "tools",
    l10nId: "metaref-settings-tab-tools",
    sectionHeadings: ["workflow-tool-center", "section-rich-text", "shortcuts-header"],
  },
  {
    id: "maintenance",
    l10nId: "metaref-settings-tab-maintenance",
    sectionHeadings: ["data-settings-heading", "section-about"],
  },
] as const;

const CIRCLED_NUMS = ["①", "②", "③", "④", "⑤"];

const QUICK_STEPS: ReadonlyArray<{ step: string; jump: SettingsTabId; l10nId: string }> = [
  { step: "1", jump: "rules", l10nId: "metaref-settings-step-rules" },
  { step: "2", jump: "journals", l10nId: "metaref-settings-step-journals" },
  { step: "3", jump: "duplicates", l10nId: "metaref-settings-step-duplicates" },
  { step: "4", jump: "tools", l10nId: "metaref-settings-step-tools" },
  { step: "5", jump: "maintenance", l10nId: "metaref-settings-step-maintenance" },
];

function localizeText(key: string): string {
  try {
    return getString(key as Parameters<typeof getString>[0]);
  }
  catch {
    return key;
  }
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const el = doc.createElementNS(HTML_NS, tag) as HTMLElementTagNameMap[K];
  if (attrs) {
    for (const [key, val] of Object.entries(attrs))
      el.setAttribute(key, val);
  }
  return el;
}

function resolveCardTabId(card: Element): SettingsTabId {
  for (const tab of SETTINGS_TABS) {
    if (tab.sectionHeadings.some(h => card.querySelector(`:scope > summary [data-l10n-id$='${h}']`)))
      return tab.id;
  }
  return "overview";
}

function buildHeader(doc: Document): HTMLElement {
  const header = createEl(doc, "header", { class: "metaref-header" });
  const titleRow = createEl(doc, "div", { class: "metaref-title-row" });
  const titleLeft = createEl(doc, "div", { class: "metaref-title-left" });

  const iconUrl = typeof rootURI === "string" && rootURI
    ? `${rootURI.replace(/\/?$/, "/")}content/icons/metaref-96.png`
    : "chrome://zoterometaflow/content/icons/metaref-96.png";
  const icon = createEl(doc, "img", {
    class: "metaref-brand-icon",
    src: iconUrl,
    width: "22",
    height: "22",
    alt: "",
  });

  const h1 = createEl(doc, "h1", { "data-l10n-id": "metaref-settings-header-title" });
  h1.textContent = localizeText("settings-header-title");

  const badge = createEl(doc, "span", {
    id: "metaref-version-badge",
    class: "metaref-version-badge",
  });
  badge.textContent = `v${version}`;

  titleLeft.append(icon, h1, badge);

  const statusPill = createEl(doc, "div", {
    "id": "metaref-prefs-status",
    "class": "metaref-status-pill",
    "role": "status",
    "aria-live": "polite",
    "data-l10n-id": "metaref-settings-status-autosave",
  });
  statusPill.textContent = localizeText("settings-status-autosave");

  titleRow.append(titleLeft, statusPill);

  const subtitle = createEl(doc, "p", {
    "class": "metaref-subtitle",
    "data-l10n-id": "metaref-settings-header-subtitle",
  });
  subtitle.textContent = localizeText("settings-header-subtitle");

  header.append(titleRow, subtitle);
  return header;
}

function buildTablist(doc: Document): HTMLElement {
  const nav = createEl(doc, "nav", {
    "class": "metaref-tabs",
    "role": "tablist",
    "aria-label": "Zotero MetaFlow Preferences",
  });
  for (const [index, tab] of SETTINGS_TABS.entries()) {
    const active = index === 0;
    const btn = createEl(doc, "button", {
      "type": "button",
      "id": `metaref-tab-${tab.id}`,
      "class": "metaref-tab-btn",
      "role": "tab",
      "aria-selected": active ? "true" : "false",
      "aria-controls": `metaref-panel-${tab.id}`,
      "tabindex": active ? "0" : "-1",
      "data-metaref-tab": tab.id,
      "data-l10n-id": tab.l10nId,
    });
    btn.textContent = localizeText(tab.l10nId.replace(/^metaref-/, ""));
    nav.append(btn);
  }
  return nav;
}

function buildOverviewBanner(doc: Document): HTMLElement {
  const banner = createEl(doc, "div", {
    "id": "metaref-overview-banner",
    "class": "metaref-banner",
    "data-metaref-tab-item": "overview",
  });
  const title = createEl(doc, "div", {
    "class": "metaref-banner-title",
    "data-l10n-id": "metaref-settings-banner-title",
  });
  title.textContent = localizeText("settings-banner-title");

  const desc = createEl(doc, "p", {
    "class": "metaref-banner-desc",
    "data-l10n-id": "metaref-settings-banner-desc",
  });
  desc.textContent = localizeText("settings-banner-desc");

  const steps = createEl(doc, "div", { class: "metaref-steps" });
  for (const [idx, item] of QUICK_STEPS.entries()) {
    const btn = createEl(doc, "button", {
      "type": "button",
      "class": "metaref-step",
      "data-metaref-jump": item.jump,
    });
    const num = createEl(doc, "span", { class: "metaref-step-num" });
    num.textContent = CIRCLED_NUMS[idx] || item.step;
    const label = createEl(doc, "span", { "data-l10n-id": item.l10nId });
    label.textContent = localizeText(item.l10nId.replace(/^metaref-/, ""));
    btn.append(num, label);
    steps.append(btn);
  }

  banner.append(title, desc, steps);
  return banner;
}

export function selectSettingsTab(
  pane: Element,
  tabId: string,
  options: { focusTab?: boolean; userInitiated?: boolean } = {},
) {
  const validTab = (SETTINGS_TABS.some(t => t.id === tabId) ? tabId : "overview") as SettingsTabId;
  pane.setAttribute("data-active-tab", validTab);

  const tabButtons = [...pane.querySelectorAll<HTMLButtonElement>("[data-metaref-tab]")];
  for (const btn of tabButtons) {
    const active = btn.getAttribute("data-metaref-tab") === validTab;
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.setAttribute("tabindex", active ? "0" : "-1");
    btn.classList.toggle("is-active", active);
    if (active && options.focusTab)
      btn.focus?.();
  }

  const banner = pane.querySelector<HTMLElement>("#metaref-overview-banner");
  if (banner) {
    if (validTab === "overview")
      banner.removeAttribute("data-tab-hidden");
    else
      banner.setAttribute("data-tab-hidden", "true");
  }

  const cards = [...pane.querySelectorAll<HTMLDetailsElement>(":scope > .metaref-section-card")];
  const visibleCards: HTMLDetailsElement[] = [];
  for (const card of cards) {
    const cardTab = card.getAttribute("data-metaref-tab-panel") || "overview";
    const visible = cardTab === validTab;
    if (visible) {
      card.removeAttribute("data-tab-hidden");
      visibleCards.push(card);
    }
    else {
      card.setAttribute("data-tab-hidden", "true");
    }
  }
  if (options.userInitiated && visibleCards.length > 0 && !visibleCards.some(c => c.open))
    visibleCards[0].open = true;
}

export function setupHorizontalTabs(pane: Element) {
  if (pane.querySelector(".metaref-tabs"))
    return;
  const doc = pane.ownerDocument!;
  const listen = preferenceListeners(pane);

  const header = buildHeader(doc);
  const tablist = buildTablist(doc);
  const banner = buildOverviewBanner(doc);

  const firstChild = pane.firstElementChild;
  if (firstChild)
    firstChild.before(header, tablist, banner);
  else
    pane.append(header, tablist, banner);

  const cards = [...pane.querySelectorAll<HTMLDetailsElement>(":scope > .metaref-section-card")];
  const seenTabPrimary = new Set<SettingsTabId>();
  for (const card of cards) {
    const tabId = resolveCardTabId(card);
    card.setAttribute("data-metaref-tab-panel", tabId);
    card.setAttribute("aria-labelledby", `metaref-tab-${tabId}`);
    if (!seenTabPrimary.has(tabId)) {
      seenTabPrimary.add(tabId);
      if (!card.id)
        card.id = `metaref-panel-${tabId}`;
    }
    listen(card, "toggle", () => {
      if (card.open && card.getAttribute("data-tab-hidden") === "true")
        selectSettingsTab(pane, tabId, { focusTab: false, userInitiated: false });
    });
  }

  const tabButtons = [...tablist.querySelectorAll<HTMLButtonElement>("[data-metaref-tab]")];
  for (const btn of tabButtons) {
    listen(btn, "click", () => {
      const targetTab = btn.getAttribute("data-metaref-tab") || "overview";
      selectSettingsTab(pane, targetTab, { focusTab: false, userInitiated: true });
    });
  }

  listen(tablist, "keydown", (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(keyEvent.key))
      return;
    const activeTab = pane.getAttribute("data-active-tab") || "overview";
    const currentIndex = Math.max(0, tabButtons.findIndex(b => b.getAttribute("data-metaref-tab") === activeTab));
    let nextIndex = currentIndex;
    if (keyEvent.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % tabButtons.length;
    else if (keyEvent.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    else if (keyEvent.key === "Home")
      nextIndex = 0;
    else if (keyEvent.key === "End")
      nextIndex = tabButtons.length - 1;

    keyEvent.preventDefault();
    const nextTab = tabButtons[nextIndex]?.getAttribute("data-metaref-tab") || "overview";
    selectSettingsTab(pane, nextTab, { focusTab: true, userInitiated: true });
  });

  for (const stepBtn of banner.querySelectorAll<HTMLButtonElement>("[data-metaref-jump]")) {
    listen(stepBtn, "click", () => {
      const jumpTarget = stepBtn.getAttribute("data-metaref-jump") || "overview";
      selectSettingsTab(pane, jumpTarget, { focusTab: true, userInitiated: true });
    });
  }

  const notifySaved = (event: Event) => {
    const target = event.target as Element | null;
    if (event.type !== "change" && target) {
      const tag = (target.localName || (target as any).tagName || "").toLowerCase();
      const hasPref = typeof target.hasAttribute === "function" ? target.hasAttribute("preference") : Boolean(target.getAttribute?.("preference"));
      if (!hasPref && !["input", "select", "textarea", "checkbox", "radio", "radiogroup", "menulist"].includes(tag))
        return;
    }
    const pill = pane.querySelector<HTMLElement>("#metaref-prefs-status");
    if (!pill)
      return;
    pill.setAttribute("data-l10n-id", "metaref-settings-status-saved");
    pill.textContent = localizeText("settings-status-saved");
  };
  listen(pane, "change", notifySaved);
  listen(pane, "command", notifySaved);

  selectSettingsTab(pane, "overview", { focusTab: false, userInitiated: false });
}
