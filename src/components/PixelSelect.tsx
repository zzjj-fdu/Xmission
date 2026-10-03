import { useState } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { pixelFieldStyle } from './pixelField';

/** 像素下拉框（共享组件）：深底暗金边，focus 亮金描边 */
export function PixelSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const [focus, setFocus] = useState(false);
  return (
    <select
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
