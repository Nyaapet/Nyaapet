import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import SpritePet, { type PetHandle, type SpriteKind } from "./SpritePet";
import "./App.css";

// 仅在 Tauri 运行时才有窗口 API;普通浏览器(如预览)下为 null,
// 这样宠物本体照常渲染,只是拖动/散步/托盘等窗口功能失效。
const IS_TAURI = "__TAURI_INTERNALS__" in window;
const appWindow = IS_TAURI ? getCurrentWindow() : null;

type PetOption = {
  id: SpriteKind;
  name: string;
};

const PETS: PetOption[] = [
  { id: "cat", name: "猫猫" },
  { id: "dog", name: "狗狗" },
];

// 点击宠物时随机弹出的台词
const LINES = [
  "喵～",
  "你来啦!",
  "戳我干嘛~",
  "在忙什么呀?",
  "陪我玩会儿嘛",
  "今天也要加油哦",
  "唔……困了",
  "嗯哼?",
];

const DRAG_THRESHOLD = 4; // 移动超过该像素数判定为拖拽而非点击
const INTERACT_PAUSE = 1500; // 互动后多久才允许自动散步(毫秒)
const TURN_DURATION = 460; // 转身动画时长(毫秒)
const MENU_WIDTH = 132;
const MENU_HEIGHT = 220;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const randomLine = () => LINES[Math.floor(Math.random() * LINES.length)];

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function App() {
  const [bubble, setBubble] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [petKind, setPetKind] = useState<SpriteKind>("cat");
  const facingRef = useRef<1 | -1>(1);

  const pet = useRef<PetHandle>(null);
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const lastInteract = useRef(0);
  const bubbleTimer = useRef<number | undefined>(undefined);

  const touch = () => {
    lastInteract.current = Date.now();
  };

  // 鼠标按下:记录起点,准备区分点击 / 拖拽
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    touch();
    downPos.current = { x: e.screenX, y: e.screenY };
    dragging.current = false;
  }, []);

  // 移动超过阈值则交给系统拖动窗口
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!downPos.current || dragging.current) return;
    const dx = Math.abs(e.screenX - downPos.current.x);
    const dy = Math.abs(e.screenY - downPos.current.y);
    if (dx + dy > DRAG_THRESHOLD) {
      dragging.current = true;
      void appWindow?.startDragging();
    }
  }, []);

  const onMouseUp = useCallback(() => {
    downPos.current = null;
  }, []);

  // 真正的点击(没有发生拖拽)才触发互动
  const onClick = useCallback(() => {
    if (dragging.current) return;
    setMenu(null);
    touch();
    pet.current?.tap();
    setBubble(randomLine());
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 2200);
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    touch();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - MENU_WIDTH),
      y: Math.min(e.clientY, window.innerHeight - MENU_HEIGHT),
    });
  }, []);

  // 点击别处关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  // ---- 自动散步 ----
  useEffect(() => {
    let alive = true;
    let raf = 0;
    let timer = 0;

    async function walk() {
      if (!alive || !appWindow) return;
      const win = appWindow;
      if (Date.now() - lastInteract.current < INTERACT_PAUSE) return;

      const mon = await currentMonitor();
      if (!mon || !alive) return;
      const start = await win.outerPosition();
      const size = await win.outerSize();

      const minX = mon.position.x + 10;
      const maxX = mon.position.x + mon.size.width - size.width - 10;
      if (maxX <= minX) return;

      const dpr = mon.scaleFactor || 1;
      const startX = start.x;
      const y = start.y;
      const targetX = Math.round(minX + Math.random() * (maxX - minX));
      const dist = targetX - startX;
      if (Math.abs(dist) < 30 * dpr) return; // 太近就不走,免得来回抽搐

      const nextFacing = dist >= 0 ? 1 : -1;
      if (nextFacing !== facingRef.current) {
        facingRef.current = nextFacing;
        pet.current?.setFacing(nextFacing);
        await wait(TURN_DURATION);
        if (!alive || Date.now() - lastInteract.current < 300) return;
      } else {
        pet.current?.setFacing(nextFacing);
      }
      pet.current?.setWalking(true); // 开启模型自身的步态循环(腿/手臂/身体)

      // 基于时间推进:每秒约 110 物理像素,距离越远走得越久
      const pxPerSec = 110 * dpr;
      const duration = Math.max(700, (Math.abs(dist) / pxPerSec) * 1000);
      const t0 = performance.now();

      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          // 被点击/拖拽打断就立即停下
          if (!alive || Date.now() - lastInteract.current < 300) {
            resolve();
            return;
          }
          const t = Math.min(1, (now - t0) / duration);
          const x = Math.round(startX + dist * easeInOut(t));
          void win.setPosition(new PhysicalPosition(x, y));

          if (t >= 1) {
            resolve();
            return;
          }
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      });

      pet.current?.setWalking(false); // 到站/被打断都收起步态,平滑过渡到站立
    }

    const schedule = () => {
      const wait = 6000 + Math.random() * 9000;
      timer = window.setTimeout(async () => {
        await walk();
        if (alive) schedule();
      }, wait);
    };
    schedule();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      pet.current?.setWalking(false);
    };
  }, []);

  useEffect(() => {
    return () => window.clearTimeout(bubbleTimer.current);
  }, []);

  return (
    <div
      className="pet"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {bubble && <div className="bubble">{bubble}</div>}

      <div className="pet-wrap">
        <SpritePet ref={pet} kind={petKind} />
      </div>

      {menu && (
        <ul
          className="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <li className="menu__title">角色</li>
          {PETS.map((m) => (
            <li
              key={m.id}
              className={m.id === petKind ? "menu__on" : ""}
              onClick={() => {
                setPetKind(m.id);
                setMenu(null);
                touch();
                facingRef.current = 1;
                pet.current?.setWalking(false);
                pet.current?.setFacing(1);
              }}
            >
              {m.name}
            </li>
          ))}
          <li className="menu__sep" />
          <li
            onClick={() => {
              setMenu(null);
              touch();
              pet.current?.tap();
            }}
          >
            逗它一下
          </li>
          <li
            onClick={() => {
              setMenu(null);
              void appWindow?.hide();
            }}
          >
            隐藏(托盘可恢复)
          </li>
          <li
            className="danger"
            onClick={() => {
              setMenu(null);
              void appWindow?.close();
            }}
          >
            退出
          </li>
        </ul>
      )}
    </div>
  );
}

export default App;
