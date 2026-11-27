export const TOOLBAR_CLASS = "metaref-richtext-toolbar";
export const HEADER_TITLE_SELECTOR = "item-pane-header .title editable-text";
export const activeTitleEditors = new WeakMap<Window, HTMLTextAreaElement>();
export const savedTitleSelections = new WeakMap<Window, { editor: HTMLTextAreaElement; start: number; end: number; direction: "forward" | "backward" | "none" }>();
export const selectionCaptureAttached = new WeakSet<HTMLTextAreaElement>();

export function rememberTitleSelection(win: Window, editor: HTMLTextAreaElement) {
  savedTitleSelections.set(win, {
    editor,
    start: editor.selectionStart ?? 0,
    end: editor.selectionEnd ?? 0,
    direction: (editor.selectionDirection || "none") as "forward" | "backward" | "none",
  });
}

export function getTitleEditor(win: Window): HTMLTextAreaElement | null {
  const active = win.document.activeElement as HTMLElement | null;
  if (active?.localName === "textarea" && active.closest?.(HEADER_TITLE_SELECTOR))
    return active as HTMLTextAreaElement;
  const headerEditable = active?.closest?.(HEADER_TITLE_SELECTOR);
  if (headerEditable) {
    const innerTextarea = headerEditable.querySelector("textarea");
    if (innerTextarea)
      return innerTextarea;
  }
  const editor = activeTitleEditors.get(win);
  const selection = savedTitleSelections.get(win);
  if (
    editor
    && editor.isConnected
    && (
      active?.closest?.(`.${TOOLBAR_CLASS}`)
      || editor.closest(HEADER_TITLE_SELECTOR)?.classList.contains("focused")
      || selection?.editor === editor
    )
  ) {
    if (selection?.editor === editor)
      editor.setSelectionRange(selection.start, selection.end, selection.direction);
    return editor;
  }
  return null;
}

function isSingleOuterTag(source: string, tag: string, expectedOpenTag: string): boolean {
  if (!source.startsWith(expectedOpenTag) || !source.endsWith(`</${tag}>`))
    return false;
  const token = /<\/?([a-z]+)\b[^>]*>/gi;
  let depth = 0;
  for (let match = token.exec(source); match; match = token.exec(source)) {
    if (match[1].toLowerCase() !== tag)
      continue;
    if (match[0].startsWith("</")) {
      depth--;
      if (depth === 0)
        return token.lastIndex === source.length;
    }
    else if (!match[0].endsWith("/>")) {
      depth++;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findEnclosingTagAtCursor(
  text: string,
  cursor: number,
  tag: string,
  openPattern: RegExp,
): { start: number; end: number; content: string } | null {
  const pairRegex = new RegExp(`(${openPattern.source})([\\s\\S]*?)<\\/${tag}>`, "gi");
  for (let match = pairRegex.exec(text); match; match = pairRegex.exec(text)) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (cursor >= matchStart && cursor <= matchEnd) {
      return {
        start: matchStart,
        end: matchEnd,
        content: match[2],
      };
    }
  }
  return null;
}

/**
 * Get the selected text and replace it with text with or without HTML tags depending on the operation.
 * @param tag sub | sup | b | i | span
 * @param attribute Optional tag attribute
 * @param value Attribute value
 * @param win Window containing the title editor
 */
export function setHtmlTag(tag: string, attribute?: string, value?: string, win: Window = Zotero.getMainWindow()): void {
  const textarea = getTitleEditor(win);
  if (!textarea || textarea.selectionStart == null || textarea.selectionEnd == null)
    return;

  let { selectionStart: start, selectionEnd: end } = textarea;
  const text = textarea.value;
  const attributeText = attribute ? ` ${attribute}="${value}"` : "";
  const openTag = `<${tag}${attributeText}>`;
  const closeTag = `</${tag}>`;
  const openTagRegex = attribute && value
    ? new RegExp(`<${tag}\\b[^>]*\\b${escapeRegExp(attribute)}\\s*=\\s*["']${escapeRegExp(value)}["'][^>]*>`, "i")
    : new RegExp(`<${tag}\\b[^>]*>`, "i");
  const innerTagPairRegex = new RegExp(`${openTagRegex.source}([\\s\\S]*?)<\\/${tag}>`, "gi");

  let selectedText = text.slice(start, end);
  let isActiveAfter = false;

  if (start === end) {
    const enclosing = findEnclosingTagAtCursor(text, start, tag, openTagRegex);
    if (!enclosing)
      return;
    start = enclosing.start;
    end = enclosing.end;
    selectedText = enclosing.content;
    isActiveAfter = false;
  }
  else if (isSingleOuterTag(selectedText, tag, openTag)) {
    selectedText = selectedText.slice(openTag.length, -closeTag.length);
    isActiveAfter = false;
  }
  else if (innerTagPairRegex.test(selectedText)) {
    innerTagPairRegex.lastIndex = 0;
    selectedText = selectedText.replace(innerTagPairRegex, "$1");
    isActiveAfter = false;
  }
  else {
    selectedText = `${openTag}${selectedText}${closeTag}`;
    isActiveAfter = true;
  }

  textarea.setRangeText(selectedText, start, end, "select");

  textarea.style.height = "auto";
  if (textarea.scrollHeight > 0)
    textarea.style.height = `${textarea.scrollHeight}px`;

  const Event = (win as Window & typeof globalThis).Event;
  const inputEvent = new Event("input", { bubbles: true });
  textarea.dispatchEvent(inputEvent);
  rememberTitleSelection(win, textarea);

  const toolbar = win.document.querySelector(`.${TOOLBAR_CLASS}`);
  if (toolbar) {
    const hookName = tag === "sub" ? "subscript" : tag === "sup" ? "supscript" : tag === "b" ? "bold" : tag === "i" ? "italic" : tag === "span" && attribute === "class" ? "nocase" : "small-caps";
    toolbar.querySelector(`#metaref-richtext-${hookName}-btn`)?.setAttribute("aria-pressed", String(isActiveAfter));
  }

  textarea.focus();
}
