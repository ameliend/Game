import Phaser from 'phaser';
import { BUILDINGS, CROPS, RULES, PLACEABLES, EXILE_ISLAND, isCommerce } from '../config/game';
import type { Avatar, Placement, Selection, World } from '../types';
import { drawTownHall, drawFarm, TOWNHALL_TOP } from './landmarkArt';
import { drawCommerce, commerceSignY } from './commerceArt';
import { residentOffset } from '../utils/residents';
import { incomeStatus, electionOpen } from '../utils/civic';
import {
  buildable,
  cropState,
  worldLand,
  exileLand,
  playerSpawn,
  pathTo,
  walkable,
} from '../utils/rules';
const W = 48,
  H = 24;
const iso = (x: number, y: number) => ({ x: ((x - y) * W) / 2, y: ((x + y) * H) / 2 });
const uniso = (x: number, y: number) => ({
  x: Math.round(x / W + y / H),
  y: Math.round(y / H - x / W),
});
export class IslandScene extends Phaser.Scene {
  world!: World;
  playerAvatar?: Avatar;
  placement: Placement = null;
  offset = 0;
  onSelect!: (s: Selection) => void;
  onPlace!: (x: number, y: number) => void;
  private terrain!: Phaser.GameObjects.Graphics;
  private objects!: Phaser.GameObjects.Container;
  private ghost!: Phaser.GameObjects.Graphics;
  private avatar!: Phaser.GameObjects.Container;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private pos = { ...RULES.spawn };
  private walking = false;
  private lastKey = 0;
  private dragStart?: { x: number; y: number; cx: number; cy: number };
  private dragged = false;
  private pinch = 0;
  private lastClock = 0;
  private visualKey = '';
  private pendingGuests: { id: string; x: number; y: number; avatar: Avatar; username: string }[] =
    [];
  private guests = new Map<string, Phaser.GameObjects.Container>();
  onPosition?: (x: number, y: number) => void;
  constructor() {
    super('island');
  }
  create() {
    this.cameras.main.setBackgroundColor('#72c9cd');
    this.terrain = this.add.graphics();
    this.objects = this.add.container();
    this.ghost = this.add.graphics().setDepth(2000);
    this.drawTerrain();
    this.avatar = this.makeAvatar(
      this.playerAvatar ?? this.world.avatar,
      this.world.governance?.mayor_id === this.world.profile.id,
    );
    this.avatar.setDepth(1500);
    const spawn = playerSpawn(this.world);
    this.placeAvatar(spawn.x, spawn.y);
    this.onPosition?.(spawn.x, spawn.y);
    this.redraw();
    this.setGuests(this.pendingGuests);
    this.center();
    this.scale.on('resize', this.fit, this);
    this.input.addPointer(2);
    this.input.keyboard?.disableGlobalCapture();
    // Phaser's default capture calls preventDefault on these letters globally.
    // Observe movement keys without consuming text typed in the React interface.
    this.keys = this.input.keyboard!.addKeys('UP,DOWN,LEFT,RIGHT,Z,Q,S,D,W,A,ESC', false) as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) =>
      this.zoom(dy > 0 ? 0.9 : 1.1),
    );
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragged = false;
      this.dragStart = {
        x: p.x,
        y: p.y,
        cx: this.cameras.main.scrollX,
        cy: this.cameras.main.scrollY,
      };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const touches = this.input.manager.pointers.filter((p) => p.isDown);
      if (touches.length >= 2) {
        const d = Phaser.Math.Distance.Between(
          touches[0].x,
          touches[0].y,
          touches[1].x,
          touches[1].y,
        );
        if (this.pinch) this.zoom(d / this.pinch);
        this.pinch = d;
        this.dragged = true;
        return;
      }
      const point = uniso(p.worldX, p.worldY);
      this.drawGhost(point.x, point.y);
      if (
        p.isDown &&
        this.dragStart &&
        Phaser.Math.Distance.Between(p.x, p.y, this.dragStart.x, this.dragStart.y) > 8
      ) {
        this.dragged = true;
        this.cameras.main.scrollX =
          this.dragStart.cx - (p.x - this.dragStart.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY =
          this.dragStart.cy - (p.y - this.dragStart.y) / this.cameras.main.zoom;
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.pinch = 0;
      if (this.dragged) return;
      const pt = this.cameras.main.getWorldPoint(p.x, p.y);
      const tile = uniso(pt.x, pt.y);
      this.select(tile.x, tile.y);
    });
  }
  fit() {
    if (this.world.exile) {
      this.cameras.main.setZoom(1.5);
      return;
    }
    const z = Phaser.Math.Clamp(
      Math.min(this.scale.width / 2100, this.scale.height / 1400),
      0.25,
      1.15,
    );
    this.cameras.main.setZoom(z);
  }
  zoom(f: number) {
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom * f, 0.25, 2.5));
  }
  focusTile(x: number, y: number) {
    const p = iso(x, y);
    this.cameras.main.centerOn(p.x, p.y);
  }
  center() {
    if (this.world.exile) this.focusTile(EXILE_ISLAND.spawn.x, EXILE_ISLAND.spawn.y);
    else this.cameras.main.centerOn(0, ((RULES.size - 1) * H) / 2);
    this.fit();
  }
  polygon(g: Phaser.GameObjects.Graphics, pts: number[], color: number, alpha = 1) {
    g.fillStyle(color, alpha);
    g.fillPoints(
      pts.reduce<Phaser.Geom.Point[]>(
        (arr, _, i) => (i % 2 ? arr : [...arr, new Phaser.Geom.Point(pts[i], pts[i + 1])]),
        [],
      ),
      true,
    );
  }
  diamond(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    alpha = 1,
  ) {
    this.polygon(g, [x, y - h / 2, x + w / 2, y, x, y + h / 2, x - w / 2, y], color, alpha);
  }
  drawTerrain() {
    const g = this.terrain;
    const land = (x: number, y: number) => worldLand(this.world, x, y);
    // Local vector artwork, no external image requests.
    for (let i = 0; i < 60; i++) {
      const x = ((i * 211) % 1600) - 800,
        y = ((i * 137) % 1000) - 100;
      g.lineStyle(1, 0xd8f5ed, 0.22);
      g.strokeEllipse(x, y, 18 + (i % 4) * 12, 5);
    }
    for (let y = 0; y < RULES.size; y++)
      for (let x = 0; x < Math.max(RULES.size, EXILE_ISLAND.x + EXILE_ISLAND.size); x++)
        if (land(x, y)) {
          const p = iso(x, y),
            edge =
              !land(x + 1, y) ||
              !land(x - 1, y) ||
              !land(x, y + 1) ||
              !land(x, y - 1) ||
              !land(x + 2, y) ||
              !land(x, y + 2);
          this.diamond(g, p.x, p.y + 9, W, H, 0xba9d72);
          this.diamond(
            g,
            p.x,
            p.y,
            W,
            H,
            exileLand(x, y) || edge ? 0xf0db9e : (x * 7 + y * 3) % 5 === 0 ? 0x89b77b : 0x92be80,
          );
          if (!edge && !exileLand(x, y) && (x * 13 + y * 7) % 17 === 0) {
            g.lineStyle(1, 0x639765, 0.5);
            g.lineBetween(p.x - 3, p.y, p.x - 1, p.y - 3);
            g.lineBetween(p.x + 2, p.y, p.x + 4, p.y - 2);
          }
        }
    // Decorative boulders sit outside the playable land.
    for (const [x, y] of [
      [2, 25],
      [52, 9],
      [48, 50],
    ]) {
      const p = iso(x, y);
      g.fillStyle(0x5eaaa9, 0.25);
      g.fillEllipse(p.x, p.y + 4, 36, 14);
      g.fillStyle(0xa6b9a8);
      g.fillEllipse(p.x, p.y - 3, 30, 20);
      g.fillStyle(0xc4d0ba);
      g.fillEllipse(p.x - 5, p.y - 7, 18, 12);
    }
    // A small dock on the south shore.
    for (let i = 0; i < 5; i++) {
      const p = iso(29 + i, 54);
      this.diamond(g, p.x, p.y, 44, 23, 0xa77b50);
      g.lineStyle(1, 0x795a42);
      g.lineBetween(p.x - 18, p.y, p.x + 2, p.y + 9);
    }
  }
  private visualStateKey() {
    const now = Date.now() + this.offset;
    return (
      this.world.plantations.map((p) => cropState(p.planted_at, now)).join(',') +
      '|' +
      this.world.buildings
        .filter((b) => isCommerce(b.kind))
        .map(
          (b) =>
            incomeStatus(
              b,
              now,
              this.world.governance?.regime ?? 'communism',
              this.world.profile.id,
            ).ready,
        )
        .join(',') +
      '|' +
      electionOpen(this.world.governance?.election, now)
    );
  }
  redraw() {
    if (!this.objects) return;
    this.visualKey = this.visualStateKey();
    this.objects.removeAll(true);
    const now = Date.now() + this.offset;
    for (const t of this.world.trees) {
      if (t.cut_at) continue;
      const p = iso(t.x, t.y),
        g = this.add.graphics();
      g.setPosition(p.x, p.y)
        .setDepth(t.x + t.y)
        .setName(`tree:${t.id}`);
      g.fillStyle(0x386f55, 0.18);
      g.fillEllipse(0, 2, 38, 15);
      if (t.id % 3 === 0) {
        g.lineStyle(7, 0xb18c54);
        g.lineBetween(0, 0, 4, -49);
        g.lineStyle(1, 0x896e45);
        for (let k = 0; k < 6; k++) g.lineBetween(-2, -k * 7, 5, -k * 7 - 2);
        const leaves = [
          [-35, -47],
          [-27, -65],
          [0, -76],
          [30, -65],
          [39, -45],
          [20, -33],
        ];
        for (const [lx, ly] of leaves) {
          this.polygon(
            g,
            [4, -50, lx * 0.65, ly - 5, lx, ly, lx * 0.6, ly + 8],
            ly < -60 ? 0x4f9564 : 0x377e59,
          );
        }
        g.fillStyle(0x98764b);
        g.fillCircle(2, -47, 4);
        g.fillCircle(8, -45, 4);
      } else {
        g.fillStyle(0x9e7546);
        g.fillRoundedRect(-4, -43, 8, 44, 2);
        g.fillStyle(0x397c59);
        g.fillCircle(0, -52, 24);
        g.fillCircle(-14, -40, 18);
        g.fillCircle(16, -40, 18);
        g.fillStyle(0x559765);
        g.fillCircle(-6, -57, 18);
        g.fillStyle(0x73ac70);
        g.fillCircle(-11, -61, 10);
      }
      this.objects.add(g);
      const zone = this.add
        .zone(p.x, p.y - 28, 60, 76)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setDepth(t.x + t.y + 0.1);
      zone.on(
        'pointerup',
        (
          pointer: Phaser.Input.Pointer,
          _x: number,
          _y: number,
          event: Phaser.Types.Input.EventData,
        ) => {
          if (this.dragged || this.placement) return;
          event.stopPropagation();
          this.onSelect({ type: 'tree', id: t.id, x: t.x, y: t.y });
        },
      );
      this.objects.add(zone);
    }
    for (const plot of this.world.plots) {
      const p = iso(plot.x, plot.y),
        g = this.add
          .graphics()
          .setPosition(p.x, p.y)
          .setDepth(plot.x + plot.y);
      this.diamond(g, 0, 1, 43, 21, 0x8c6649);
      for (let i = -1; i <= 1; i++) {
        g.lineStyle(1, 0xb18a60);
        g.lineBetween(-12 + i * 4, -2 - i * 2, 3 + i * 4, 5 - i * 2);
      }
      if (plot.owner_id) {
        g.lineStyle(2, plot.owner_id === this.world.profile.id ? 0x4bad82 : 0xd09e58);
        g.strokePoints(
          [
            new Phaser.Geom.Point(0, -9),
            new Phaser.Geom.Point(21, 1),
            new Phaser.Geom.Point(0, 11),
            new Phaser.Geom.Point(-21, 1),
          ],
          true,
        );
      }
      const plant = this.world.plantations.find((v) => v.plot_id === plot.id);
      if (plant) {
        const state = cropState(plant.planted_at, now),
          c = state === 'withered' ? 0xa59969 : 0x4e8d4f;
        for (const [xx, yy] of [
          [-7, 0],
          [6, -2],
        ]) {
          g.lineStyle(2, c);
          g.lineBetween(xx, yy, xx, yy - (state === 'sprout' ? 7 : 16));
          g.fillStyle(c);
          g.fillEllipse(xx - 3, yy - 8, 8, 4);
          g.fillEllipse(xx + 3, yy - 11, 8, 4);
          if (state === 'mature') {
            g.fillStyle(CROPS[plant.crop].color);
            g.fillCircle(xx, yy - 17, 5);
          }
        }
      }
      this.objects.add(g);
    }
    for (const b of this.world.buildings) {
      const p = iso(b.x + (b.size - 1) / 2, b.y + (b.size - 1) / 2),
        g = this.add
          .graphics()
          .setPosition(p.x, p.y)
          .setDepth(b.x + b.y + b.size * 2)
          .setName(`building:${b.id}`);
      const cfg = BUILDINGS[b.kind],
        w = b.size * W * 0.68,
        h = b.size * H * 0.68;
      g.fillStyle(0x356951, 0.18);
      g.fillEllipse(3, 5, w + 10, h + 6);
      if (isCommerce(b.kind)) {
        drawCommerce(g, b.kind, b.size);
      } else if (b.kind === 'townhall') {
        drawTownHall(g, b.size);
      } else if (b.kind === 'farm') {
        drawFarm(g, b.size);
      } else if (b.kind === 'road') {
        this.diamond(g, 0, 0, 44, 22, 0xcbbd9a);
      } else if (b.kind === 'park') {
        this.diamond(g, 0, 0, w, h, 0x659f65);
        g.fillStyle(0x916c46);
        g.fillRect(-4, -25, 5, 24);
        g.fillStyle(0x418963);
        g.fillCircle(0, -33, 19);
        g.fillStyle(0xdbb176);
        g.fillRoundedRect(15, -9, 18, 5, 2);
      } else if (b.kind === 'fountain') {
        g.fillStyle(0x9baaa1);
        g.fillEllipse(0, -2, 34, 20);
        g.fillStyle(0x75cbd7);
        g.fillEllipse(0, -5, 27, 13);
        g.fillStyle(0xd9e3ce);
        g.fillRect(-3, -28, 6, 23);
        g.fillStyle(0xc2f0e7);
        g.fillEllipse(0, -28, 19, 7);
        g.lineStyle(2, 0xb8eeed);
        g.lineBetween(0, -29, 0, -38);
      } else {
        const height = 28 + b.size * 6;
        this.polygon(g, [-w / 2, -h / 2, 0, 0, 0, -height, w / -2, -height - h / 2], 0xe9d8aa);
        this.polygon(g, [0, 0, w / 2, -h / 2, w / 2, -height - h / 2, 0, -height], 0xcdbb93);
        this.polygon(
          g,
          [
            -w / 2 - 4,
            -height - h / 2,
            0,
            -height - h - 19,
            w / 2 + 4,
            -height - h / 2,
            0,
            -height + 1,
          ],
          cfg.color,
        );
        g.fillStyle(0x638e92);
        g.fillRoundedRect(-w / 3, -height + 7, 9, 12, 2);
        g.fillStyle(0x8bbcb7);
        g.fillRoundedRect(w / 5, -height + 7, 9, 10, 2);
        g.fillStyle(0x866747);
        g.fillRoundedRect(-7, -20, 11, 20, 2);
        if (b.kind === 'hospital') {
          g.fillStyle(0xe56f64);
          g.fillRect(-3, -height - 16, 6, 15);
          g.fillRect(-8, -height - 11, 16, 5);
        }
        if (['bakery', 'restaurant', 'supermarket'].includes(b.kind)) {
          g.fillStyle(0xffefd1);
          g.fillRoundedRect(-w / 3 - 3, -height + 4, w * 0.65, 8, 2);
          for (let i = 0; i < 5; i++) {
            g.fillStyle(cfg.color);
            g.fillRect(-w / 3 - 2 + i * w * 0.13, -height + 4, w * 0.06, 8);
          }
        }
      }
      this.objects.add(g);
      const top = isCommerce(b.kind)
        ? commerceSignY(b.size, b.kind) - 18
        : b.kind === 'townhall'
          ? TOWNHALL_TOP
          : b.kind === 'farm'
            ? -102
            : -(45 + b.size * 8) / 2 - 15 - b.size * 3;
      const zone = this.add
        .zone(
          p.x,
          p.y +
            (isCommerce(b.kind) || b.kind === 'townhall' || b.kind === 'farm'
              ? top / 2
              : -15 - b.size * 3),
          Math.max(w, 54),
          isCommerce(b.kind) || b.kind === 'townhall' || b.kind === 'farm'
            ? -top + 40
            : 45 + b.size * 8,
        )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setDepth(b.x + b.y + b.size * 2 + 0.1);
      zone.on(
        'pointerup',
        (
          _pointer: Phaser.Input.Pointer,
          _x: number,
          _y: number,
          event: Phaser.Types.Input.EventData,
        ) => {
          if (this.dragged || this.placement) return;
          event.stopPropagation();
          this.onSelect({ type: 'building', id: b.id, x: b.x, y: b.y });
        },
      );
      this.objects.add(zone);
      if (isCommerce(b.kind)) {
        const label = this.add
          .text(p.x, p.y + 12, BUILDINGS[b.kind].name, {
            fontFamily: 'Trebuchet MS',
            fontSize: b.kind === 'supermarket' ? '14px' : '10px',
            fontStyle: 'bold',
            color: b.kind === 'supermarket' ? '#ffe477' : '#fff8df',
            backgroundColor: b.kind === 'supermarket' ? '#315f88' : '#426e58',
            padding: { x: 5, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(1200)
          .setName(`shop-label:${b.id}`);
        this.objects.add(label);
      }
      if (b.kind === 'townhall' || b.kind === 'farm') {
        const name = this.add
          .text(p.x, p.y + (b.kind === 'farm' ? 40 : 16), cfg.name, {
            fontSize: '11px',
            fontStyle: 'bold',
            fontFamily: 'Arial',
            color: '#fff7df',
            backgroundColor: b.kind === 'townhall' ? '#405d70' : '#657d4e',
            padding: { x: 6, y: 3 },
          })
          .setOrigin(0.5)
          .setDepth(1200)
          .setName(`building-label:${b.id}`);
        this.objects.add(name);
        if (b.kind === 'townhall') {
          this.objects.add(
            this.add
              .text(p.x, p.y - 55, 'MAIRIE', {
                fontSize: '7px',
                fontStyle: 'bold',
                fontFamily: 'Arial',
                color: '#f8edca',
              })
              .setOrigin(0.5)
              .setDepth(1201)
              .setName(`townhall-plaque:${b.id}`),
          );
        }
      }
      const income = incomeStatus(
        b,
        now,
        this.world.governance?.regime ?? 'communism',
        this.world.profile.id,
      );
      const ballot = b.kind === 'townhall' && electionOpen(this.world.governance?.election, now);
      if (income.ready || ballot) {
        const yy =
          p.y + (isCommerce(b.kind) ? commerceSignY(b.size, b.kind) - 40 : TOWNHALL_TOP - 28);
        const badge = this.add.graphics().setPosition(p.x, yy).setDepth(1300);
        if (ballot) {
          badge.fillStyle(0xfff8db);
          badge.fillRoundedRect(-15, -13, 30, 26, 5);
          badge.fillStyle(0x608a7a);
          badge.fillRect(-10, 2, 20, 7);
          badge.lineStyle(2, 0x608a7a);
          badge.lineBetween(-8, -5, 7, -5);
          badge.lineBetween(-6, -9, -1, -6);
        } else {
          badge.fillStyle(income.canClaim ? 0xf1c653 : 0xbeb68a);
          badge.fillCircle(0, 0, 14);
          badge.lineStyle(2, 0xfff1a3);
          badge.strokeCircle(0, 0, 10);
          badge.lineStyle(3, 0xa17d2d);
          badge.lineBetween(0, -6, 0, 6);
        }
        this.objects.add(badge);
        const hit = this.add
          .zone(p.x, yy, 38, 38)
          .setInteractive({ useHandCursor: true })
          .setDepth(1301)
          .setName(`${ballot ? 'ballot' : 'income'}:${b.id}`);
        hit.on(
          'pointerup',
          (
            _pointer: Phaser.Input.Pointer,
            _x: number,
            _y: number,
            event: Phaser.Types.Input.EventData,
          ) => {
            if (this.dragged || this.placement) return;
            event.stopPropagation();
            this.onSelect({
              type: ballot ? 'civic' : income.canClaim ? 'income' : 'building',
              id: b.id,
              x: b.x,
              y: b.y,
            });
          },
        );
        this.objects.add(hit);
      }
    }
    this.objects.sort('depth');
    if (this.avatar) {
      this.avatar.removeAll(true);
      this.drawPerson(
        this.avatar,
        this.playerAvatar ?? this.world.avatar,
        this.world.governance?.mayor_id === this.world.profile.id,
      );
    }
    this.setGuests(this.pendingGuests);
  }
  drawPerson(c: Phaser.GameObjects.Container, a: Avatar, mayor = false) {
    const g = this.add.graphics();
    g.fillStyle(0x315847, 0.24);
    g.fillEllipse(0, 2, 19, 8);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(a.pants).color);
    g.fillRoundedRect(-7, -13, 6, 14, 2);
    g.fillRoundedRect(1, -13, 6, 14, 2);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(a.skin).color);
    g.fillRoundedRect(-12, -28, 5, 15, 2);
    g.fillRoundedRect(7, -28, 5, 15, 2);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(a.shirt).color);
    g.fillRoundedRect(-8, -30, 16, 20, 4);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(a.skin).color);
    g.fillCircle(0, -38, 10);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(a.hair).color);
    g.fillRoundedRect(-10, -49, 20, 10, 5);
    g.fillRect(-10, -43, 4, 9);
    g.fillStyle(0x343c37);
    g.fillCircle(-3, -37, 1);
    g.fillCircle(4, -37, 1);
    c.add(g);
    if (mayor) {
      const badge = this.add.graphics().setName('mayor-star');
      const points: number[] = [];
      for (let i = 0; i < 12; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 6;
        const radius = i % 2 ? 5 : 10;
        points.push(Math.cos(angle) * radius, -87 + Math.sin(angle) * radius);
      }
      this.polygon(badge, points, 0xf2c44e);
      badge.lineStyle(1, 0x9c7025);
      badge.strokePoints(
        points.reduce<Phaser.Geom.Point[]>(
          (p, _, i) => (i % 2 ? p : [...p, new Phaser.Geom.Point(points[i], points[i + 1])]),
          [],
        ),
        true,
      );
      badge.fillStyle(0xffed9a);
      badge.fillCircle(0, -87, 3);
      c.add(badge);
    }
  }
  makeAvatar(a: Avatar, mayor = false) {
    const c = this.add.container();
    this.drawPerson(c, a, mayor);
    return c;
  }
  placeAvatar(x: number, y: number) {
    this.pos = { x, y };
    const p = iso(x, y);
    this.avatar.setPosition(p.x, p.y);
  }
  setWorld(w: World) {
    const changed =
      this.world?.island.id !== w.island.id || Boolean(this.world?.exile) !== Boolean(w.exile);
    this.world = w;
    if (this.sys.isActive()) {
      this.redraw();
      if (changed) {
        this.terrain.clear();
        this.drawTerrain();
        this.tweens.killTweensOf(this.avatar);
        this.walking = false;
        const spawn = playerSpawn(w);
        this.placeAvatar(spawn.x, spawn.y);
        this.onPosition?.(spawn.x, spawn.y);
        this.center();
        this.setGuests(this.pendingGuests);
      }
    }
  }
  select(x: number, y: number) {
    if (!worldLand(this.world, x, y)) return;
    if (this.world.exile && !exileLand(x, y)) return;
    if (this.placement) {
      this.onPlace(x, y);
      return;
    }
    const tree = this.world.trees.find((t) => !t.cut_at && t.x === x && t.y === y),
      plot = this.world.plots.find((p) => p.x === x && p.y === y),
      building = this.world.buildings.find(
        (b) => x >= b.x && x < b.x + b.size && y >= b.y && y < b.y + b.size,
      );
    this.onSelect({
      type: tree ? 'tree' : plot ? 'plot' : building ? 'building' : 'ground',
      id: tree?.id ?? plot?.id ?? building?.id,
      x,
      y,
    });
    if (!tree && !building) this.walk(x, y);
  }
  walk(x: number, y: number) {
    if (this.walking) return;
    const path = pathTo(this.world, this.pos, { x, y });
    if (!path.length) return;
    this.walking = true;
    let i = 0;
    const step = () => {
      if (i >= path.length) {
        this.walking = false;
        return;
      }
      const n = path[i++],
        p = iso(n.x, n.y);
      this.tweens.add({
        targets: this.avatar,
        x: p.x,
        y: p.y,
        duration: 160,
        ease: 'Linear',
        onUpdate: () => {
          this.avatar.setScale(1, 1 + Math.sin(this.time.now / 70) * 0.025);
        },
        onComplete: () => {
          this.pos = n;
          this.setGuests(this.pendingGuests);
          this.onPosition?.(n.x, n.y);
          this.avatar.setScale(1);
          step();
        },
      });
    };
    step();
  }
  animateChop(id: number) {
    const tree = this.objects.getByName(`tree:${id}`);
    if (tree)
      this.tweens.add({
        targets: tree,
        angle: 8,
        duration: 65,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
      });
  }
  drawGhost(x: number, y: number) {
    if (!this.ghost) return;
    this.ghost.clear();
    if (!this.placement) return;
    const size = PLACEABLES[this.placement.kind].size,
      ok = buildable(this.world, x, y, size, this.placement.movingId);
    for (let a = x; a < x + size; a++)
      for (let b = y; b < y + size; b++) {
        const p = iso(a, b);
        this.diamond(this.ghost, p.x, p.y, 46, 23, ok ? 0x4cd6a0 : 0xef7665, 0.6);
      }
    const p = iso(x + (size - 1) / 2, y + (size - 1) / 2);
    if (this.placement.kind === 'farm_plot') {
      this.diamond(this.ghost, p.x, p.y, 38, 18, ok ? 0x8c6649 : 0xef7665, 0.75);
      return;
    }
    const w = size * W * 0.65;
    this.polygon(
      this.ghost,
      [p.x - w / 2, p.y - 20, p.x, p.y - 45 - size * 5, p.x + w / 2, p.y - 20, p.x, p.y - 8],
      ok ? PLACEABLES[this.placement.kind].color : 0xef7665,
      0.5,
    );
  }
  setGuests(guests: { id: string; x: number; y: number; avatar: Avatar; username: string }[]) {
    this.pendingGuests = guests;
    if (!this.avatar) return;
    const active = new Set(guests.map((g) => g.id));
    for (const [id, c] of this.guests)
      if (!active.has(id)) {
        c.destroy();
        this.guests.delete(id);
      }
    for (const p of guests) {
      let c = this.guests.get(p.id);
      let fresh = false;
      const mayor = this.world.governance?.mayor_id === p.id;
      const avatarKey = JSON.stringify(p.avatar) + p.username + mayor;
      if (c && c.getData('avatarKey') !== avatarKey) {
        this.tweens.killTweensOf(c);
        c.destroy();
        this.guests.delete(p.id);
        c = undefined;
      }
      if (!c) {
        c = this.makeAvatar(p.avatar, mayor).setDepth(1499).setName(`resident:${p.id}`);
        c.add(
          this.add
            .text(0, -66, p.username, {
              fontSize: '11px',
              color: '#ffffff',
              backgroundColor: '#245d53',
              padding: { x: 5, y: 3 },
            })
            .setOrigin(0.5),
        );
        c.setData('avatarKey', avatarKey);
        this.guests.set(p.id, c);
        fresh = true;
      }
      const pt = iso(p.x, p.y),
        offset = residentOffset(p, guests, this.pos),
        x = pt.x + offset.x,
        y = pt.y;
      const label = c.list.find((o) => o.type === 'Text') as Phaser.GameObjects.Text | undefined;
      label?.setY(offset.labelY);
      const badge = c.getByName('mayor-star') as Phaser.GameObjects.Graphics | null;
      badge?.setY(offset.labelY + 66);
      if (fresh) c.setPosition(x, y);
      else if (c.x !== x || c.y !== y) {
        this.tweens.killTweensOf(c);
        this.tweens.add({ targets: c, x, y, duration: 250, ease: 'Linear' });
      }
    }
  }
  update(time: number) {
    if (!this.world || !this.keys) return;
    if (time - this.lastClock > 1000) {
      this.lastClock = time;
      // Keep interactive targets stable while their appearance has not changed.
      if (
        this.visualKey !== this.visualStateKey() &&
        !this.input.manager.pointers.some((p) => p.isDown)
      )
        this.redraw();
    }
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(active.tagName))
    )
      return;
    if (time - this.lastKey < 180 || this.walking) return;
    const k = this.keys;
    let dx = 0,
      dy = 0;
    if (k.UP.isDown || k.Z.isDown || k.W.isDown) dy = -1;
    else if (k.DOWN.isDown || k.S.isDown) dy = 1;
    else if (k.LEFT.isDown || k.Q.isDown || k.A.isDown) dx = -1;
    else if (k.RIGHT.isDown || k.D.isDown) dx = 1;
    if (dx || dy) {
      this.lastKey = time;
      const x = this.pos.x + dx,
        y = this.pos.y + dy;
      if (walkable(this.world, x, y)) this.walk(x, y);
    }
  }
}
