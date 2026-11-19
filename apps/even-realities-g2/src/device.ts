export interface GlassesSnapshot {
  batteryLevel?: number;
  charging?: boolean;
  inCase?: boolean;
  wearing?: boolean;
}

/**
 * Whether the app should keep polling. Unknown hosts (or older firmware that
 * never reports status) stay awake, so the app behaves as before.
 *
 * Painting is deliberately not gated on this: a stale or wrong wear-sensor
 * reading must never leave a reload stuck on the boot screen. The stream keeps
 * the data fresh; polling is only a fallback.
 */
export function deviceAwake(snapshot: GlassesSnapshot, known: boolean): boolean {
  if (!known) return true;
  if (snapshot.inCase === true) return false;
  if (snapshot.wearing === false) return false;
  return true;
}

/** One line for the Settings body; empty until the host reports a battery. */
export function glassesStatusLabel(
  snapshot: GlassesSnapshot,
  known: boolean,
): string {
  if (!known || snapshot.batteryLevel === undefined) return "";
  const parts = [`${snapshot.batteryLevel}%`];
  if (snapshot.charging) parts.push("charging");
  else if (snapshot.inCase) parts.push("in case");
  else if (snapshot.wearing === false) parts.push("not worn");
  return `Glasses · ${parts.join(" · ")}`;
}
