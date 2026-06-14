import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

export type PetHandle = {
  /** 播放一次点击反馈 */
  tap: () => void;
  /** 设置散步方向 */
  setFacing: (direction: 1 | -1) => void;
  /** 开/关走路 */
  setWalking: (on: boolean) => void;
};

export type SpriteKind = "cat" | "dog";

type Action = "idle" | "walk" | "jump";

type Props = {
  kind: SpriteKind;
};

type AnimationState = {
  action: Action;
  frame: number;
};

const FRAME_COUNTS: Record<SpriteKind, Record<Action, number>> = {
  cat: { idle: 10, walk: 10, jump: 8 },
  dog: { idle: 10, walk: 10, jump: 8 },
};

const FPS: Record<Action, number> = {
  idle: 8,
  walk: 12,
  jump: 14,
};

function frameSrc(kind: SpriteKind, action: Action, index: number) {
  return `/sprites/${kind}/${action}-${String(index + 1).padStart(2, "0")}.png`;
}

const SpritePet = forwardRef<PetHandle, Props>(({ kind }, ref) => {
  const [{ action, frame }, setAnimation] = useState<AnimationState>({
    action: "idle",
    frame: 0,
  });
  const [facing, setFacing] = useState<1 | -1>(1);
  const walkingRef = useRef(false);
  const actionRef = useRef<Action>("idle");
  const oneShotRef = useRef<Action | null>(null);
  const frameRef = useRef(0);

  const frames = useMemo(() => {
    return Object.entries(FRAME_COUNTS[kind]).flatMap(([actionName, count]) =>
      Array.from({ length: count }, (_, i) => frameSrc(kind, actionName as Action, i))
    );
  }, [kind]);

  const play = (nextAction: Action, restart = false) => {
    if (!restart && actionRef.current === nextAction) return;
    actionRef.current = nextAction;
    frameRef.current = 0;
    setAnimation({ action: nextAction, frame: 0 });
  };

  useImperativeHandle(ref, () => ({
    tap() {
      oneShotRef.current = "jump";
      play("jump", true);
    },
    setFacing(direction: 1 | -1) {
      setFacing(direction);
    },
    setWalking(on: boolean) {
      walkingRef.current = on;
      if (!oneShotRef.current) {
        play(on ? "walk" : "idle");
      }
    },
  }));

  useEffect(() => {
    oneShotRef.current = null;
    walkingRef.current = false;
    play("idle", true);
  }, [kind]);

  useEffect(() => {
    frames.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, [frames]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const currentAction = actionRef.current;
      accumulator += now - last;
      last = now;

      const frameMs = 1000 / FPS[currentAction];
      if (accumulator < frameMs) return;
      accumulator %= frameMs;

      const count = FRAME_COUNTS[kind][currentAction];
      const next = frameRef.current + 1;
      if (next < count) {
        frameRef.current = next;
        setAnimation({ action: currentAction, frame: next });
        return;
      }

      if (oneShotRef.current === currentAction) {
        oneShotRef.current = null;
        play(walkingRef.current ? "walk" : "idle", true);
        return;
      }

      frameRef.current = 0;
      setAnimation({ action: currentAction, frame: 0 });
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [kind]);

  return (
    <div className="sprite-host" style={{ transform: `scaleX(${facing})` }}>
      <img
        className="sprite-pet"
        draggable={false}
        src={frameSrc(kind, action, frame % FRAME_COUNTS[kind][action])}
      />
    </div>
  );
});

SpritePet.displayName = "SpritePet";
export default SpritePet;
