/**
 * Resolves the Zotero host object across Gecko `loadSubScript(..., ctx)` sandboxes
 * (`Zotero` / `_globalThis.Zotero`) and unit test environments (`globalThis.Zotero`).
 */
export function resolveZoteroHost(): any {
  if (typeof Zotero !== "undefined" && Zotero)
    return Zotero;
  if (typeof _globalThis !== "undefined" && (_globalThis as any)?.Zotero)
    return (_globalThis as any).Zotero;
  return (globalThis as any).Zotero;
}

/**
 * Resolves the active MetaFlow `Addon` instance across Gecko `loadSubScript(..., ctx)`
 * sandboxes (`addon` / `_globalThis.addon` / `Zotero.MetaRef`) and unit test environments.
 * Note: In Gecko `Services.scriptloader.loadSubScript(url, ctx)`, `addon` lives on `ctx`
 * (`_globalThis`), NOT on the outer BackstagePass `globalThis`.
 */
export function resolveAddonHost(): any {
  if (typeof addon !== "undefined" && addon)
    return addon;
  if (typeof _globalThis !== "undefined" && (_globalThis as any)?.addon)
    return (_globalThis as any).addon;
  const hostAddon = (globalThis as any).addon;
  if (hostAddon)
    return hostAddon;
  return resolveZoteroHost()?.MetaRef;
}
