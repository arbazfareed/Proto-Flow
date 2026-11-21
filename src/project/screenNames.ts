// B60: a new screen is called "Screen 2", "Screen 3", ... instead of being named after the device
// ("Desktop 1440 x 900"), which looked like a setting and was hard to tell apart. The device is still
// shown next to the name, and a screen can be renamed by double-clicking it.
export function nextScreenName(screens: ReadonlyArray<{ name: string }>): string {
  const taken = new Set(screens.map((screen) => screen.name.trim().toLowerCase()));
  for (let number = screens.length + 1; ; number += 1) {
    const candidate = `Screen ${number}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
