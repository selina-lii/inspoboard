// Colors shared by the 2D and 3D views.

/** Each link group gets a stable color. */
export function groupColor(group: string): string {
  let hash = 0;
  for (const char of group) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 65%)`;
}
