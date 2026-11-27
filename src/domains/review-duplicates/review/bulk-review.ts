import type { DuplicatePair } from "./duplicate-matching";
import type { MasterStrategy } from "./duplicate-policy";
import { getString } from "../../../utils/locale";
import { getPref } from "../../../utils/prefs";
import { bulkMergeDuplicates, cancelDuplicateBatch, pauseDuplicateBatch } from "./duplicate-batch";
import { canMergePair, chooseMaster, duplicateGroups } from "./duplicate-policy";
import { useReviewPanel } from "./panel";

export async function chooseDuplicateBatch(pairs: DuplicatePair[], signal: AbortSignal): Promise<DuplicatePair[] | "individual" | false> {
  const groups = duplicateGroups(pairs.filter(pair => canMergePair(pair, getPref("duplicates.mergeDifferentTypes" as any, false) === true)));
  if (!groups.length)
    return "individual";
  const selected = new Set(groups.map((_, index) => index));
  let action: "bulk" | "individual" | "cancel" = "cancel";
  const { dialog, openAndWaitClose } = useReviewPanel(signal);
  const updateSelection = (doc: Document) => {
    const all = doc.getElementById("metaref-duplicate-select-all") as HTMLInputElement;
    all.checked = selected.size === groups.length;
    all.indeterminate = selected.size > 0 && selected.size < groups.length;
    (doc.getElementById("metaref-duplicate-batch-apply") as HTMLButtonElement).disabled = !selected.size;
  };
  const strategy = getPref("duplicates.masterStrategy" as any, "oldest") as MasterStrategy;
  dialog.addCell(0, 0, { tag: "div", properties: { id: "metaref-duplicate-batch-review" }, children: [
    { tag: "p", properties: { textContent: getString("review-batch-note", { args: { groups: groups.length } }) } },
    { tag: "label", children: [
      { tag: "input", attributes: { type: "checkbox" }, properties: { id: "metaref-duplicate-select-all", checked: true, onchange: (event: Event) => {
        const checked = (event.target as HTMLInputElement).checked;
        const root = (event.target as Element).closest("#metaref-duplicate-batch-review")!;
        for (const input of root.querySelectorAll<HTMLInputElement>(".metaref-duplicate-group")) {
          input.checked = checked;
          if (checked)
            selected.add(Number(input.value));
          else selected.delete(Number(input.value));
        }
        updateSelection((event.target as Element).ownerDocument!);
      } } },
      { tag: "span", properties: { textContent: getString("review-batch-select-all") } },
    ] },
    ...groups.map((group, index) => {
      const master = chooseMaster(group, strategy);
      return { tag: "label", styles: { display: "block", padding: "10px", borderBottom: "1px solid var(--fill-quinary)", overflowWrap: "anywhere" }, children: [
        { tag: "input", attributes: { type: "checkbox" }, properties: { className: "metaref-duplicate-group", value: String(index), checked: true, onchange: (event: Event) => {
          if ((event.target as HTMLInputElement).checked)
            selected.add(index);
          else selected.delete(index);
          updateSelection((event.target as Element).ownerDocument!);
        } } },
        { tag: "span", properties: { textContent: getString("review-batch-group", { args: { count: group.length, id: master.id, title: String(master.data.title || "") } }) } },
        { tag: "small", styles: { display: "block", marginInlineStart: "24px" }, properties: { textContent: group.map(record => `${record.id} · ${record.data.DOI || record.data.title || ""}`).join("\n") } },
      ] };
    }),
  ] });
  dialog.addButton(getString("duplicates-bulk"), "metaref-duplicate-batch-apply", { callback: () => {
    action = "bulk";
  } });
  dialog.addButton(getString("review-batch-individual"), "metaref-duplicate-batch-individual", { callback: () => {
    action = "individual";
  } });
  dialog.addButton(getString("review-cancel"), "metaref-review-cancel");
  await openAndWaitClose(getString("rule-tool-review-duplicates"));
  if (action as string === "individual")
    return "individual";
  if (action as string !== "bulk")
    return false;
  const ids = new Set(groups.filter((_, index) => selected.has(index)).flatMap(group => group.map(record => record.id)));
  return pairs.filter(pair => ids.has(pair.left.id) && ids.has(pair.right.id) && canMergePair(pair, getPref("duplicates.mergeDifferentTypes" as any, false) === true));
}

export async function runDuplicateBatch(pairs: DuplicatePair[], signal: AbortSignal) {
  const { dialog, openAndWaitClose, close } = useReviewPanel(signal);
  dialog.addCell(0, 0, { tag: "p", attributes: { role: "status" }, properties: { id: "metaref-duplicate-batch-progress" } });
  dialog.addCell(0, 0, { tag: "button", properties: { id: "metaref-duplicate-batch-pause", textContent: getString("duplicates-pause"), onclick: () => pauseDuplicateBatch() } });
  dialog.addCell(0, 0, { tag: "button", properties: { id: "metaref-duplicate-batch-stop", textContent: getString("duplicates-cancel"), onclick: () => cancelDuplicateBatch() } });
  const panel = openAndWaitClose(getString("duplicates-bulk"));
  try {
    return await bulkMergeDuplicates(pairs, signal, undefined, (state) => {
      const status = Zotero.getMainWindow().document.getElementById("metaref-duplicate-batch-progress");
      if (status)
        status.textContent = getString("duplicates-bulk-status", { args: { completed: state.completed, total: state.total, merged: state.merged, failed: state.errors.length } });
    }, false);
  }
  finally {
    close();
    await panel;
  }
}
