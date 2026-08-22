/**
 * 词库读写层
 *
 * 词库存放在插件私有数据文件 vocab.json 中（plugin.loadData / saveData）。
 * 以「单词小写」为键，支持 upsert 合并（保留历史 mastery 与来源块）。
 */
import type { Word, VocabData } from './types';

export const VOCAB_FILE = 'vocab.json';

const DEFAULT_VOCAB: VocabData = { words: {}, updatedAt: 0 };

/** 读取词库（文件不存在或损坏时返回空词库） */
export async function loadVocab(plugin: any): Promise<VocabData> {
    try {
        const data = await plugin.loadData(VOCAB_FILE);
        if (!data || typeof data !== 'object' || !data.words) {
            return { ...DEFAULT_VOCAB };
        }
        return data as VocabData;
    } catch (e) {
        console.warn('[deepread] loadVocab failed, return empty:', e);
        return { ...DEFAULT_VOCAB };
    }
}

/** 保存词库（自动刷新 updatedAt） */
export async function saveVocab(plugin: any, data: VocabData): Promise<void> {
    data.updatedAt = Date.now();
    await plugin.saveData(VOCAB_FILE, data);
}

/** 按词条精确取词（大小写不敏感） */
export function getWord(data: VocabData, term: string): Word | undefined {
    return data.words[term.toLowerCase()];
}

/** 按子串模糊搜索 */
export function searchVocab(data: VocabData, query: string): Word[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.values(data.words).filter((w) => w.term.toLowerCase().includes(q));
}

/**
 * 合并写入一个单词。
 * 规则：
 *  - 键名为 term 小写；
 *  - mastery 取历史与本次的较大值（保留用户已有掌握度）；
 *  - sourceBlockIDs / examples 去重合并；
 *  - 历史字段（phonetic/definitions）在缺失时由新值补齐；
 *  - createdAt 保留首次收录时间，lastSeen 刷新为当前。
 */
export function upsertWord(data: VocabData, word: Word): VocabData {
    const key = word.term.trim().toLowerCase();
    if (!key) return data;
    const prev = data.words[key];
    const now = Date.now();

    const merged: Word = {
        term: word.term,
        phonetic: word.phonetic || prev?.phonetic || '',
        pos: word.pos || prev?.pos || '',
        definitions:
            word.definitions && word.definitions.length
                ? word.definitions
                : prev?.definitions ?? [],
        examples: Array.from(
            new Set([...(prev?.examples ?? []), ...(word.examples ?? [])])
        ),
        mastery: Math.max(prev?.mastery ?? 0, word.mastery ?? 0),
        sourceBlockIDs: Array.from(
            new Set([...(prev?.sourceBlockIDs ?? []), ...(word.sourceBlockIDs ?? [])])
        ),
        createdAt: prev?.createdAt ?? now,
        lastSeen: now,
    };

    data.words[key] = merged;
    return data;
}

/**
 * 从文本中抽取「用户已知且出现在文本中」的词，用于注入提示词上下文。
 * 用于精读前告知 AI 用户已掌握的词汇，避免重复作为新词、并保留 mastery。
 */
export function pickKnownWordsInText(
    data: VocabData,
    text: string,
    limit: number
): Word[] {
    const lower = text.toLowerCase();
    const hits = Object.values(data.words).filter((w) =>
        lower.includes(w.term.toLowerCase())
    );
    // 优先返回掌握度低（更值得关注）的词，但整体仍限流
    hits.sort((a, b) => a.mastery - b.mastery);
    return hits.slice(0, limit);
}
