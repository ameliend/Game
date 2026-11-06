import { useEffect, useLayoutEffect, useRef } from 'react';
import Phaser from 'phaser';
import { IslandScene } from './IslandScene';
import type { Avatar, Placement, Selection, World } from '../types';
export function GameCanvas({
  world,
  playerAvatar,
  placement,
  offset,
  onSelect,
  onPlace,
  onPosition,
  guests,
  sceneRef,
  blocked = false,
}: {
  world: World;
  playerAvatar?: Avatar;
  placement: Placement;
  offset: number;
  onSelect: (s: Selection) => void;
  onPlace: (x: number, y: number) => void;
  onPosition: (x: number, y: number) => void;
  guests: { id: string; x: number; y: number; avatar: Avatar; username: string }[];
  sceneRef: React.RefObject<IslandScene | null>;
  blocked?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onPlace, onPosition });
  callbacks.current = { onSelect, onPlace, onPosition };
  useEffect(() => {
    const scene = new IslandScene();
    scene.world = world;
    scene.playerAvatar = playerAvatar;
    scene.offset = offset;
    scene.uiBlocked = blocked;
    scene.onSelect = (s) => callbacks.current.onSelect(s);
    scene.onPlace = (x, y) => callbacks.current.onPlace(x, y);
    scene.onPosition = (x, y) => callbacks.current.onPosition(x, y);
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current!,
      backgroundColor: '#72c9cd',
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: host.current!.clientWidth,
        height: host.current!.clientHeight,
      },
      scene: [scene],
      render: { antialias: true },
      input: { activePointers: 3 },
    });
    return () => {
      sceneRef.current = null;
      game.destroy(true);
    };
  }, []);
  useLayoutEffect(() => {
    sceneRef.current?.setUiBlocked(blocked);
  }, [blocked]);
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.playerAvatar = playerAvatar;
      sceneRef.current.setWorld(world);
    }
  }, [world, playerAvatar]);
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.placement = placement;
      if (!placement) sceneRef.current['drawGhost'](0, 0);
    }
  }, [placement]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.offset = offset;
  }, [offset]);
  useEffect(() => {
    sceneRef.current?.setGuests(guests);
  }, [guests]);
  return (
    <div
      className="game-canvas"
      ref={host}
      role="application"
      aria-label="Carte de l’île. Cliquez pour marcher. Déplacez-vous avec les flèches ou ZQSD. Les ressources sont aussi accessibles dans le menu Actions."
    />
  );
}
