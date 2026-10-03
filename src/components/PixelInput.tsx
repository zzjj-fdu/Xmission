import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { pixelFieldStyle } from './pixelField';

/** 像素输入框（共享组件）：深底暗金边，focus 亮金描边 */
export function PixelInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      {...props}
      onFocus={(e) => {
        setFocus(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocus(false);
        props.onBlur?.(e);
      }}
      style={{ ...pixelFieldStyle(focus), ...props.style }}
    />
  );
}
