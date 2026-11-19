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
 * the chat. Stop is always first: it is idempotent ("make it not running"), the
 * provider no-ops cleanly when nothing is running, and the confirmation screen
 * is the safety, not a state guess. Scroll-to-bottom sits below it.
 */
export function menuForScreen(screen: string): MenuEntry[] {
  if (screen !== "chat") return [];
  return [
    { id: MENU_ID.stop, label: "Stop agent" },
    { id: MENU_ID.bottom, label: "Scroll to the bottom" },
  ];
}
