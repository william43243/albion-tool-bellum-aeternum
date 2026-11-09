/** Screen coordinates and measured root dimensions are in React Native points.
 * Cap the viewport at the IME top rather than subtracting keyboard height:
 * adjustResize may already have reduced the root. Never subtract twice.
 */
export function keyboardViewportHeight(rootHeight: number, rootScreenY: number, keyboardScreenY: number | null): number | undefined {
  if (keyboardScreenY === null || !Number.isFinite(keyboardScreenY) || keyboardScreenY <= 0
      || !Number.isFinite(rootHeight) || rootHeight <= 0 || !Number.isFinite(rootScreenY)) return undefined;
  return Math.min(rootHeight, Math.max(0, keyboardScreenY - rootScreenY));
}
