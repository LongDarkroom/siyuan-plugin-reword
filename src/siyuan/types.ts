/**
 * SiYuan 笔记核心数据结构定义
 * ------------------------------------------------------------------
 * 这些类型与思源笔记的内核数据结构保持一致（详见 SiYuan 官方文档 / 内核 schema）。
 * REword 的「思源集成层」（src/siyuan/*）统一使用本文件中的类型，
 * 以保证插件与思源数据层的交互在类型层面严格对齐。
 */

/** 块属性表：键为属性名，值为字符串（思源所有属性均以字符串存储） */
export interface SiyuanBlockAttrs {
  [key: string]: string;
}

/**
 * 思源块（blocks 表行，SQL 查询结果）
 * 字段命名与 SiYuan 内核 `blocks` 表保持一致。
 */
export interface SiyuanBlock {
  /** 块 ID（16 位十六进制） */
  id: string;
  /** 块内容（Markdown 源码，标题/列表项/段落等的纯文本+标记） */
  content?: string;
  /** 块 Markdown 渲染后的 DOM 字符串（部分查询场景返回） */
  markdown?: string;
  /** 块类型：p / h / code / list / li / quote / table / ... */
  type?: string;
  /** 块子类型：h1~h6、待办、有序/无序列表等 */
  subtype?: string;
  /** 父块 ID */
  parent_id?: string;
  /** 根文档 ID（所在文档） */
  root_id?: string;
  /** 笔记本 ID（box） */
  box?: string;
  /** 块在文档树中的路径（内核路径，如 /202301010000-aaaaaa/...） */
  path?: string;
  /** 块在人类可读文档树中的路径（hpath，如 /笔记本名/文档名/标题） */
  hpath?: string;
  /** 排序权重（同层块顺序） */
  sort?: number;
  /** 创建时间（Unix 秒） */
  created?: string;
  /** 更新时间（Unix 秒） */
  updated?: string;
  /** 兼容未知字段 */
  [key: string]: any;
}

/**
 * 笔记本（notebook）
 * 对应 /api/notebook/lsNotebooks 返回项。
 */
export interface SiyuanNotebook {
  /** 笔记本 ID */
  id: string;
  /** 笔记本名称 */
  name: string;
  /** 是否已关闭（未挂载） */
  closed: boolean;
  /** 图标 emoji */
  icon?: string;
  /** 排序权重 */
  sort?: number;
  /** 创建时间（Unix 秒） */
  created?: string;
  /** 兼容未知字段 */
  [key: string]: any;
}

/**
 * 文档信息（filetree.getDoc 返回项 + getHPathByID 补充标题）
 */
export interface SiyuanDocInfo {
  /** 文档 ID */
  id?: string;
  /** 笔记本 ID */
  box?: string;
  /** 文档标题 */
  name?: string;
  /** 内核路径 */
  path?: string;
  /** 人类可读路径（hpath） */
  hpath?: string;
  /** 图标 */
  icon?: string;
  /** 兼容未知字段 */
  [key: string]: any;
}

/**
 * 文档树节点（listDocsByPath / 大纲树）
 * 用于文档树与大纲视图的层级管理。
 */
export interface SiyuanDocNode {
  /** 文档 ID */
  id: string;
  /** 文档/标题名称 */
  name: string;
  /** 内核路径 */
  path?: string;
  /** 人类可读路径 */
  hPath?: string;
  /** 子节点 */
  children?: SiyuanDocNode[];
  /** 排序权重 */
  sort?: number;
  /** 兼容未知字段 */
  [key: string]: any;
}

/**
 * 通用 API 响应包装（思源 fetchSyncPost 返回结构）
 */
export interface SiyuanApiResponse<T = any> {
  /** 错误码：0 表示成功 */
  code: number;
  /** 响应数据 */
  data: T;
  /** 错误信息（code != 0 时存在） */
  msg: string;
}
