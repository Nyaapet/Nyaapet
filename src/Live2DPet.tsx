import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";

type PIXIWindow = Window & { PIXI?: typeof PIXI };

// pixi-live2d-display 需要拿到全局 PIXI 来挂 Ticker / 交互系统
(window as PIXIWindow).PIXI = PIXI;
Live2DModel.registerTicker(PIXI.Ticker);

export type PetHandle = {
  /** 播放一段随机交互动作 */
  tap: () => void;
};

type Props = {
  /** model3.json 的路径 */
  src: string;
};

const Live2DPet = forwardRef<PetHandle, Props>(({ src }, ref) => {
  // 用容器 div,让 pixi 自己创建/销毁 canvas,
  // 避免 StrictMode 双挂载时复用同一个 canvas 导致 WebGL 上下文报错。
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Live2DModel | null>(null);

  useImperativeHandle(ref, () => ({
    tap() {
      modelRef.current?.motion("TapBody");
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let destroyed = false;
    const app = new PIXI.Application({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      resizeTo: window,
    });
    const canvas = app.view as HTMLCanvasElement;
    canvas.className = "live2d-canvas";
    host.appendChild(canvas);

    const fit = (model: Live2DModel) => {
      const w = app.renderer.width / app.renderer.resolution;
      const h = app.renderer.height / app.renderer.resolution;
      // 用模型的原生画布尺寸来等比缩放,比 model.width/height 的包围盒更可靠
      const iw = model.internalModel.originalWidth;
      const ih = model.internalModel.originalHeight;
      const scale = Math.min(w / iw, h / ih);
      model.scale.set(scale);
      model.anchor.set(0.5, 0.5);
      model.position.set(w / 2, h / 2);
    };

    Live2DModel.from(src, { autoInteract: true })
      .then((model) => {
        if (destroyed) {
          model.destroy();
          return;
        }
        modelRef.current = model;
        app.stage.addChild(model);
        fit(model);
        model.on("hit", () => model.motion("TapBody"));
      })
      .catch((e) => console.error("[Live2D] 模型加载失败:", e));

    const onResize = () => {
      if (modelRef.current) fit(modelRef.current);
    };
    window.addEventListener("resize", onResize);

    return () => {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      modelRef.current = null;
      // 销毁并移除 canvas(removeView = true)
      app.destroy(true, { children: true });
    };
  }, [src]);

  return <div ref={hostRef} className="live2d-host" />;
});

Live2DPet.displayName = "Live2DPet";
export default Live2DPet;
