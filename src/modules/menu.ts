import type { RuleForRegularScopeField } from "./rules/rule-base";
import { cleanupResourcesSync } from "../utils/cleanup";
import { showZoteroDirectory } from "../utils/directories";
import { redrawItemValues } from "../utils/item-value-refresh";
import { isWritableItem } from "../utils/item-write-policy";
import { getJournalInsights } from "../utils/journal-insights";
import { canRunJournalRule } from "../utils/journal-permissions";
import { getLocaleID } from "../utils/locale";
import { logger } from "../utils/logger";
import { getPref } from "../utils/prefs";
import { commandPrimary, commandVisible } from "../utils/workflow-policy";
import { refreshJournalPane } from "./journal-pane";
import { Rules } from "./rules";

type FieldMenu = _ZoteroTypes.MenuManager.MenuData<_ZoteroTypes.MenuManager.ItemPaneMenuContext>;
type ItemMenu = _ZoteroTypes.MenuManager.MenuData<_ZoteroTypes.MenuManager.LibraryMenuContext>;
type LibraryContext = _ZoteroTypes.MenuManager.LibraryMenuContext & { collectionTreeRows?: Zotero.CollectionTreeRow[] };

async function menuItems(context: LibraryContext): Promise<Zotero.Item[]> {
  if (context.items)
    return context.items;
  const rows = context.collectionTreeRows ?? [];
  const items = await Promise.all(rows.map(row => row.getItems()));
  return items.flat().filter((item): item is Zotero.Item => Boolean(item && typeof (item as Zotero.Item).isRegularItem === "function"));
}

function hasMenuItems(context: LibraryContext): boolean {
  if (context.items)
    return context.items.some(item => item.isRegularItem() && isWritableItem(item));
  return Boolean(context.collectionTreeRows?.length);
}

const icon = typeof rootURI !== "undefined" ? `${rootURI}content/icons/metaref-16.svg` : "";
const registeredMenus: string[] = [];
const handledCommands = new WeakSet<Event>();

function acceptCommand(event: Event) {
  // Native menu listeners can observe the same event more than once during a
  // single dispatch. Zotero may reuse a native command event after a menu is
  // reopened, so keep this guard only for the current dispatch turn.
  if (handledCommands.has(event))
    return false;
  handledCommands.add(event);
  void Promise.resolve().then(() => handledCommands.delete(event));
  return true;
}

function addMenu<T extends _ZoteroTypes.MenuManager.ValidTarget>(options: _ZoteroTypes.MenuManager.MenuOptions<T>) {
  const id = Zotero.MenuManager.registerMenu(options);
  if (id)
    registeredMenus.push(id);
}

export function unregisterMenu() {
  cleanupResourcesSync(registeredMenus.splice(0).map(id => () => Zotero.MenuManager.unregisterMenu(id)), error => logger.error("Menu cleanup failed:", error));
}

export function registerMenu() {
  if (registeredMenus.length)
    return;
  registerItemMenus();
  registerFieldMenus();
}

function registerFieldMenus() {
  const isMenuVisible = (key: string): boolean => canRunJournalRule(key) && (getPref(`menu.${key}` as any, true) ?? true);

  const menus: FieldMenu[] = Rules
    .getAll()
    .filter((r): r is RuleForRegularScopeField => r.scope === "field" && Boolean(r.fieldMenu))
    .map(rule => ({
      menuType: "menuitem",
      l10nID: getLocaleID(rule.fieldMenu?.l10nID),
      icon,
      enableForTabTypes: rule.targetItemTypes,
      onShowing: (_event, context) => {
        const isPrefEnabled = isMenuVisible(rule.id);
        const visiable: boolean = isPrefEnabled && (rule.targetItemField === context.fieldName);
        context.setVisible(visiable);
        if (!visiable)
          return;

        // set enabled state: setDisabled returns true when item should be disabled
        const disabled: boolean = !context.editable || !context.items.some(item => item.isRegularItem() && isWritableItem(item)) || !!rule.fieldMenu?.setDisabled?.(context);
        context.setEnabled(!disabled);
      },
      onShown(event, context) {
        checkL10nString(context.menuElem, rule.id, rule.fieldMenu?.l10nID);
      },
      onCommand: (_event, context) => {
        if (!acceptCommand(_event))
          return;
        if (rule.fieldMenu?.onCommand) {
          rule.fieldMenu.onCommand(context);
          return;
        }
        addon.hooks.onLintInBatch(rule.id, context.items);
      },
    }));

  addMenu({
    pluginID: addon.data.config.addonID,
    menuID: "field-menu",
    target: "itemPane/info/row",
    menus,
  });
}

export function shouldShowSeparator(
  currentSection: string[],
  followingSections: string[][],
  isKeyVisible: (key: string) => boolean,
): boolean {
  const currentVisible = currentSection.some(isKeyVisible);
  const followingVisible = followingSections.some(sec => sec.some(isKeyVisible));
  return currentVisible && followingVisible;
}

export const MENU_SECTIONS = {
  primary: ["standard", "tool-update-metadata"],
  review: ["tool-review-metadata", "tool-review-duplicates"],
  title: ["correct-title-sentence-case", "correct-title-chemical-formula", "tool-title-guillemet", "tool-title-replace"],
  creators: ["correct-creators-case", "correct-creators-pinyin", "tool-creators-ext", "tool-creators-style", "tool-creators-swap"],
  publication: ["require-language", "tool-set-language", "correct-publication-title-alias", "correct-publication-title-case", "require-journal-abbr", "correct-conference-abbr", "require-university-place"],
  indexing: ["tool-query-esi", "tool-query-nature-index", "tool-update-easyscholar"],
  maintenance: ["correct-date-format", "no-doi-prefix", "tool-get-short-doi", "correct-attachment-roles", "tool-csl-helper", "tool-clean-extra", "tool-clear-all-extra", "tool-publication-replace", "show-data-directory", "show-profile-directory"],
} satisfies Record<string, string[]>;

