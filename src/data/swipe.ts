export function swipeIntent(dx: number, dy: number) {
  if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) return "scroll";
  if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 2)
    return dx < 0 ? "left" : "right";
  return "pending";
}

export function shouldExcludeSwipe(dx: number, dy: number) {
  return dx <= -72 && swipeIntent(dx, dy) === "left";
}

export function shouldConfirmSwipe(dx: number, dy: number) {
  return dx >= 72 && swipeIntent(dx, dy) === "right";
}
