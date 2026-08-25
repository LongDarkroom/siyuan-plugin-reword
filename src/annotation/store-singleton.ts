/**
 * 批注数据层全局单例的中性持有模块（Phase 2 新增）
 * ------------------------------------------------------------------
 * 背景：AnnotationStore 在插件入口 index.ts 内创建（依赖 SiYuan SDK 的
 * saveAnnotations 持久化钩子）。阅读面板 ReaderView 是独立 Svelte 组件，
 * 既拿不到 index.ts 类实例，也不能反向 import index.ts（会造成循环依赖）。
 *
 * 因此把「单例引用」放在本中性模块：index.ts 初始化后调用 setAnnotationStore
 * 注入；ReaderView 通过 getAnnotationStore() 无循环依赖地访问同一份数据，
 * 使阅读器批注与思源文档批注落到同一个存储、同一张笔记图谱（Phase 3 导出思源）。
 */
import type { AnnotationStore } from "./annotation-store.ts";

let instance: AnnotationStore | null = null;

/** 由插件入口（index.ts）创建 AnnotationStore 后调用，注入单例 */
export function setAnnotationStore(s: AnnotationStore): void {
  instance = s;
}

/** 获取全局批注数据层单例；未初始化时抛错（尽早暴露接线问题） */
export function getAnnotationStore(): AnnotationStore {
  if (!instance) throw new Error("[REword] annotationStore 尚未初始化");
  return instance;
}
