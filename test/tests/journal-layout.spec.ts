import { assert } from "chai";
import { config } from "../../package.json";
import { waitForItemTree } from "../helpers/item-tree";

describe("journal pane layout", function () {
  this.timeout(30000);

  it("keeps match details on one full-width line immediately above database versions", async function () {
    const prefix = config.prefsPrefix;
    const settings: Record<string, boolean | string> = {
      "lint.onAdded": false,
      "insights.showPane": true,
      "insights.esiSourcePriority": "local-only",
      "insights.natureSourcePriority": "local-only",
      "insights.natureEnabled": true,
      "easyscholar.fields.esi": true,
      "easyscholar.fields.sci": true,
      "easyscholar.fields.jcr": true,
      "easyscholar.fields.impactFactor": true,
    };
    const previous = new Map(Object.keys(settings).map(key => [key, Zotero.Prefs.get(`${prefix}.${key}`, true)]));
    const item = new Zotero.Item("journalArticle");
    try {
      for (const [key, value] of Object.entries(settings))
        Zotero.Prefs.set(`${prefix}.${key}`, value, true);
      item.setField("title", "Journal layout fixture");
      item.setField("publicationTitle", "Physical Review Letters");
      item.setField("ISSN", "0031-9007");
      item.setField("extra", "SCI: 是\nJCR 分区：Q1\n影响因子：8.4");
      await item.saveTx();
      const win = Zotero.getMainWindow();
      await waitForItemTree(win);
      await win.ZoteroPane.selectItem(item.id);
      await win.ZoteroPane.itemSelected();
      const section = win.document.querySelector("item-pane-custom-section[data-pane*='metaref-journal-insights']") as any;
      await section._handleRefresh();
      const body = section.querySelector("[data-type='body']") as HTMLElement;
      const basis = body.querySelector("[data-journal-shared-basis]") as HTMLElement;
      const versions = body.querySelector("details") as HTMLDetailsElement;
      assert.equal(basis.nextElementSibling, versions);
      assert.include(basis.textContent!, "0031-9007");
      assert.equal(basis.children.length, 1, "shared ISSN is not repeated");
      for (const width of [280, 360]) {
        body.style.width = `${width}px`;
        body.style.boxSizing = "border-box";
        const line = basis.firstElementChild!;
        assert.equal(win.getComputedStyle(line)!.whiteSpace, "nowrap");
        assert.isAtMost(line.getBoundingClientRect().height, Number.parseFloat(win.getComputedStyle(line)!.lineHeight) + 1);
        assert.isAtMost(body.scrollWidth, body.clientWidth + 1);
        for (const value of body.querySelectorAll("dd"))
          assert.equal(win.getComputedStyle(value)!.textAlign, "right");
      }
      const issnNumber = body.querySelector("[data-journal-issn]")!;
      assert.equal(win.getComputedStyle(issnNumber)!.textAlign, "right");
      const result = body.querySelector("dd")!;
      assert.closeTo(issnNumber.getBoundingClientRect().right, result.getBoundingClientRect().right, 1, "ISSN and metric values share the right edge");
      assert.isFalse(versions.open);
      body.style.removeProperty("width");
      body.style.removeProperty("box-sizing");
      section.scrollIntoView({ block: "start" });
      await Zotero.Promise.delay(100);
      const rect = section.getBoundingClientRect();
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
      canvas.width = Math.ceil(rect.width);
      canvas.height = Math.ceil(rect.height);
      (canvas.getContext("2d") as any).drawWindow(win, rect.left, rect.top, rect.width, rect.height, "rgb(245,245,245)");
      await IOUtils.write(PathUtils.join(PathUtils.tempDir, "metaref-journal-layout-final.png"), Uint8Array.from(win.atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0)));
    }
    finally {
      if (item.id)
        await item.eraseTx();
      for (const [key, value] of previous)
        Zotero.Prefs.set(`${prefix}.${key}`, value as string | boolean, true);
    }
  });
});
