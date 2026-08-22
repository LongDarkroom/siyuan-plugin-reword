/**
 * 句子精读与词库联动 —— 类型定义
 */

/** 单词详解 */
export interface Word {
    /** 单词词条（原形），键名统一用小写 */
    term: string;
    /** 音标，如 /ˈwɜːd/ */
    phonetic?: string;
    /** 主词性，如 n. / v. / adj. （可选，便于表格展示） */
    pos?: string;
    /** 中文释义列表 */
    definitions: string[];
    /** 例句列表（原文 + 可选译文） */
    examples?: string[];
    /** 掌握度 0-5：0=不认识，5=彻底掌握 */
    mastery: number;
    /** 来源思源块 ID 列表（由编排器写入，AI 不负责） */
    sourceBlockIDs: string[];
    /** 首次收录时间戳 */
    createdAt: number;
    /** 最近出现时间戳 */
    lastSeen: number;
}

/** 句子成分 */
export interface SentenceComponent {
    /** 成分角色：主语 / 谓语 / 宾语 / 定语 / 状语 / 从句 等 */
    role: string;
    /** 对应原文文本 */
    text: string;
}

/** 单句结构分析 */
export interface SentenceAnalysis {
    /** 原句 */
    sentence: string;
    /** 句子译文 */
    translation?: string;
    /** 句子成分拆解 */
    components: SentenceComponent[];
    /** 语法点说明（时态、从句、固定搭配等） */
    grammar?: string;
}

/** AI 返回的精读结果 */
export interface DeepReadResult {
    /** 思考过程（启用思考模式时） */
    thinking?: string;
    /** 单词详解表 */
    vocab: Word[];
    /** 句子结构分析表 */
    sentenceAnalysis: SentenceAnalysis[];
}

/** 词库持久化结构（vocab.json） */
export interface VocabData {
    words: Record<string, Word>;
    updatedAt: number;
}

/** 精读设置（写入 defaultSettings.deepread） */
export interface DeepReadConfig {
    /** 系统提示词 */
    systemPrompt: string;
    /** 采样温度 */
    temperature: number;
    /** 最大输出 token */
    maxTokens: number;
    /** 是否启用思考模式 */
    enableThinking: boolean;
    /** 注入提示词的「已知词」上限（避免 token 膨胀） */
    maxKnownWords: number;
}
