/** Contextual-menu item ids stay stable so handlers never guess by label. */
export const MENU_ID = {
  bottom: 1,
} as const;

export interface MenuEntry {
  id: number;
  label: string;
}

/**
 * The glasses contextual menu (tap then long press) carries one shortcut: jump
 * to the newest chat line. Reply and voice reply already have first-class entry
 * points, so repeating them here only adds noise.
 */
export function menuForScreen(screen: string): MenuEntry[] {
  if (screen !== "chat") return [];
  return [{ id: MENU_ID.bottom, label: "Scroll to the bottom" }];
}
