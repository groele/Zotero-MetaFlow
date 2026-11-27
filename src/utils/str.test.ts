import { describe, expect, it } from "vitest";
import { normalizeKey, parseXML, parseXMLDocument } from "./str";

describe("journal lookup keys & XML parsing", () => {
  it("normalizes standalone conjunctions while retaining letters inside names", () => {
    expect(normalizeKey("The Scandinavian Journal of Medicine and Science"))
      .toBe("scandinavianjournalofmedicinescience");
    expect(normalizeKey("Landscape Research")).not.toBe(normalizeKey("Lscape Research"));
    expect(normalizeKey("Nature\n Materials")).toBe(normalizeKey("Nature Materials"));
  });

  it("parses XML documents and returns documentElement when body is undefined", () => {
    const originalDOMParser = (globalThis as any).DOMParser;
    (globalThis as any).DOMParser = class {
      parseFromString(xml: string) {
        return { body: undefined, documentElement: { tagName: "root", textContent: xml } };
      }
    };
    try {
      const doc = parseXMLDocument("<root>hello</root>");
      expect(doc.documentElement?.tagName).toBe("root");
      const root = parseXML("<root>hello</root>");
      expect(root).toEqual({ tagName: "root", textContent: "<root>hello</root>" });
    }
    finally {
      (globalThis as any).DOMParser = originalDOMParser;
    }
  });
});
