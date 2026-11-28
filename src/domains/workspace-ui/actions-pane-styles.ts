export const ACTIONS_PANE_ID = "metaref-actions";
const STYLE_ID = "metaref-actions-pane-styles";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

export type ActionIconKind = "check" | "update";

const ACTION_ICON_SHAPES: Record<ActionIconKind, ReadonlyArray<readonly ["rect" | "path", Record<string, string>]>> = {
  // Offline padlock + check: highlights zero-network local rule repair.
  check: [
    ["rect", { "x": "4", "y": "8.5", "width": "12", "height": "8.5", "rx": "2.2", "fill": "#6366F1", "fill-opacity": "0.12", "stroke": "#6366F1", "stroke-width": "1.7" }],
    ["path", { "d": "M6.8 8.5V6.2A3.2 3.2 0 0 1 13.2 6.2V8.5", "stroke": "#6366F1", "stroke-width": "1.7", "stroke-linecap": "round" }],
    ["path", { "d": "M7.6 12.8L9.3 14.5L12.6 11.1", "stroke": "#6366F1", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }],
  ],
  // Bidirectional pull/push arrows: highlights online verification & field enrichment.
  update: [
    ["path", { "d": "M6.8 4.2V14.5M6.8 14.5L4.3 12M6.8 14.5L9.3 12", "stroke": "#06B6D4", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { "d": "M13.2 15.8V5.5M13.2 5.5L10.7 8M13.2 5.5L15.7 8", "stroke": "#3B82F6", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }],
  ],
};

function createSvgNode(doc: Document, tag: "svg" | "rect" | "path", attrs: Record<string, string>): SVGElement {
  const el = doc.createElementNS(SVG_NS, tag) as unknown as SVGElement;
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, value);
  return el;
}

export function createActionIconSvg(doc: Document, kind: ActionIconKind): SVGElement {
  const svg = createSvgNode(doc, "svg", {
    "viewBox": "0 0 20 20",
    "width": "18",
    "height": "18",
    "fill": "none",
    "class": "metaref-action-icon",
    "aria-hidden": "true",
  });
  for (const [tag, attrs] of ACTION_ICON_SHAPES[kind])
    svg.append(createSvgNode(doc, tag, attrs));
  return svg;
}

export function ensureActionsPaneStyles(doc?: Document | null) {
  if (!doc || doc.getElementById(STYLE_ID))
    return;
  const style = doc.createElementNS(XHTML_NS, "style");
  style.id = STYLE_ID;
  style.textContent = `
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"],
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"] > collapsible-section,
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"] [data-type="body"],
    collapsible-section[data-pane*="${ACTIONS_PANE_ID}"],
    collapsible-section[data-pane*="${ACTIONS_PANE_ID}"] > [data-type="body"] {
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      padding: 0 !important;
      margin: 0 !important;
    }
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"] collapsible-section:not([open]) [data-type="body"],
    collapsible-section[data-pane*="${ACTIONS_PANE_ID}"]:not([open]) [data-type="body"],
    collapsible-section:not([open]) > [data-type="body"]:has(> .metaref-actions-pane-wrap) {
      max-height: 0 !important;
      opacity: 0 !important;
      visibility: hidden !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
    }
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"] collapsible-section[open] > [data-type="body"],
    collapsible-section[data-pane*="${ACTIONS_PANE_ID}"][open] > [data-type="body"],
    collapsible-section[open] > [data-type="body"]:has(> .metaref-actions-pane-wrap) {
      display: block !important;
      max-height: none !important;
      height: auto !important;
      opacity: 1 !important;
      visibility: visible !important;
      overflow: visible !important;
    }
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"] .head .title-box .summary:empty,
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"] collapsible-section > .head .title-box .summary:empty,
    item-pane-custom-section[data-pane*="${ACTIONS_PANE_ID}"] .summary:empty,
    collapsible-section[data-pane*="${ACTIONS_PANE_ID}"] .summary:empty {
      display: none !important;
    }
    item-pane-sidenav .btn[data-pane*="${ACTIONS_PANE_ID}"] {
      width: 28px !important;
      height: 28px !important;
      min-width: 28px !important;
      padding: 4px !important;
      background-size: 20px 20px !important;
      background-position: center !important;
      background-repeat: no-repeat !important;
      overflow: hidden !important;
      font-size: 0 !important;
      line-height: 0 !important;
      color: transparent !important;
      white-space: nowrap !important;
      box-sizing: border-box !important;
    }
    .metaref-actions-pane-wrap {
      padding: 10px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      color: var(--fill-primary);
    }
    .metaref-actions-pane-wrap * {
      box-sizing: border-box;
    }
    .metaref-actions-pane-wrap .metaref-action-btn {
      appearance: none;
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-width: 0;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 9px 10px !important;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      background: color-mix(in srgb, currentColor 3%, transparent);
      color: var(--fill-primary);
      text-align: left;
      cursor: pointer;
      font: inherit;
    }
    .metaref-actions-pane-wrap .metaref-action-btn:hover:not(:disabled) {
      background: color-mix(in srgb, currentColor 7%, transparent);
      border-color: color-mix(in srgb, var(--accent-blue, #245ac7) 40%, transparent);
    }
    .metaref-actions-pane-wrap .metaref-action-btn:focus-visible {
      outline: 2px solid var(--accent-blue, #245ac7);
      outline-offset: 2px;
    }
    .metaref-actions-pane-wrap .metaref-action-btn:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    .metaref-action-icon {
      width: 18px;
      height: 18px;
      flex: 0 0 18px;
      display: block;
    }
    .metaref-action-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .metaref-action-label {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .metaref-action-hint {
      font-size: 11.5px;
      line-height: 1.4;
      color: var(--fill-secondary);
      overflow-wrap: anywhere;
    }
    .metaref-actions-status {
      font-size: 12px;
      line-height: 1.45;
      color: var(--fill-secondary);
      overflow-wrap: anywhere;
    }
    .metaref-actions-status:empty {
      display: none;
    }
    .metaref-actions-status[data-level="warning"],
    .metaref-actions-status[data-level="error"] {
      color: var(--accent-orange);
    }
  `;
  (doc.head || doc.documentElement)?.append(style);
}
