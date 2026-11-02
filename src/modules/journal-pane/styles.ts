export function ensureJournalPaneStyles(doc?: Document | null) {
  if (!doc)
    return;
  const styleID = "metaref-journal-pane-styles";
  if (doc.getElementById(styleID))
    return;
  const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = styleID;
  style.textContent = `
    item-pane-custom-section[data-pane*="metaref-journal-insights"],
    item-pane-custom-section[data-pane*="metaref-journal-insights"] > collapsible-section,
    item-pane-custom-section[data-pane*="metaref-journal-insights"] [data-type="body"],
    collapsible-section[data-pane*="metaref-journal-insights"],
    collapsible-section[data-pane*="metaref-journal-insights"] > [data-type="body"] {
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      padding: 0 !important;
      margin: 0 !important;
    }
    item-pane-custom-section[data-pane*="metaref-journal-insights"] collapsible-section:not([open]) [data-type="body"],
    collapsible-section[data-pane*="metaref-journal-insights"]:not([open]) [data-type="body"],
    collapsible-section:not([open]) > [data-type="body"]:has(> .metaref-journal-pane-wrap) {
      max-height: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
    }
    item-pane-custom-section[data-pane*="metaref-journal-insights"] .head .title-box .summary:empty,
    item-pane-custom-section[data-pane*="metaref-journal-insights"] collapsible-section > .head .title-box .summary:empty,
    item-pane-custom-section[data-pane*="metaref-journal-insights"] .summary:empty,
    collapsible-section[data-pane*="metaref-journal-insights"] .summary:empty {
      display: none !important;
    }
    item-pane-sidenav .btn[data-pane*="metaref-journal-insights"] {
      width: 28px !important;
      height: 28px !important;
      min-width: 28px !important;
      padding: 4px !important;
      box-sizing: border-box !important;
    }
    .metaref-journal-pane-wrap {
      padding: 10px 12px 12px;
      line-height: 1.5;
      overflow-wrap: anywhere;
      color: var(--fill-primary);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }
    .metaref-journal-pane-wrap * {
      box-sizing: border-box;
    }
    [data-journal-share]:hover { background:color-mix(in srgb,currentColor 8%,transparent)!important;color:var(--fill-primary)!important; }
    [data-journal-share][data-share-success] { color:var(--accent-green,#16803c)!important; }
    @media(prefers-color-scheme:dark) {
      [data-journal-share][data-share-success] { color:var(--accent-green,#6ee7b7)!important; }
    }
    [data-journal-share]:focus-visible { outline:2px solid var(--fill-primary);outline-offset:2px; }
    [data-journal-share]:disabled { cursor:progress;opacity:.7; }
    @media(prefers-reduced-motion:no-preference) {
      [data-journal-share] { transition:color 160ms ease,background-color 160ms ease,transform 160ms ease; }
      [data-journal-share]:active { transform:scale(.94); }
    }
  `;
  (doc.head || doc.documentElement)?.append(style);
}
