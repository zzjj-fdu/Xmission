/**
 * CRT 扫描线材质（签名细节）：水平 1px 暗线 / 3px 周期的 repeating gradient。
 * absolute 覆盖层、pointerEvents none，父容器需 position: relative 才会生效。
 * inset 2px：避开父容器边框/角花，不盖住像素描边。
 */
export function Scanlines({ opacity = 0.12 }: { opacity?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 2,
        right: 2,
        bottom: 2,
        left: 2,
        pointerEvents: 'none',
        background: `repeating-linear-gradient(0deg, rgba(0,0,0,${opacity}) 0 1px, transparent 1px 3px)`,
        zIndex: 1,
      }}
    />
  );
}
