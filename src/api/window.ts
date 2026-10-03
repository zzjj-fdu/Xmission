import { emit } from '@tauri-apps/api/event';

/**
 * 请求悬浮窗显示自己。
 * 悬浮窗 hide() 后 WebView 仍在后台运行、事件监听保持有效，
 * 因此由它自己监听该事件并执行 show()/setFocus()，
 * 只需对当前窗口的操作权限，绕开跨窗口句柄的权限不确定性。
 */
export async function emitShowWidget(): Promise<void> {
  return emit('widget:show', {});
}
