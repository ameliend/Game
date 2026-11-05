import Phaser from 'phaser';
import { BUILDINGS } from '../config/game';
import type { BuildingKind } from '../config/game';
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
export const commerceSignY = (size: number, kind?: BuildingKind) =>
  kind === 'hotel' ? -176 : -(34 + size * 6) - size * 24 * 0.34 - 24;
export function drawCommerce(g: Phaser.GameObjects.Graphics, kind: BuildingKind, size: number) {
  if (kind === 'hotel') return drawHotel(g, size);
  const c = BUILDINGS[kind],
    w = size * 48 * 0.68,
    h = size * 24 * 0.68,
    wall = 34 + size * 6;
  const pink = kind === 'nail_salon',
    white = kind === 'pharmacy',
    mega = kind === 'supermarket',
    hardware = kind === 'roy_merlin',
    chocolate = kind === 'chocolatier',
    warehouse = mega || hardware;
  polygon(
    g,
    [-w / 2, -h / 2, 0, 0, 0, -wall, -w / 2, -wall - h / 2],
    white ? 0xf9fff0 : pink ? 0xf6dfe9 : hardware ? 0xf5f3df : chocolate ? 0xf3d4ab : 0xf2dec0,
  );
  polygon(
    g,
    [0, 0, w / 2, -h / 2, w / 2, -wall - h / 2, 0, -wall],
    mega ? 0xb3ccda : white ? 0xd3e5d5 : pink ? 0xd9bad4 : 0xcab89a,
  );
  polygon(
    g,
    [-w / 2 - 4, -wall - h / 2, 0, -wall - h, w / 2 + 4, -wall - h / 2, 0, -wall],
    c.color,
  );
  g.lineStyle(3, mega ? 0xf0d459 : 0xfff2d5);
  g.lineBetween(-w / 2, -wall - h / 2, 0, -wall);
  g.lineBetween(0, -wall, w / 2, -wall - h / 2);
  // Wide shop windows and a glazed entrance, in place of house windows.
  g.fillStyle(mega ? 0x9fd9df : 0x80b9bf);
  g.fillRoundedRect(-w * 0.4, -wall + 10, w * 0.29, wall - 16, 2);
  g.fillRoundedRect(w * 0.1, -wall + 8, w * 0.23, wall - 18, 2);
  g.lineStyle(1, 0xf4f6e0);
  g.lineBetween(-w * 0.26, -wall + 10, -w * 0.26, -7);
  g.lineBetween(-w * 0.4, -wall + 20, -w * 0.12, -wall + 20);
  g.fillStyle(0x437782);
  g.fillRoundedRect(-5, -25, 13, 25, 2);
  g.lineStyle(1, 0xe9f4e2);
  g.lineBetween(1, -24, 1, -1);
  g.fillStyle(0xf7e6a3);
  g.fillCircle(5, -11, 1);
  if (warehouse) {
    g.fillStyle(hardware ? 0x579253 : 0xf1cd4a);
    g.fillRoundedRect(-w * 0.4, -wall + 1, w * 0.78, 9, 2);
    g.fillStyle(0x4b6c83);
    g.fillRoundedRect(-w * 0.17, -wall - h * 0.65, 16, 9, 2);
    g.fillRoundedRect(w * 0.1, -wall - h * 0.55, 13, 8, 2);
    g.fillStyle(0xb3aa87);
    g.fillRect(w * 0.3, -5, 11, 8);
  } else {
    g.fillStyle(0xfff6de);
    g.fillRoundedRect(-w * 0.42, -wall + 3, w * 0.82, 9, 2);
    for (let i = 0; i < 6; i++) {
      g.fillStyle(c.color);
      g.fillRect(-w * 0.42 + i * w * 0.14, -wall + 3, w * 0.07, 9);
    }
  }
  // A dedicated elevated sign for every shop.
  const y = commerceSignY(size, kind);
  g.fillStyle(0x4c635b);
  g.fillRect(-2, y + 10, 4, 17);
  g.fillStyle(0xfffcdf);
  g.fillRoundedRect(-24, y - 17, 48, 33, 9);
  g.lineStyle(2, c.color);
  g.strokeRoundedRect(-24, y - 17, 48, 33, 9);
  if (kind === 'gym') {
    // A weight bar and stacked plates identify the gym without relying on emoji fonts.
    g.lineStyle(5, 0x566b80);
    g.lineBetween(-18, y, 18, y);
    g.fillStyle(0x233f58);
    g.fillRoundedRect(-17, y - 10, 7, 20, 2);
    g.fillRoundedRect(10, y - 10, 7, 20, 2);
    g.fillStyle(0x65b8bc);
    g.fillRoundedRect(-10, y - 7, 4, 14, 1);
    g.fillRoundedRect(6, y - 7, 4, 14, 1);
    // Exercise equipment is visible through the wide front window.
    g.lineStyle(2, 0x294e65);
    g.lineBetween(-w * 0.35, -12, -w * 0.15, -12);
    g.lineBetween(-w * 0.3, -12, -w * 0.3, -24);
    g.lineBetween(-w * 0.2, -12, -w * 0.2, -24);
    g.lineBetween(-w * 0.33, -24, -w * 0.17, -24);
  } else if (kind === 'casino') {
    // Golden anatomical sign on a velvet-purple casino.
    g.lineStyle(2, 0x9c6b19);
    g.fillStyle(0xe9b92e);
    g.fillEllipse(0, y + 1, 30, 35);
    g.strokeEllipse(0, y + 1, 30, 35);
    g.fillStyle(0xffe69a);
    g.fillEllipse(-6, y - 5, 9, 15);
    g.lineStyle(2, 0xb18425);
    g.lineBetween(1, y - 15, 2, y + 13);
    g.fillStyle(0xffdd67);
    for (const dx of [-24, 24]) {
      g.fillCircle(dx, y - 9, 3);
      g.fillCircle(dx, y + 8, 3);
    }
  } else if (kind === 'coffeeshop') {
    g.fillStyle(0xfff4d8);
    g.fillRoundedRect(-12, y - 6, 22, 16, 4);
    g.lineStyle(3, 0xd7b480);
    g.strokeCircle(12, y, 6);
    g.fillStyle(0x75503a);
    g.fillEllipse(-1, y - 5, 21, 5);
    g.lineStyle(2, 0xbfaa8a);
    g.lineBetween(-5, y - 11, -3, y - 16);
    g.lineBetween(3, y - 11, 5, y - 16);
    g.lineStyle(2, 0x8a694b);
    g.lineBetween(-15, y + 12, 14, y + 12);
  } else if (kind === 'sexshop') {
    polygon(g, [-16, y - 9, 16, y - 9, 13, y + 1, 5, y + 11, -5, y + 11, -13, y + 1], 0xc7769d);
    g.lineStyle(2, 0x7e4e7a);
    g.lineBetween(-16, y - 9, 16, y - 9);
    g.lineBetween(-13, y - 4, -5, y + 11);
    g.lineBetween(13, y - 4, 5, y + 11);
    g.fillStyle(0xf3d4e2);
    g.fillCircle(0, y - 2, 2);
  } else if (kind === 'roy_merlin') {
    polygon(g, [-20, y + 10, 0, y - 13, 20, y + 10], 0x52925c);
    g.lineStyle(4, 0xb0804b);
    g.lineBetween(-6, y + 7, 7, y - 7);
    g.lineStyle(5, 0xd3d8ce);
    g.lineBetween(1, y - 10, 12, y - 1);
    g.fillStyle(0xc9a16d);
    for (let i = 0; i < 3; i++) g.fillRect(w * 0.29, -3 + i * 3, 20, 3);
  } else if (kind === 'chocolatier') {
    g.fillStyle(0x54362d);
    g.fillRoundedRect(-10, y - 13, 21, 26, 3);
    g.fillStyle(0x8a5540);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 2; col++) g.fillRoundedRect(-8 + col * 10, y - 11 + row * 8, 8, 6, 1);
    g.fillStyle(0xe6c778);
    g.fillRect(-11, y + 4, 23, 10);
    polygon(g, [-11, y + 4, 0, y + 10, 12, y + 4], 0xf9e7ab);
    g.fillStyle(0x654032);
    for (let i = 0; i < 3; i++) g.fillCircle(-w * 0.36 + i * 6, -17, 3);
  } else if (kind === 'bakery') {
    g.fillStyle(0xc97d32);
    g.fillEllipse(0, y + 1, 34, 18);
    g.fillStyle(0xf1bd5c);
    g.fillEllipse(0, y - 2, 31, 17);
    g.fillStyle(0xfffcdf);
    g.fillEllipse(0, y - 9, 21, 12);
    polygon(g, [-17, y, -21, y - 7, -10, y - 4], 0xe4a344);
    polygon(g, [17, y, 21, y - 7, 10, y - 4], 0xe4a344);
    g.lineStyle(2, 0xce893e);
    g.lineBetween(-7, y - 4, -5, y + 5);
    g.lineBetween(1, y - 3, 2, y + 6);
    g.lineBetween(8, y - 4, 7, y + 4);
  } else if (kind === 'butcher') {
    g.fillStyle(0xf0d5bd);
    g.fillEllipse(0, y, 36, 24);
    g.fillStyle(0xc84344);
    g.fillEllipse(-1, y, 30, 19);
    g.fillStyle(0xec7370);
    g.fillEllipse(-5, y - 2, 17, 11);
    g.fillStyle(0xffeedc);
    g.fillCircle(8, y, 4);
    g.lineStyle(1, 0xffc4a9);
    g.lineBetween(-11, y + 1, -4, y + 5);
    g.lineBetween(-5, y - 6, 1, y - 2);
  } else if (kind === 'pharmacy') {
    g.fillStyle(0x2f9b58);
    g.fillRect(-5, y - 12, 10, 24);
    g.fillRect(-13, y - 4, 26, 9);
  } else if (kind === 'barber') {
    g.lineStyle(3, 0x607f8c);
    g.strokeCircle(-8, y + 6, 5);
    g.strokeCircle(8, y + 6, 5);
    g.lineBetween(-5, y + 2, 10, y - 11);
    g.lineBetween(5, y + 2, -10, y - 11);
    g.fillStyle(0xe4b861);
    g.fillCircle(0, y, 2);
    g.fillStyle(0xf4f4dc);
    g.fillRoundedRect(-w * 0.48, -29, 5, 25, 2);
    g.lineStyle(2, 0xc75555);
    for (let i = 0; i < 3; i++) g.lineBetween(-w * 0.48, -26 + i * 7, -w * 0.48 + 5, -22 + i * 7);
  } else if (kind === 'nail_salon') {
    g.fillStyle(0xe7ac9b);
    g.fillRoundedRect(-9, y - 12, 18, 25, 8);
    g.fillStyle(0xe37fab);
    g.fillRoundedRect(-7, y - 11, 14, 19, 6);
    g.lineStyle(2, 0xffd8eb);
    g.lineBetween(-3, y - 7, -3, y + 1);
    g.fillStyle(0xffefbd);
    g.fillCircle(14, y - 7, 2);
  } else if (mega) {
    g.lineStyle(3, 0x416d96);
    g.lineBetween(-12, y - 9, -9, y - 9);
    g.lineBetween(-9, y - 9, -5, y + 5);
    g.strokeRect(-6, y - 7, 20, 10);
    g.fillStyle(0xd6aa33);
    g.fillCircle(-3, y + 9, 3);
    g.fillCircle(11, y + 9, 3);
  } else {
    g.fillStyle(0xd6b46a);
    g.fillCircle(0, y, 11);
    g.lineStyle(2, 0x705b42);
    g.lineBetween(-6, y - 8, -6, y + 9);
    g.lineBetween(5, y - 8, 5, y + 9);
    g.lineBetween(-9, y - 6, -3, y - 6);
  }
  return { signY: y, width: w };
}

