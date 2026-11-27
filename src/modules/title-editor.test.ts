import { describe, expect, it } from "vitest";
import { getTitleEditor, setHtmlTag } from "./title-editor";

class FakeEvent {
  constructor(public type: string, public init?: { bubbles?: boolean }) {}
}

function createEditorFixture(fieldName = "header") {
  let activeEl: any = null;
  const editable = {
    classList: { contains: (cls: string) => cls === "focused" },
    querySelector: () => null as any,
  };
  const makeTextarea = (isTitleField: boolean) => {
    const el: any = {
      localName: "textarea",
      isConnected: true,
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: "none",
      style: { height: "" },
      scrollHeight: 24,
      closest(selector: string) {
        if (!isTitleField)
          return null;
        if (fieldName === "header" && selector.includes("item-pane-header .title editable-text"))
          return editable;
        if (fieldName !== "header" && selector.includes(`[data-field='${fieldName}'] editable-text`))
          return editable;
        return null;
      },
      setSelectionRange(start: number, end: number, dir = "none") {
        el.selectionStart = start;
        el.selectionEnd = end;
        el.selectionDirection = dir;
      },
      setRangeText(replacement: string, start: number, end: number, selectMode?: string) {
        el.value = el.value.slice(0, start) + replacement + el.value.slice(end);
        if (selectMode === "select") {
          el.selectionStart = start;
          el.selectionEnd = start + replacement.length;
        }
      },
      dispatchEvent() {
        return true;
      },
      focus() {
        activeEl = el;
      },
    };
    return el;
  };

  const textarea = makeTextarea(true);
  editable.querySelector = () => textarea;
  const outside = makeTextarea(false);
  const win: any = {
    Event: FakeEvent,
    document: {
      get activeElement() {
        return activeEl;
      },
      querySelector() {
        return null;
      },
    },
  };
  return { win: win as Window, textarea: textarea as HTMLTextAreaElement, outside: outside as HTMLTextAreaElement };
}

describe("title-editor setHtmlTag & getTitleEditor", () => {
  it("unwraps enclosing tag when selecting inner text without markup (no nested duplicate tags)", () => {
    const { win, textarea } = createEditorFixture();
    textarea.value = "H<sub>2</sub>O";
    textarea.focus();
    textarea.setSelectionRange(6, 7);
    setHtmlTag("sub", undefined, undefined, win);
    expect(textarea.value).toBe("H2O");
  });

  it("splits enclosing tag cleanly when toggling off part of a multi-char subscript", () => {
    const { win, textarea } = createEditorFixture();
    textarea.value = "C<sub>12</sub>H<sub>22</sub>";
    textarea.focus();
    textarea.setSelectionRange(6, 7);
    setHtmlTag("sub", undefined, undefined, win);
    expect(textarea.value).toBe("C1<sub>2</sub>H<sub>22</sub>");
  });

  it("snaps away from half-sliced HTML tags instead of producing broken markup", () => {
    const { win, textarea } = createEditorFixture();
    textarea.value = "H<sub>2</sub>O";
    textarea.focus();
    textarea.setSelectionRange(1, 7);
    setHtmlTag("sub", undefined, undefined, win);
    expect(textarea.value).toBe("H2O");
  });

  it("coalesces adjacent identical tags instead of emitting <sub>2</sub><sub>3</sub>", () => {
    const { win, textarea } = createEditorFixture();
    textarea.value = "H<sub>2</sub>3O";
    textarea.focus();
    const idx3 = textarea.value.indexOf("3");
    textarea.setSelectionRange(idx3, idx3 + 1);
    setHtmlTag("sub", undefined, undefined, win);
    expect(textarea.value).toBe("H<sub>23</sub>O");
  });

  it("supports collapsed cursor unwrapping inside tag and no-op outside tag", () => {
    const { win, textarea } = createEditorFixture();
    textarea.value = "Fe<sup>3+</sup>";
    textarea.focus();
    textarea.setSelectionRange(8, 8);
    setHtmlTag("sup", undefined, undefined, win);
    expect(textarea.value).toBe("Fe3+");

    textarea.setSelectionRange(1, 1);
    setHtmlTag("sup", undefined, undefined, win);
    expect(textarea.value).toBe("Fe3+");
  });

  it("supports shortTitle, bookTitle and proceedingsTitle editable-text fields while ignoring unrelated textareas", () => {
    const { win, textarea, outside } = createEditorFixture("shortTitle");
    textarea.value = "CO2";
    textarea.focus();
    textarea.setSelectionRange(2, 3);
    expect(getTitleEditor(win)).toBe(textarea);
    setHtmlTag("sub", undefined, undefined, win);
    expect(textarea.value).toBe("CO<sub>2</sub>");

    outside.value = "H2O";
    outside.focus();
    outside.setSelectionRange(1, 2);
    setHtmlTag("sub", undefined, undefined, win);
    expect(outside.value).toBe("H2O");
  });
});
