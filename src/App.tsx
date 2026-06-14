import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import Live2DPet, { type PetHandle } from "./Live2DPet";
import "./App.css";

// 仅在 Tauri 运行时才有窗口 API;普通浏览器(如预览)下为 null,
// 这样宠物本体照常渲染,只是拖动/散步/托盘等窗口功能失效。
const IS_TAURI = "__TAURI_INTERNALS__" in window;
const appWindow = IS_TAURI ? getCurrentWindow() : null;

// 可切换的模型(换装 = 换模型)。把新模型放进 public/models/<名字>/ 即可。
const MODELS = [
  { id: "hiyori", name: "Hiyori", src: "/models/hiyori/Hiyori.model3.json" },
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

function App() {
  const [bubble, setBubble] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [model, setModel] = useState(MODELS[0]);
  const [facing, setFacing] = useState<1 | -1>(1);

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
    setBubble(LINES[Math.floor(Math.random() * LINES.length)]);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 2200);
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    touch();
    setMenu({ x: e.clientX, y: e.clientY });
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

      const target = Math.round(minX + Math.random() * (maxX - minX));
      const y = start.y;
      const dpr = mon.scaleFactor || 1;
      const speed = 3 * dpr; // 物理像素 / 帧
      let x = start.x;
      setFacing(target >= start.x ? 1 : -1);

      await new Promise<void>((resolve) => {
        const frame = () => {
          if (!alive || Date.now() - lastInteract.current < 300) {
            resolve();
            return;
          }
          const dx = target - x;
          if (Math.abs(dx) <= speed) {
            void win.setPosition(new PhysicalPosition(target, y));
            resolve();
            return;
          }
          x += Math.sign(dx) * speed;
          void win.setPosition(new PhysicalPosition(Math.round(x), y));
          raf = requestAnimationFrame(frame);
        };
        frame();
      });
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

      <div className="pet-wrap" style={{ transform: `scaleX(${facing})` }}>
        <Live2DPet ref={pet} src={model.src} />
      </div>

      {menu && (
        <ul
          className="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {MODELS.length > 1 && (
            <>
              <li className="menu__title">模型</li>
              {MODELS.map((m) => (
                <li
                  key={m.id}
                  className={m.id === model.id ? "menu__on" : ""}
                  onClick={() => {
                    setModel(m);
                    setMenu(null);
                  }}
                >
                  {m.name}
                </li>
              ))}
              <li className="menu__sep" />
            </>
          )}
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
