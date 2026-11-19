/** Contextual-menu item ids stay stable so handlers never guess by label. */
export const MENU_ID = {
  stop: 1,
  bottom: 2,
} as const;

export interface MenuEntry {
  id: number;
  label: string;
}

/**
 * The glasses contextual menu (tap then long press) is the shortcut surface for
 * the chat. Stop is first when there is a turn to interrupt, and it opens a
 * confirmation screen; scroll-to-bottom is the quiet convenience below it.
 */
export function menuForScreen(
  screen: string,
  options: { canInterrupt?: boolean } = {},
): MenuEntry[] {
  if (screen !== "chat") return [];
  const items: MenuEntry[] = [];
  if (options.canInterrupt) items.push({ id: MENU_ID.stop, label: "Stop agent" });
  items.push({ id: MENU_ID.bottom, label: "Scroll to the bottom" });
  return items;
}
