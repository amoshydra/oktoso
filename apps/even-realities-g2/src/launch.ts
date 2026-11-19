export type LaunchSourceName = "appMenu" | "glassesMenu";

export type Landing = "inbox" | "chat" | "home";

/**
 * Where the app lands when the OS hands it a launch source.
 *
 * The glasses menu is the "what needs me" entry, the app menu is "back to my
 * work". A reload keeps the old behaviour (Home) because it is a build refresh,
 * not a launch.
 */
export function landingScreen(input: {
  source?: LaunchSourceName;
  hasSession: boolean;
  reloaded: boolean;
}): Landing {
  if (input.reloaded) return "home";
  if (input.source === "glassesMenu") return "inbox";
  if (input.source === "appMenu" && input.hasSession) return "chat";
  return "home";
}
