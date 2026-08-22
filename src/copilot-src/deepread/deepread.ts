/**
 * 句子精读编排器
 *
 * 流程：
 *   1. 解析当前对话模型（复用 Copilot 已有的 currentProvider / currentModelId 凭据）；
 *   2. 读取词库，抽取「文本中出现的已知词」注入提示词（双向闭环：精读前告知 AI 用户已掌握词汇）；
 *   3. 调用 chat() 以 JSON 模式产出 单词详解表 + 句子结构分析表；
 *   4. 解析结果，给每个单词补上 sourceBlockID，upsert 写回 vocab.json（双向闭环：精读后沉淀词库）。
 */
import { get } from 'svelte/store';
import { chat } from '../ai-chat';
import { settingsStore } from '../stores/settings';
import {
    loadVocab,
    saveVocab,
    upsertWord,
    pickKnownWordsInText,
} from './vocab-store';
import type { DeepReadConfig, DeepReadResult, Word } from './types';

const DEFAULT_SYSTEM_PROMPT = `你是一位专业的英语精读与词汇辅导老师。用户会给你一段英文文本，请完成两件事：

1）单词详解：提取文本中值得学习的单词（生词、重点词、固定搭配），给出音标、词性、中文释义与例句；
2）句子结构分析：挑选文本中的关键句子，拆解主谓宾/从句等成分，说明语法点，并给出译文。

若提供了「用户已知词汇」，请据此判断：已在其中的词不要作为新词重复列出（除非你想为其补充新例句，此时 mastery 沿用给出的数值）；重点提取用户尚未掌握的词，新词 mastery 设为 0。

你必须只输出一个 JSON 对象，禁止使用 Markdown 代码块包裹，禁止输出任何解释性文字。JSON 结构严格如下：
{
  "thinking": "（可选）简短的分析思路",
  "vocab": [
    { "term": "单词原形", "phonetic": "音标", "pos": "词性如 n./v.", "definitions": ["释义1","释义2"], "examples": ["英文例句"], "mastery": 0 }
  ],
  "sentenceAnalysis": [
    { "sentence": "原句", "translation": "译文", "components": [{"role":"主语","text":"..."}], "grammar": "语法点说明" }
  ]
}`;

const DEFAULT_DEEPREAD: DeepReadConfig = {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 4096,
    enableThinking: false,
    maxKnownWords: 200,
};

export interface RunDeepReadParams {
    plugin: any;
    /** 待精读的原文（英文） */
    text: string;
    /** 来源思源块 ID（用于词库溯源） */
    sourceBlockId?: string;
    onThinking?: (s: string) => void;
    onComplete: (result: DeepReadResult) => void;
    onError?: (e: Error) => void;
    signal?: AbortSignal;
    /** 调试用：覆盖系统提示词 */
    systemPromptOverride?: string;
}

interface ResolvedModel {
    provider: string;
    providerConfig: any;
    modelConfig: any;
    deepread: DeepReadConfig;
}

function resolveModel(settings: any): ResolvedModel | null {
    const provider = settings?.currentProvider;
    const modelId = settings?.currentModelId;
    if (!provider || !modelId) return null;
    const providerConfig = settings.aiProviders?.[provider];
    if (!providerConfig) return null;
    const modelConfig = (providerConfig.models || []).find(
        (m: any) => m.id === modelId
    );
    if (!modelConfig) return null;
    const deepread: DeepReadConfig = {
        systemPrompt:
            settings.deepreadSystemPrompt && settings.deepreadSystemPrompt.trim()
                ? settings.deepreadSystemPrompt
                : DEFAULT_DEEPREAD.systemPrompt,
        temperature:
            typeof settings.deepreadTemperature === 'number'
                ? settings.deepreadTemperature
                : DEFAULT_DEEPREAD.temperature,
        maxTokens: settings.deepreadMaxTokens || DEFAULT_DEEPREAD.maxTokens,
        enableThinking:
            typeof settings.deepreadEnableThinking === 'boolean'
                ? settings.deepreadEnableThinking
                : DEFAULT_DEEPREAD.enableThinking,
        maxKnownWords:
            settings.deepreadMaxKnownWords || DEFAULT_DEEPREAD.maxKnownWords,
    };
    return { provider, providerConfig, modelConfig, deepread };
}

function buildMessages(
    text: string,
    knownWords: Word[],
    systemPrompt: string
): any[] {
    let system = systemPrompt;
    if (knownWords.length > 0) {
        const knownLines = knownWords
            .map((w) => `- ${w.term}: ${w.mastery}`)
            .join('\n');
        system += `\n\n用户已知词汇（term: 掌握度0-5），已在其中的词请勿重复作为新词，已知词 mastery 请沿用给出的数值：\n${knownLines}`;
    }
    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: `请对下面这段英文做精读分析：\n\n${text}`,
        },
    ];
}