export const MENU_GROUPS = Object.entries(MENU_SECTIONS).filter(([key]) => key !== "primary") as [Exclude<keyof typeof MENU_SECTIONS, "primary">, string[]][];

export function isPrimaryMenu(key: string) {
  return commandPrimary(key, getPref("menu.compact" as any, true) === true, getPref(`menu.primary.${key}` as any, MENU_SECTIONS.primary.includes(key)) === true);
}

function registerItemMenus() {
  const isMenuVisible = (key: string): boolean => canRunJournalRule(key) && commandVisible(key, getPref("menu.compact" as any, true) === true, (getPref(`menu.${key}` as any, true) ?? true) === true);
  const nestedVisible = (key: string) => isMenuVisible(key) && !isPrimaryMenu(key);
  const makeItem = (key: string, primary = false): ItemMenu => {
    const directory = key === "show-data-directory" || key === "show-profile-directory";
    const indexing = ["tool-query-esi", "tool-query-nature-index"].includes(key);
    const rule = key === "standard" ? undefined : Rules.getByID(key as ID);
    const custom = rule?.getItemMenu?.();
    const l10nID = directory ? getLocaleID(`menu-${key}` as any) : key === "standard" ? getLocaleID("menuitem-stdFormatFlow") : getLocaleID(custom?.l10nID || `rule-${key as ID}-menu-item` as Parameters<typeof getLocaleID>[0]);
    return {
      menuType: "menuitem",
      icon,
      l10nID,
      onShowing(_event, context) {
        context.setVisible(isMenuVisible(key) && isPrimaryMenu(key) === primary);
        const eligible = context.items?.filter(item => item.isRegularItem() && !item.deleted && (indexing || item.isEditable())
          && (!(rule?.scope === "item" || rule?.scope === "field") || !rule.targetItemTypes || rule.targetItemTypes.includes(item.itemType)));
        context.setEnabled((directory || (context.items ? !!eligible?.length : hasMenuItems(context)))
          && !(custom?.mutiltipleItems === false && (context.items?.length ?? 0) > 1));
      },
      onShown(_event, context) { checkL10nString(context.menuElem, key, l10nID); },
      async onCommand(_event, context) {
        if (!acceptCommand(_event) || !canRunJournalRule(key))
          return;
        if (directory) {
          await showZoteroDirectory(key === "show-data-directory" ? "data" : "profile");
          return;
        }
        const items = await menuItems(context);
        if (indexing) {
          const journals = items.filter(item => item.isRegularItem() && !item.deleted && item.itemType === "journalArticle");
          await Promise.all(journals.map(item => getJournalInsights(item, { queryAPI: true })));
          await redrawItemValues(journals.map(item => item.id));
          await refreshJournalPane(journals.map(item => item.id));
          return;
        }
        const rules = key === "correct-date-format"
          ? ["correct-date-format", "correct-filing-date-format", "correct-issue-date-format", "correct-priority-date-format"] as const
          : [key as ID | "standard"];
        if (key === "tool-update-metadata")
          await addon.hooks.onLintInBatch([...rules], items, { review: true });
        else if (key === "standard")
          await addon.hooks.onLintInBatch([...rules], items, { core: true });
        else
          await addon.hooks.onLintInBatch([...rules], items);
      },
    };
  };
  const sections = Object.values(MENU_SECTIONS);
  const menus: ItemMenu[] = [{
    menuType: "submenu",
    l10nID: getLocaleID("menuitem-label"),
    icon,
    onShowing(_event, context) {
      context.setVisible(Object.values(MENU_SECTIONS).flat().some(nestedVisible));
      context.setEnabled(["show-data-directory", "show-profile-directory"].some(isMenuVisible) || (context.items ? context.items.some(item => item.isRegularItem() && !item.deleted) : hasMenuItems(context)));
    },
    menus: sections.flatMap((keys, index): ItemMenu[] => [
      ...keys.map(key => makeItem(key)),
      ...(index < sections.length - 1
        ? [{ menuType: "separator", onShowing(_event, context) {
            context.setVisible(shouldShowSeparator(keys, sections.slice(index + 1), nestedVisible));
          } } as ItemMenu]
        : []),
    ]),
  }];
  menus.push(...sections.flat().map(key => makeItem(key, true)));
  for (const target of ["main/library/item", "main/library/collection"] as const) {
    addMenu({ pluginID: addon.data.config.addonID, menuID: target.endsWith("item") ? "item-menu" : "collection-menu", target, menus });
  }
}

function checkL10nString(menuElem: XULElement, ruleID: string, l10nID?: string) {
  // Since fluent.js is async, when menu first shown, the l10n string is not ready,
  // so we need to wait for i18n string to be ready
  setTimeout(() => {
    if (!menuElem.getAttribute("label") && !menuElem.textContent) {
      logger.warn(`Miss l10n string: ${l10nID}`);
      menuElem.setAttribute("label", `Miss l10n string (${ruleID})`);
    }
  }, 500);
}
