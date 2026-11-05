import Phaser from 'phaser';
const polygon = (g: Phaser.GameObjects.Graphics, points: number[], color: number) => {
  g.fillStyle(color);
  g.fillPoints(
    points.reduce<Phaser.Geom.Point[]>(
      (p, _, i) => (i % 2 ? p : [...p, new Phaser.Geom.Point(points[i], points[i + 1])]),
      [],
    ),
    true,
  );
};
export const TOWNHALL_TOP = -135;
export function drawTownHall(g: Phaser.GameObjects.Graphics, size: number) {
  const w = size * 48 * 0.75,
    h = size * 24 * 0.68;
  // Monumental base and wide steps, stone facade, symmetric colonnade.
  polygon(g, [-w / 2 - 4, -h / 2 + 9, 0, 12, w / 2 + 4, -h / 2 + 9, 0, -h + 8], 0xaaa995);
  for (let i = 0; i < 3; i++) {
    g.fillStyle(i % 2 ? 0xd7d7bf : 0xe8e6d1);
    g.fillRoundedRect(-w * 0.41 + i * 3, -8 - i * 5, w * 0.82 - i * 6, 7, 1);
  }
  polygon(g, [-w / 2, -h / 2, 0, 0, 0, -55, -w / 2, -55 - h / 2], 0xf3ecd9);
  polygon(g, [0, 0, w / 2, -h / 2, w / 2, -55 - h / 2, 0, -55], 0xcecbb9);
  polygon(g, [-w / 2 - 4, -55 - h / 2, 0, -55 - h, w / 2 + 4, -55 - h / 2, 0, -55], 0x506c80);
  g.fillStyle(0x526c79);
  g.fillRoundedRect(-14, -49, 28, 42, 7);
  g.lineStyle(2, 0xe2cc8b);
  g.lineBetween(0, -47, 0, -8);
  g.fillStyle(0xe9d291);
  g.fillCircle(-4, -24, 1.5);
  g.fillCircle(4, -24, 1.5);
  for (const x of [-39, -26, 26, 39]) {
    g.fillStyle(0xb7b5a5);
    g.fillRect(x + 3, -53, 7, 44);
    g.fillStyle(0xfff9e5);
    g.fillRect(x, -53, 7, 44);
    g.fillStyle(0xe1d7bd);
    g.fillRect(x - 3, -57, 13, 5);
    g.fillRect(x - 3, -12, 13, 6);
  }
  g.fillStyle(0xe8e1c9);
  g.fillRect(-w * 0.48, -64, w * 0.96, 11);
  polygon(g, [-w * 0.51, -64, 0, -99, w * 0.51, -64], 0xf6ecd1);
  polygon(g, [-w * 0.4, -67, 0, -91, w * 0.4, -67], 0xc7bfa5);
  g.fillStyle(0xfff9df);
  g.fillCircle(0, -77, 10);
  g.lineStyle(2, 0x65717a);
  g.strokeCircle(0, -77, 10);
  g.lineBetween(0, -77, 0, -83);
  g.lineBetween(0, -77, 5, -74);
  g.fillStyle(0xb59955);
  g.fillCircle(0, -77, 2);
  // Roof crest and two tricolour flags make the public building unmistakable.
  g.fillStyle(0xd3b76c);
  g.fillCircle(0, -102, 3);
  for (const x of [-40, 40]) {
    g.lineStyle(2, 0x606d72);
    g.lineBetween(x, -80, x, -123);
    g.fillStyle(0x426aab);
    g.fillRect(x, -122, 6, 15);
    g.fillStyle(0xfff9e8);
    g.fillRect(x + 6, -122, 6, 15);
    g.fillStyle(0xc96359);
    g.fillRect(x + 12, -122, 6, 15);
  }
  g.fillStyle(0x567884);
  g.fillRoundedRect(-20, -59, 40, 9, 2);
  // Side windows under a stone cornice.
  g.fillStyle(0x7599a3);
  g.fillRoundedRect(w * 0.31, -49, 9, 16, 2);
  g.fillRoundedRect(w * 0.31, -26, 9, 14, 2);
}
export function drawFarm(g: Phaser.GameObjects.Graphics, size: number) {
  const w = size * 48 * 0.68,
    h = size * 24 * 0.68;
  polygon(g, [-w / 2, 0, 0, -h / 2, w / 2, 0, 0, h / 2], 0x91ac65);
  // Small golden crop rows within the farm's own footprint.
  polygon(g, [-w * 0.44, 1, -w * 0.1, -h * 0.22, w * 0.15, 0, -w * 0.2, h * 0.22], 0x9b7950);
  g.lineStyle(2, 0xe0bd66);
  for (let i = 0; i < 5; i++) {
    const x = -w * 0.35 + i * 8;
    g.lineBetween(x, 4, x + 12, -3);
    g.lineBetween(x + 2, 0, x + 2, -9);
    g.lineBetween(x + 8, -4, x + 8, -13);
  }
  // Red barn and distinctive gambrel roof.
  g.fillStyle(0xb96450);
  g.fillRoundedRect(-14, -57, 60, 47, 2);
  polygon(g, [-19, -56, -5, -82, 13, -96, 34, -86, 52, -56], 0x6d6152);
  polygon(g, [-14, -57, 1, -78, 14, -86, 28, -78, 46, -57], 0xc07256);
  g.fillStyle(0xefdfb8);
  g.fillRect(3, -47, 29, 37);
  g.fillStyle(0x805946);
  g.fillRect(6, -44, 23, 34);
  g.lineStyle(2, 0xeddcb6);
  g.lineBetween(7, -43, 28, -12);
  g.lineBetween(28, -43, 7, -12);
  g.lineBetween(17, -44, 17, -10);
  g.fillStyle(0xb7b8a3);
  g.fillRoundedRect(42, -66, 21, 58, 4);
  g.fillStyle(0xe0ddc6);
  g.fillEllipse(52, -66, 22, 10);
  polygon(g, [41, -66, 52, -79, 64, -66], 0x8b9a92);
  g.lineStyle(1, 0x949f94);
  for (let i = 0; i < 4; i++) g.lineBetween(44, -52 + i * 11, 60, -52 + i * 11);
  // Fence, hay and a tiny green tractor complete the rural silhouette.
  g.lineStyle(3, 0xe8ddbb);
  g.lineBetween(-w / 2 + 3, 12, 8, h / 2 - 2);
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + 3 + i * 17;
    g.lineBetween(x, 5 + i * 3, x, 18 + i * 3);
  }
  g.fillStyle(0xddbd6d);
  g.fillRoundedRect(-40, -33, 17, 18, 4);
  g.lineStyle(1, 0xbc9456);
  g.strokeEllipse(-31, -24, 12, 14);
  g.fillStyle(0x4d7358);
  g.fillRoundedRect(19, 7, 25, 10, 2);
  g.fillRect(23, -3, 11, 13);
  g.fillStyle(0x9fced0);
  g.fillRect(25, -1, 7, 6);
  g.fillStyle(0x48544b);
  g.fillCircle(25, 18, 7);
  g.fillCircle(41, 18, 5);
  g.fillStyle(0xd0ba71);
  g.fillCircle(25, 18, 3);
}
