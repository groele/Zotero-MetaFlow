export const ACTIONS_PANE_ID = "metaref-actions";
const STYLE_ID = "metaref-actions-pane-styles";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

export type ActionIconKind = "check" | "update";

const HEX_BADGE_PATH = "M16.2 2.4C17.3 1.75 18.7 1.75 19.8 2.4L30.2 8.4C31.3 9.05 32 10.25 32 11.55V24.45C32 25.75 31.3 26.95 30.2 27.6L19.8 33.6C18.7 34.25 17.3 34.25 16.2 33.6L5.8 27.6C4.7 26.95 4 25.75 4 24.45V11.55C4 10.25 4.7 9.05 5.8 8.4Z";

const ACTION_ICON_SHAPES: Record<ActionIconKind, ReadonlyArray<readonly ["rect" | "path", Record<string, string>]>> = {
  // Soft-tinted hexagon + offline padlock with check: highlights zero-network local rule repair.
  check: [
    ["path", { "d": HEX_BADGE_PATH, "fill": "#6366F1", "fill-opacity": "0.11", "stroke": "#6366F1", "stroke-opacity": "0.3", "stroke-width": "1.4" }],
    ["rect", { "x": "12.5", "y": "16.5", "width": "11", "height": "8", "rx": "2", "fill": "#6366F1", "fill-opacity": "0.14", "stroke": "#6366F1", "stroke-width": "1.6" }],
    ["path", { "d": "M15 16.5V14.4A3 3 0 0 1 21 14.4V16.5", "stroke": "#6366F1", "stroke-width": "1.6", "stroke-linecap": "round" }],
    ["path", { "d": "M15.8 20.5L17.3 22L20.4 18.9", "stroke": "#6366F1", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" }],
  ],
  // Soft-tinted hexagon + bidirectional pull/push arrows: highlights online verification & enrichment.
  update: [
    ["path", { "d": HEX_BADGE_PATH, "fill": "#0EA5E9", "fill-opacity": "0.11", "stroke": "#0EA5E9", "stroke-opacity": "0.3", "stroke-width": "1.4" }],
    ["path", { "d": "M14.8 12.2V22.5M14.8 22.5L12.4 20.1M14.8 22.5L17.2 20.1", "stroke": "#06B6D4", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { "d": "M21.2 23.8V13.5M21.2 13.5L18.8 15.9M21.2 13.5L23.6 15.9", "stroke": "#3B82F6", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" }],
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
    "viewBox": "0 0 36 36",
    "width": "26",
    "height": "26",
    "fill": "none",
    "class": "metaref-action-icon",
    "aria-hidden": "true",
  });
  for (const [tag, attrs] of ACTION_ICON_SHAPES[kind])
    svg.append(createSvgNode(doc, tag, attrs));
  return svg;
}

export function createActionChevronSvg(doc: Document): SVGElement {
  const svg = createSvgNode(doc, "svg", {
    "viewBox": "0 0 16 16",
    "width": "14",
    "height": "14",
    "fill": "none",
    "class": "metaref-action-chevron",
    "aria-hidden": "true",
  });
  svg.append(createSvgNode(doc, "path", {
    "d": "M6 4L10 8L6 12",
    "stroke": "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }));
  return svg;
}

export function createActionTileButton(
  doc: Document,
  opts: { kind: ActionIconKind; label: string; mode: string; tooltip: string; disabled: boolean; busy: boolean; onRun: () => void },
): HTMLButtonElement {
  const btn = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  btn.type = "button";
  btn.className = "metaref-action-btn";
  btn.setAttribute("data-metaref-action", opts.kind);
  btn.setAttribute("title", opts.tooltip);
  btn.disabled = opts.disabled;
  if (opts.busy)
    btn.setAttribute("aria-busy", "true");
  const textWrap = doc.createElementNS(XHTML_NS, "span");
  textWrap.className = "metaref-action-text";
  const label = doc.createElementNS(XHTML_NS, "span");
  label.className = "metaref-action-label";
  label.textContent = opts.label;
  const hint = doc.createElementNS(XHTML_NS, "span");
  hint.className = "metaref-action-hint";
  hint.textContent = opts.mode;
  textWrap.append(label, hint);
  btn.append(createActionIconSvg(doc, opts.kind), textWrap);
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!btn.disabled)
      opts.onRun();
  });
  return btn;
}

export function createStatusCardButton(
  doc: Document,
  opts: { level: string; message: string; disabled: boolean; onRecheck: () => void },
): HTMLButtonElement {
  const card = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  card.type = "button";
  card.className = "metaref-actions-status-card";
  card.setAttribute("data-level", opts.level);
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.disabled = opts.disabled;
  const dot = doc.createElementNS(XHTML_NS, "span");
  dot.className = "metaref-status-dot";
  dot.setAttribute("aria-hidden", "true");
  const text = doc.createElementNS(XHTML_NS, "span");
  text.className = "metaref-status-text";
  text.setAttribute("data-actions-status", "true");
  text.textContent = opts.message;
  card.append(dot, text, createActionChevronSvg(doc));
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!card.disabled)
      opts.onRecheck();
  });
  return card;
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
      padding: 6px 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      color: var(--fill-primary);
    }
    .metaref-actions-pane-wrap * {
      box-sizing: border-box;
    }
    .metaref-actions-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      width: 100%;
      min-width: 0;
    }
    .metaref-actions-pane-wrap .metaref-action-btn {
      appearance: none;
      -moz-appearance: none;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-width: 0;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 8px 10px !important;
      border-radius: 8px !important;
      border: 1px solid color-mix(in srgb, var(--fill-primary, currentColor) 11%, transparent) !important;
      background: var(--material-background, #ffffff) !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03) !important;
      color: var(--fill-primary);
      text-align: left;
      cursor: pointer;
      font: inherit;
      transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .metaref-actions-pane-wrap .metaref-action-btn:hover:not(:disabled) {
      background: color-mix(in srgb, var(--material-background, #ffffff) 95%, var(--fill-primary, #000000) 5%) !important;
      border-color: rgba(99, 102, 241, 0.34) !important;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05) !important;
    }
    .metaref-actions-pane-wrap .metaref-action-btn[data-metaref-action="update"]:hover:not(:disabled) {
      border-color: rgba(14, 165, 233, 0.36) !important;
    }
    .metaref-actions-pane-wrap .metaref-action-btn:focus-visible,
    .metaref-actions-pane-wrap .metaref-actions-status-card:focus-visible {
      outline: 2px solid var(--accent-blue, #245ac7);
      outline-offset: 2px;
    }
    .metaref-actions-pane-wrap .metaref-action-btn:disabled,
    .metaref-actions-pane-wrap .metaref-actions-status-card:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    .metaref-action-icon {
      width: 26px;
      height: 26px;
      flex: 0 0 26px;
      display: block;
    }
    .metaref-action-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      flex: 1;
    }
    .metaref-action-label {
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metaref-action-hint {
      font-size: 11px;
      line-height: 1.3;
      color: var(--fill-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metaref-actions-pane-wrap .metaref-actions-status-card {
      appearance: none;
      -moz-appearance: none;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-width: 0;
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 7px 10px !important;
      border-radius: 8px !important;
      border: 1px solid color-mix(in srgb, var(--fill-primary, currentColor) 11%, transparent) !important;
      background: var(--material-background, #ffffff) !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03) !important;
      color: var(--fill-secondary);
      text-align: left;
      cursor: pointer;
      font: inherit;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .metaref-actions-pane-wrap .metaref-actions-status-card:hover:not(:disabled) {
      background: color-mix(in srgb, var(--material-background, #ffffff) 95%, var(--fill-primary, #000000) 5%) !important;
      border-color: color-mix(in srgb, var(--fill-primary, currentColor) 20%, transparent) !important;
    }
    .metaref-status-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      flex: 0 0 7px;
      background: color-mix(in srgb, var(--fill-secondary, currentColor) 55%, transparent);
    }
    .metaref-actions-status-card[data-level="running"] .metaref-status-dot {
      background: #0EA5E9;
    }
    .metaref-actions-status-card[data-level="success"] .metaref-status-dot,
    .metaref-actions-status-card[data-level="info"] .metaref-status-dot {
      background: #16A34A;
    }
    .metaref-actions-status-card[data-level="warning"] .metaref-status-dot {
      background: #D97706;
    }
    .metaref-actions-status-card[data-level="error"] .metaref-status-dot {
      background: #DC2626;
    }
    .metaref-status-text {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metaref-actions-status-card[data-level="warning"] .metaref-status-text,
    .metaref-actions-status-card[data-level="error"] .metaref-status-text {
      color: var(--accent-orange, #D97706);
    }
    .metaref-action-chevron {
      width: 13px;
      height: 13px;
      flex: 0 0 13px;
      display: block;
      color: var(--fill-secondary);
      opacity: 0.5;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .metaref-actions-pane-wrap .metaref-actions-status-card:hover:not(:disabled) .metaref-action-chevron {
      opacity: 0.95;
      transform: translateX(2px);
    }
  `;
  (doc.head || doc.documentElement)?.append(style);
}