function drawHotel(g: Phaser.GameObjects.Graphics, size: number) {
  const w = size * 48 * 0.74,
    h = size * 24 * 0.68,
    wall = 112,
    y = commerceSignY(size, 'hotel');
  polygon(g, [-w / 2, -h / 2, 0, 0, 0, -wall, -w / 2, -wall - h / 2], 0xf5dfb7);
  polygon(g, [0, 0, w / 2, -h / 2, w / 2, -wall - h / 2, 0, -wall], 0xc0c9cc);
  polygon(
    g,
    [-w / 2 - 3, -wall - h / 2, 0, -wall - h, w / 2 + 3, -wall - h / 2, 0, -wall],
    0x58768e,
  );
  g.lineStyle(3, 0xe7c178);
  g.lineBetween(-w / 2, -wall - h / 2, 0, -wall);
  g.lineBetween(0, -wall, w / 2, -wall - h / 2);
  for (let floor = 0; floor < 3; floor++) {
    const yy = -97 + floor * 27;
    for (const x of [-w * 0.37, -w * 0.17, w * 0.12, w * 0.31]) {
      g.fillStyle(0x668f9b);
      g.fillRoundedRect(x, yy, 11, 16, 2);
      g.fillStyle(0xf4df9b);
      g.fillRect(x + 2, yy + 2, 3, 11);
      g.lineStyle(1, 0xf8efd4);
      g.strokeRect(x - 2, yy + 14, 15, 4);
    }
  }
  g.fillStyle(0x4d6573);
  g.fillRoundedRect(-10, -25, 20, 25, 3);
  g.lineStyle(1, 0xf7deb4);
  g.lineBetween(0, -24, 0, 0);
  polygon(g, [-24, -27, -3, -35, 24, -27, 2, -18], 0xb87360);
  g.lineStyle(2, 0xe6c594);
  g.lineBetween(-18, -23, -18, 2);
  g.lineBetween(18, -23, 18, 2);
  g.fillStyle(0xbfa86b);
  g.fillRect(-2, y + 15, 4, 25);
  g.fillStyle(0x405f80);
  g.fillRoundedRect(-21, y - 17, 42, 35, 6);
  g.lineStyle(2, 0xe6c77c);
  g.strokeRoundedRect(-21, y - 17, 42, 35, 6);
  g.lineStyle(4, 0xffecb7);
  g.lineBetween(-7, y - 11, -7, y + 6);
  g.lineBetween(7, y - 11, 7, y + 6);
  g.lineBetween(-7, y - 3, 7, y - 3);
  g.fillStyle(0xe4be66);
  for (let i = 0; i < 4; i++) g.fillCircle(-12 + i * 8, y + 12, 2);
  return { signY: y, width: w };
}
