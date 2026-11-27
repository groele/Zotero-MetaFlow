import { setupHorizontalTabs } from "./settings-tabs";

/** Move functional modules before any renderer consumes their headings. */
export function organizeSettingsModules(pane: Element) {
  // These are independent tasks, not formatting rules.
  for (const heading of ["section-article-esi", "section-article-abbreviation", "insights-share-heading"]) {
    const group = [...pane.querySelectorAll("groupbox")].find(group => group.querySelector(`:scope > label [data-l10n-id$='${heading}']`));
    if (group && group.parentElement !== pane)
      pane.append(group);
  }
}

/** Keep one disclosure level while retaining the controls in their functional groups. */
export function setupFunctionCards(pane: Element) {
  const doc = pane.ownerDocument!;
  for (const detail of pane.querySelectorAll("details.metaref-pref-collapsible")) {
    const section = doc.createElementNS("http://www.w3.org/1999/xhtml", "section");
    for (const { name, value } of detail.attributes) {
      if (name !== "open")
        section.setAttribute(name, value);
    }
    section.classList.add("metaref-setting-card", "metaref-static-card");
    const summary = detail.querySelector(":scope > summary")!;
    const header = doc.createElementNS("http://www.w3.org/1999/xhtml", "header");
    for (const { name, value } of summary.attributes)
      header.setAttribute(name, value);
    header.classList.add("metaref-card-heading");
    header.append(...summary.childNodes);
    section.append(header, ...[...detail.children].filter(child => child !== summary));
    detail.replaceWith(section);
  }
  for (const group of [...pane.querySelectorAll<HTMLElement>("groupbox")].reverse()) {
    if (group.parentElement?.matches(".metaref-setting-card"))
      continue;
    const heading = group.querySelector(":scope > label");
    if (!heading)
      continue;
    const top = group.parentElement === pane;
    const card = doc.createElementNS("http://www.w3.org/1999/xhtml", top ? "details" : "section");
    card.className = `metaref-setting-card ${top ? "metaref-section-card" : "metaref-static-card"}`;
    const summary = doc.createElementNS("http://www.w3.org/1999/xhtml", top ? "summary" : "header");
    if (!top)
      summary.className = "metaref-card-heading";
    summary.append(heading);
    group.before(card);
    card.append(summary, group);
  }
  for (const detail of pane.querySelectorAll(".metaref-setting-card")) {
    detail.classList.add("metaref-setting-card");
    if (detail.querySelector(":scope > groupbox, :scope > .metaref-card-body"))
      continue;
    const body = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    body.className = "metaref-card-body";
    body.append(...[...detail.children].filter(child => child.localName !== "summary" && !child.classList.contains("metaref-card-heading")));
    detail.append(body);
  }
  for (const parent of pane.querySelectorAll("groupbox, .indented-pref")) {
    const runs: Element[][] = [];
    for (const child of [...parent.children]) {
      if (!child.matches(".metaref-check-option"))
        continue;
      const previous = child.previousElementSibling;
      if (previous && runs.at(-1)?.includes(previous))
        runs.at(-1)!.push(child);
      else
        runs.push([child]);
    }
    for (const run of runs.filter(run => run.length > 1)) {
      const grid = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      grid.className = "metaref-choice-grid";
      run[0].before(grid);
      grid.append(...run);
    }
  }
  const sections = [...pane.querySelectorAll(":scope > .metaref-section-card")];
  for (const id of ["section-general", "core-workflows-heading", "duplicates-heading", "section-article-esi", "insights-share-heading", "section-article-abbreviation", "section-rules", "data-settings-heading", "workflow-tool-center", "shortcuts-header", "section-rich-text", "section-about"]) {
    const section = sections.find(section => section.querySelector(`:scope > summary [data-l10n-id$='${id}']`));
    if (section)
      pane.append(section);
  }
  [...pane.querySelectorAll<HTMLDetailsElement>(":scope > .metaref-section-card")].forEach((card, index) => {
    card.open = index === 0;
  });
  setupHorizontalTabs(pane);
}