/** 容错解析：剥离代码块、截取首尾大括号、JSON.parse */
function parseResult(raw: string): DeepReadResult {
    let s = (raw || '').trim();
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    const obj = JSON.parse(s);
    return {
        thinking: typeof obj.thinking === 'string' ? obj.thinking : undefined,
        vocab: Array.isArray(obj.vocab) ? obj.vocab : [],
        sentenceAnalysis: Array.isArray(obj.sentenceAnalysis)
            ? obj.sentenceAnalysis
            : [],
    };
}

export async function runDeepRead(params: RunDeepReadParams): Promise<void> {
    const { plugin, text, sourceBlockId, onThinking, onComplete, onError, signal } =
        params;

    const settings = get(settingsStore);
    const resolved = resolveModel(settings);
    if (!resolved) {
        const err = new Error(
            '未配置可用的对话模型，请先在设置中选择并配置一个 AI 模型'
        );
        onError?.(err);
        throw err;
    }
    const { provider, providerConfig, modelConfig, deepread } = resolved;

    // 1. 读取词库，抽取文本中出现的已知词作为上下文
    const vocab = await loadVocab(plugin);
    const knownWords = pickKnownWordsInText(vocab, text, deepread.maxKnownWords);

    // 2. 组装消息
    const messages = buildMessages(
        text,
        knownWords,
        params.systemPromptOverride || deepread.systemPrompt
    );

    // 3. 思考模式仅在模型支持时启用
    const enableThinking =
        !!deepread.enableThinking && !!modelConfig.capabilities?.thinking;

    // Gemini 不展开 customBody（response_format 不兼容），其余 OpenAI 系展开
    const customBody =
        provider === 'gemini'
            ? undefined
            : { response_format: { type: 'json_object' } };

    let fullText = '';
    let thinkingText = '';
    try {
        await chat(
            provider,
            {
                apiKey: providerConfig.apiKey,
                model: modelConfig.id,
                messages,
                temperature: deepread.temperature,
                maxTokens:
                    modelConfig.maxTokens > 0 ? modelConfig.maxTokens : deepread.maxTokens,
                stream: true,
                signal,
                enableThinking,
                reasoningEffort: modelConfig.thinkingEffort || 'medium',
                customBody,
                onThinkingChunk: (c: string) => {
                    thinkingText += c;
                    onThinking?.(thinkingText);
                },
                onThinkingComplete: () => {},
                onChunk: () => {},
                onComplete: (full: string) => {
                    fullText = full;
                },
                onError: (e: Error) => {
                    onError?.(e);
                },
            },
            providerConfig.customApiUrl,
            providerConfig.advancedConfig
        );
    } catch (e) {
        // chat 内部已调用 onError；此处再抛出以中断后续写回
        if ((e as Error).message !== 'Request aborted') {
            onError?.(e as Error);
        }
        throw e;
    }

    // 4. 解析结果
    let result: DeepReadResult;
    try {
        result = parseResult(fullText);
    } catch (e) {
        const err = new Error(
            'AI 返回内容无法解析为 JSON，请重试或检查模型是否支持 JSON 模式'
        );
        onError?.(err);
        throw err;
    }

    // 5. 双向闭环：给每个单词补 sourceBlockID 并 upsert 写回词库
    const stampWord = (w: any): Word => ({
        term: String(w.term || '').trim(),
        phonetic: w.phonetic ? String(w.phonetic) : undefined,
        pos: w.pos ? String(w.pos) : undefined,
        definitions: Array.isArray(w.definitions)
            ? w.definitions.map((d: any) => String(d))
            : [],
        examples: Array.isArray(w.examples)
            ? w.examples.map((e: any) => String(e))
            : [],
        mastery:
            typeof w.mastery === 'number' && w.mastery >= 0 && w.mastery <= 5
                ? w.mastery
                : 0,
        sourceBlockIDs: sourceBlockId ? [sourceBlockId] : [],
        createdAt: Date.now(),
        lastSeen: Date.now(),
    });

    for (const raw of result.vocab) {
        if (!raw?.term) continue;
        upsertWord(vocab, stampWord(raw));
    }
    await saveVocab(plugin, vocab);

    // 若启用思考模式但模型未走流式思考，用 JSON 里的 thinking 兜底
    if (!thinkingText && result.thinking) {
        thinkingText = result.thinking;
    }
    result.thinking = thinkingText || result.thinking;

    onComplete(result);
}
