type Position = { id: string; x: number; y: number };
// Separate sprites sharing a tile without changing their logical/server position.
export function residentOffset(
  resident: Position,
  all: Position[],
  self: { x: number; y: number },
) {
  const peers = all
    .filter((p) => p.x === resident.x && p.y === resident.y)
    .sort((a, b) => a.id.localeCompare(b.id));
  const index = peers.findIndex((p) => p.id === resident.id),
    sameAsSelf = self.x === resident.x && self.y === resident.y;
  return {
    x: sameAsSelf
      ? (index % 2 === 0 ? 1 : -1) * (Math.floor(index / 2) + 1) * 30
      : (index - (peers.length - 1) / 2) * 30,
    labelY: -66 - (index % 2) * 17,
  };
}
