/** Contextual-menu item ids stay stable so handlers never guess by label. */
export const MENU_ID = {
  home: 1,
  back: 2,
  voice: 3,
  reply: 4,
  phone: 5,
  stop: 6,
  cancel: 7,
} as const;

export interface MenuEntry {
  id: number;
  label: string;
}

/**
 * The glasses contextual menu (tap then long press) is declared with each page.
 * Keep it a shortcut to the actions that are otherwise a screen or two away,
 * and nothing more: the menu should not become a second navigation tree.
 */
export function menuForScreen(
  screen: string,
  options: { hasSession: boolean; voiceEnabled: boolean },
): MenuEntry[] {
  if (screen === "voice") {
    return [
      { id: MENU_ID.stop, label: "Stop recording" },
      { id: MENU_ID.cancel, label: "Cancel" },
    ];
  }
  if (screen === "home" || screen === "pairing") return [];

  const replySurface = screen === "chat" || screen === "reply";
  if (options.hasSession && replySurface) {
    const items: MenuEntry[] = [];
    if (options.voiceEnabled) {
      items.push({ id: MENU_ID.voice, label: "Voice reply" });
    }
    if (screen === "chat") {
      items.push({ id: MENU_ID.reply, label: "Reply" });
    }
    items.push({ id: MENU_ID.phone, label: "Phone keyboard" });
    items.push({ id: MENU_ID.home, label: "Home" });
    items.push({ id: MENU_ID.back, label: "Back" });
    return items;
  }

  return [
    { id: MENU_ID.home, label: "Home" },
    { id: MENU_ID.back, label: "Back" },
  ];
}
