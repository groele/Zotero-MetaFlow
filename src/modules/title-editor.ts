export const TOOLBAR_CLASS = "metaref-richtext-toolbar";
export const HEADER_TITLE_SELECTOR = [
  "item-pane-header .title editable-text",
  "editable-text[data-field='title']",
  "editable-text[data-field='shortTitle']",
  "editable-text[data-field='bookTitle']",
  "editable-text[data-field='proceedingsTitle']",
  "[data-field='title'] editable-text",
  "[data-field='shortTitle'] editable-text",
  "[data-field='bookTitle'] editable-text",
  "[data-field='proceedingsTitle'] editable-text",
].join(", ");

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

interface TagSpan {
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBalancedTagSpans(text: string, tag: string, openTagRegex: RegExp): TagSpan[] {
  const tokenRegex = /<\/?([a-z][\w-]*)\b[^>]*>/gi;
  const stack: Array<{ openStart: number; openEnd: number; matches: boolean }> = [];
  const spans: TagSpan[] = [];
  for (let match = tokenRegex.exec(text); match; match = tokenRegex.exec(text)) {
    if (match[1].toLowerCase() !== tag)
      continue;
    const raw = match[0];
    if (raw.startsWith("</")) {
      const top = stack.pop();
      if (top?.matches) {
        spans.push({
          openStart: top.openStart,
          openEnd: top.openEnd,
          closeStart: match.index,
          closeEnd: match.index + raw.length,
        });
      }
    }
    else if (!raw.endsWith("/>")) {
      stack.push({
        openStart: match.index,
        openEnd: match.index + raw.length,
        matches: openTagRegex.test(raw),
      });
    }
  }
  return spans;
}

function snapAwayFromSlicedMarkup(text: string, start: number, end: number): [number, number] {
  const markupRegex = /<\/?[a-z][\w-]*\b[^>]*>/gi;
  let nextStart = start;
  let nextEnd = end;
  for (let match = markupRegex.exec(text); match; match = markupRegex.exec(text)) {
    const tagStart = match.index;
    const tagEnd = tagStart + match[0].length;
    if (nextStart > tagStart && nextStart < tagEnd)
      nextStart = tagStart;
    if (nextEnd > tagStart && nextEnd < tagEnd)
      nextEnd = tagEnd;
  }
  return [nextStart, nextEnd];
}

function isSingleOuterTag(source: string, tag: string, openTagRegex: RegExp): { innerStart: number; innerEnd: number } | null {
  const spans = findBalancedTagSpans(source, tag, openTagRegex);
  const outer = spans.find(span => span.openStart === 0 && span.closeEnd === source.length);
  return outer ? { innerStart: outer.openEnd, innerEnd: outer.closeStart } : null;
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
    ? new RegExp(`^<${tag}\\b[^>]*\\b${escapeRegExp(attribute)}\\s*=\\s*["']${escapeRegExp(value)}["'][^>]*>$`, "i")
    : attribute
      ? new RegExp(`^<${tag}\\b[^>]*\\b${escapeRegExp(attribute)}\\b[^>]*>$`, "i")
      : new RegExp(`^<${tag}>$`, "i");
  const innerTagPairRegex = attribute && value
    ? new RegExp(`<${tag}\\b[^>]*\\b${escapeRegExp(attribute)}\\s*=\\s*["']${escapeRegExp(value)}["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi")
    : new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");

  const spans = findBalancedTagSpans(text, tag, openTagRegex);
  let replacement = "";
  let selectOffsetStart = 0;
  let selectOffsetEnd: number | undefined;
  let isActiveAfter = false;

  if (start === end) {
    const enclosing = spans.find(span => start >= span.openStart && start <= span.closeEnd);
    if (!enclosing)
      return;
    start = enclosing.openStart;
    end = enclosing.closeEnd;
    replacement = text.slice(enclosing.openEnd, enclosing.closeStart);
    isActiveAfter = false;
  }
  else {
    [start, end] = snapAwayFromSlicedMarkup(text, start, end);
    const strictlyInside = spans.find(span => start >= span.openEnd && end <= span.closeStart);
    if (strictlyInside) {
      const left = text.slice(strictlyInside.openEnd, start);
      const middle = text.slice(start, end);
      const right = text.slice(end, strictlyInside.closeStart);
      start = strictlyInside.openStart;
      end = strictlyInside.closeEnd;
      const leftWrapped = left ? `${openTag}${left}${closeTag}` : "";
      const rightWrapped = right ? `${openTag}${right}${closeTag}` : "";
      replacement = `${leftWrapped}${middle}${rightWrapped}`;
      selectOffsetStart = leftWrapped.length;
      selectOffsetEnd = leftWrapped.length + middle.length;
      isActiveAfter = false;
    }
    else {
      for (const span of spans) {
        const overlaps = start < span.closeEnd && end > span.openStart;
        const fullyContains = start <= span.openStart && end >= span.closeEnd;
        if (overlaps && !fullyContains) {
          start = Math.min(start, span.openStart);
          end = Math.max(end, span.closeEnd);
        }
      }
      const selectedText = text.slice(start, end);
      const outer = isSingleOuterTag(selectedText, tag, openTagRegex);
      if (outer) {
        replacement = selectedText.slice(outer.innerStart, outer.innerEnd);
        isActiveAfter = false;
      }
      else if (innerTagPairRegex.test(selectedText)) {
        innerTagPairRegex.lastIndex = 0;
        replacement = selectedText.replace(innerTagPairRegex, "$1");
        isActiveAfter = false;
      }
      else {
        let mergedContent = selectedText;
        const leftSpan = spans.find(span => span.closeEnd === start);
        if (leftSpan) {
          mergedContent = text.slice(leftSpan.openEnd, leftSpan.closeStart) + mergedContent;
          start = leftSpan.openStart;
        }
        const rightSpan = spans.find(span => span.openStart === end);
        if (rightSpan) {
          mergedContent = mergedContent + text.slice(rightSpan.openEnd, rightSpan.closeStart);
          end = rightSpan.closeEnd;
        }
        replacement = `${openTag}${mergedContent}${closeTag}`;
        isActiveAfter = true;
      }
    }
  }

  textarea.setRangeText(replacement, start, end, "select");
  if (selectOffsetEnd !== undefined)
    textarea.setSelectionRange(start + selectOffsetStart, start + selectOffsetEnd);

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
