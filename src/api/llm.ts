import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { CourseDraft } from './courses';

/** 与 Rust 侧 serde camelCase 模型一一对应（M3 契约） */

export interface LlmConfig {
  baseUrl: string;
  model: string;
  /** key 存在与否（永远不回传 key 本体，key 存 OS 钥匙串） */
  hasKey: boolean;
}

let configRead: Promise<LlmConfig> | undefined;
let configReadAt = 0;
export function getLlmConfig(): Promise<LlmConfig> {
  if (configRead && Date.now() - configReadAt < 30_000) return configRead;
  configReadAt = Date.now();
  const request = invoke<LlmConfig>('get_llm_config').catch((error) => {
    if (configRead === request) configRead = undefined;
    throw error;
  });
  configRead = request;
  return request;
}

if (isTauri()) {
  const subscription = listen('llm-config-changed', () => { configRead = undefined; });
  void subscription.catch(console.error);
  import.meta.hot?.dispose(() => { void subscription.then((unlisten) => unlisten()); });
}

/** apiKey 传空字符串 = 保留已存 key 不动；非空则替换 keyring 中的 key */
export async function setLlmConfig(
  baseUrl: string,
  model: string,
  apiKey: string,
): Promise<void> {
  await invoke<void>('set_llm_config', { baseUrl, model, apiKey });
  configRead = undefined;
}

/** 测试连接：成功返回模型标识文本，失败抛中文错误 */
export async function testLlmConnection(): Promise<string> {
  return invoke<string>('test_llm_connection');
}

/** 远端可用模型条目（M4）：supportsImageIn=true 表示支持图片输入（识图） */
export interface LlmModelInfo {
  id: string;
  supportsImageIn: boolean;
}

/** 拉取 {baseUrl}/models 的可用模型列表（用当前已保存的配置与 key） */
export async function listLlmModels(): Promise<LlmModelInfo[]> {
  return invoke<LlmModelInfo[]>('list_llm_models');
}

export interface SchoolScheduleResult {
  periods: { start: string; end: string }[];
  sourceUrl: string;
  sourceTitle: string;
  semesterStart: string | null;
}

/** 从学校官网检索逐节作息，AI 提取后返回可核对的来源。 */
export async function aiFindSchoolPeriods(school: string, campus: string): Promise<SchoolScheduleResult> {
  return invoke<SchoolScheduleResult>('ai_find_school_periods', { school, campus });
}

export async function summarizeTaskForWidget(title: string, notes: string): Promise<string> {
  return invoke<string>('summarize_task_for_widget', { title, notes });
}

/**
 * AI 课表截图识别：返回草稿供校对界面编辑（不落库）；
 * 用户确认后由 courses.saveCoursesBatch 落库。
 * bytesBase64 由前端 fileToBase64(file) 生成。
 * 失败抛中文错误（未配置 key / 网络 / 模型不支持视觉 / 解析失败）。
 */
export async function aiParseScheduleImage(
  fileName: string,
  bytesBase64: string,
): Promise<CourseDraft[]> {
  return invoke<CourseDraft[]>('ai_parse_schedule_image', { fileName, bytesBase64 });
}

/** File → base64（分块避免栈溢出） */
export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
