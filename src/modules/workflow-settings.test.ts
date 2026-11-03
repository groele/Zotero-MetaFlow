import { describe, expect, it, vi } from "vitest";
import { setupWorkflowSettings, workflowGroup } from "./workflow-settings";

describe("workflow-settings module", () => {
  it("assigns each formatter to a single workflow module", () => {
    expect(workflowGroup("correct-title-sentence-case")).toBe("title");
    expect(workflowGroup("correct-bookTitle-sentence-case")).toBe("title");
    expect(workflowGroup("correct-proceedingsTitle-sentence-case")).toBe("title");
    expect(workflowGroup("correct-publication-title-case")).toBe("publication");
    expect(workflowGroup("correct-creators-case")).toBe("creators");
    expect(workflowGroup("require-doi")).toBe("identifiers");
    expect(workflowGroup("correct-pages-range")).toBe("pagination");
    expect(workflowGroup("correct-attachment-roles")).toBe("attachments");
    expect(workflowGroup("correct-date-format")).toBe("other");
  });

  it("configures metadata source priority radio buttons with real interactive click handling", () => {
    const preferences = new Map<string, unknown>();
    preferences.set("rule.tool-update-metadata.option.mode", "blank");
    preferences.set("workflow.updateBibliographic", true);

    vi.stubGlobal("addon", {
      data: {
        alive: true,
        config: { addonID: "metaflow@groele", prefsPrefix: "extensions.zotero.metaref" },
      },
    });

    vi.stubGlobal("Zotero", {
      Prefs: {
        get: (key: string) => {
          const stripped = key.replace("extensions.zotero.metaref.", "");
          return preferences.get(stripped);
        },
        set: (key: string, val: unknown) => {
          const stripped = key.replace("extensions.zotero.metaref.", "");
          preferences.set(stripped, val);
        },
      },
    });

    // Mock DOM elements
    const elements = new Map<string, any>();
    const host = {
      children: [] as any[],
      insertBefore: vi.fn((node: any) => host.children.push(node)),
      querySelector: (sel: string) => sel === "#metaref-additional-menu-options" ? elements.get("additional") : null,
    };
    elements.set("additional", { id: "metaref-additional-menu-options" });

    const xulGroup = {
      id: "metaref-metadata-source-priority",
      value: "blank",
      dispatchEvent: vi.fn(),
    };
    elements.set("#metaref-metadata-source-priority", xulGroup);

    const createdElements: any[] = [];
    const mockDoc = {
      defaultView: {
        AbortController,
        Event: class MockEvent {
          constructor(public type: string, public options?: any) {}
        },
      },
      l10n: {
        setAttributes: vi.fn(),
      },
      createElementNS: (_ns: string, tag: string) => {
        const el: any = {
          tagName: tag,
          className: "",
          classList: {
            toggle: vi.fn(),
          },
          attributes: new Map<string, string>(),
          children: [] as any[],
          style: {},
          setAttribute: (k: string, v: string) => el.attributes.set(k, v),
          getAttribute: (k: string) => el.attributes.get(k),
          append: (...nodes: any[]) => el.children.push(...nodes),
          appendChild: (node: any) => el.children.push(node),
          insertBefore: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
        createdElements.push(el);
        return el;
      },
    };

    const pane: any = {
      ownerDocument: mockDoc,
      querySelector: (sel: string) => {
        if (sel === "#metaref-core-workflows")
          return host;
        if (sel === "#metaref-metadata-source-priority")
          return xulGroup;
        if (sel.includes("data-core-menu-command")) {
          return {
            id: sel,
            children: [],
          };
        }
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    try {
      setupWorkflowSettings(pane);

      // Verify the radio inputs and container alignment were created
      const priorityContainer = createdElements.find(el => el.id === "metaref-metadata-source-priority-container");
      expect(priorityContainer).toBeDefined();
      expect(priorityContainer.style.cssText).toContain("margin-inline-start: 24px");

      const priorityOptions = createdElements.find(el => el.attributes?.get("role") === "radiogroup");
      expect(priorityOptions).toBeDefined();
      expect(priorityOptions.style.cssText).toContain("margin-inline: 0");

      const radioLocal = createdElements.find(el => el.id === "metaref-source-priority-blank");
      const radioCloud = createdElements.find(el => el.id === "metaref-source-priority-all");
      expect(radioLocal).toBeDefined();
      expect(radioCloud).toBeDefined();
      expect(radioLocal.type).toBe("radio");
      expect(radioCloud.type).toBe("radio");
      expect(radioLocal.checked).toBe(true);
      expect(radioCloud.checked).toBe(false);

      // Verify click listener on cloud radio
      const cloudClick = radioCloud.addEventListener.mock.calls.find((call: any[]) => call[0] === "click");
      expect(cloudClick).toBeDefined();

      // Trigger click to change priority to "all" (cloud)
      cloudClick[1](new mockDoc.defaultView.Event("click"));
      expect(preferences.get("rule.tool-update-metadata.option.mode")).toBe("all");
      expect(radioCloud.checked).toBe(true);
      expect(radioLocal.checked).toBe(false);

      // Trigger click on local radio to revert to "blank" (local)
      const localClick = radioLocal.addEventListener.mock.calls.find((call: any[]) => call[0] === "click");
      expect(localClick).toBeDefined();
      localClick[1](new mockDoc.defaultView.Event("click"));
      expect(preferences.get("rule.tool-update-metadata.option.mode")).toBe("blank");
      expect(radioLocal.checked).toBe(true);
      expect(radioCloud.checked).toBe(false);

      // Verify disabled guard prevents priority change when disabled
      radioCloud.disabled = true;
      cloudClick[1](new mockDoc.defaultView.Event("click"));
      expect(preferences.get("rule.tool-update-metadata.option.mode")).toBe("blank");
      expect(radioLocal.checked).toBe(true);
      expect(radioCloud.checked).toBe(false);
    }
    finally {
      vi.unstubAllGlobals();
    }
  });

  it("exposes reviewDuplicatesOnCheck, binds tldrTarget, and links tldr options", () => {
    const preferences = new Map<string, unknown>();
    preferences.set("workflow.reviewDuplicatesOnCheck", false);
    preferences.set("workflow.tldrTarget", "extra");
    preferences.set("workflow.tldrEnabled", true);

    vi.stubGlobal("addon", {
      data: {
        alive: true,
        config: { addonID: "metaflow@groele", prefsPrefix: "extensions.zotero.metaref" },
      },
    });

    vi.stubGlobal("Zotero", {
      Prefs: {
        get: (key: string) => {
          const stripped = key.replace("extensions.zotero.metaref.", "");
          return preferences.get(stripped);
        },
        set: (key: string, val: unknown) => {
          const stripped = key.replace("extensions.zotero.metaref.", "");
          preferences.set(stripped, val);
        },
      },
    });

    const elements = new Map<string, any>();
    const host = {
      children: [] as any[],
      insertBefore: vi.fn((node: any) => host.children.push(node)),
      querySelector: () => null,
    };
    elements.set("#metaref-core-workflows", host);

    const tldrSelect = {
      id: "metaref-tldr-target-select",
      value: "",
      disabled: false,
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    const tldrCheckbox = {
      id: "metaref-metadata-update-tldr-info-pane",
      disabled: false,
      checked: true,
      addEventListener: vi.fn(),
    };
    const tldrOptions = {
      id: "metaref-tldr-options",
      style: { opacity: "1" },
      append: vi.fn(),
    };
    const tldrEnabledInput = {
      id: "metaref-metadata-update-tldr",
      type: "checkbox",
      checked: true,
      disabled: false,
      closest: () => ({ append: vi.fn() }),
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    elements.set("#metaref-tldr-target-select", tldrSelect);
    elements.set("#metaref-metadata-update-tldr-info-pane", tldrCheckbox);
    elements.set("#metaref-tldr-options", tldrOptions);
    elements.set("#metaref-metadata-update-tldr", tldrEnabledInput);

    const createdElements: any[] = [];
    const mockDoc = {
      defaultView: {
        AbortController,
        Event: class MockEvent {
          constructor(public type: string, public options?: any) {}
        },
      },
      l10n: {
        setAttributes: vi.fn(),
      },
      createElementNS: (_ns: string, tag: string) => {
        const el: any = {
          tagName: tag,
          className: "",
          classList: { toggle: vi.fn() },
          attributes: new Map<string, string>(),
          children: [] as any[],
          style: {},
          setAttribute: (k: string, v: string) => el.attributes.set(k, v),
          getAttribute: (k: string) => el.attributes.get(k),
          append: (...nodes: any[]) => el.children.push(...nodes),
          appendChild: (node: any) => el.children.push(node),
          insertBefore: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
        createdElements.push(el);
        return el;
      },
    };

    const listeners: { type: string; fn: () => void }[] = [];
    const pane: any = {
      ownerDocument: mockDoc,
      querySelector: (sel: string) => {
        if (sel === "#metaref-core-workflows")
          return host;
        if (sel === "#metaref-tldr-target-select")
          return tldrSelect;
        if (sel === "#metaref-metadata-update-tldr-info-pane")
          return tldrCheckbox;
        if (sel === "#metaref-tldr-options")
          return tldrOptions;
        if (sel.includes("workflow.tldrEnabled") || sel === "#metaref-metadata-update-tldr")
          return tldrEnabledInput;
        if (sel.includes("data-core-menu-command"))
          return { id: sel, children: [] };
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: vi.fn((type, fn) => listeners.push({ type, fn })),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    try {
      setupWorkflowSettings(pane);

      // 1. Verify reviewDuplicatesOnCheck checkbox exists and updates preference
      const checkDupInput = createdElements.find(el => el.id === "metaref-workflow-check-duplicates");
      expect(checkDupInput).toBeDefined();
      expect(checkDupInput.attributes.get("preference")).toBe("extensions.zotero.metaref.workflow.reviewDuplicatesOnCheck");
      const checkDupChange = checkDupInput.addEventListener.mock.calls.find((call: any[]) => call[0] === "change");
      expect(checkDupChange).toBeDefined();
      checkDupInput.checked = true;
      checkDupChange![1]();
      expect(preferences.get("workflow.reviewDuplicatesOnCheck")).toBe(true);

      // 2. Verify tldrTarget select initializes from pref and writes on change
      expect(tldrSelect.value).toBe("extra");
      const selectChange = tldrSelect.addEventListener.mock.calls.find((call: any[]) => call[0] === "change");
      expect(selectChange).toBeDefined();
      tldrSelect.value = "both";
      selectChange![1]();
      expect(preferences.get("workflow.tldrTarget")).toBe("both");

      // 3. Verify tldr options linkage when tldrEnabled is false
      tldrEnabledInput.checked = false;
      listeners.filter(l => l.type === "change").forEach(l => l.fn());

      expect(tldrCheckbox.disabled).toBe(true);
      expect(tldrSelect.disabled).toBe(true);
      expect(tldrOptions.style.opacity).toBe("0.55");

      // Verify re-enabling restores active state
      tldrEnabledInput.checked = true;
      listeners.filter(l => l.type === "change").forEach(l => l.fn());

      expect(tldrCheckbox.disabled).toBe(false);
      expect(tldrSelect.disabled).toBe(false);
      expect(tldrOptions.style.opacity).toBe("1");
    }
    finally {
      vi.unstubAllGlobals();
    }
  });
});
