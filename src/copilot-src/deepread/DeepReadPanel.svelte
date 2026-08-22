<script lang="ts">
    import { onDestroy } from 'svelte';
    import { runDeepRead } from '../deepread/deepread';
    import { formatMessage } from '../utils/markdown';
    import type { DeepReadResult, Word, SentenceAnalysis } from '../deepread/types';

    export let plugin: any;
    export let initialMessage = '';
    export let sourceBlockId = '';

    let inputText = initialMessage || '';
    let thinking = '';
    let thinkingCollapsed = true;
    let result: DeepReadResult | null = null;
    let loading = false;
    let error = '';
    let savedNote = false;
    let copied = false;
    let abort: AbortController | null = null;

    async function start() {
        if (loading) return;
        if (!inputText.trim()) {
            error = '请先输入或选中要精读的英文文本';
            return;
        }
        loading = true;
        error = '';
        thinking = '';
        result = null;
        savedNote = false;
        copied = false;
        abort = new AbortController();
        try {
            await runDeepRead({
                plugin,
                text: inputText.trim(),
                sourceBlockId,
                signal: abort.signal,
                onThinking: (s) => {
                    thinking = s;
                    if (s) thinkingCollapsed = false;
                },
                onComplete: (r) => {
                    result = r;
                    savedNote = true;
                },
                onError: (e) => {
                    error = e.message || String(e);
                },
            });
        } catch (e) {
            if ((e as Error).message !== 'Request aborted') {
                error = (e as Error).message || String(e);
            }
        } finally {
            loading = false;
            abort = null;
        }
    }

    function stop() {
        abort?.abort();
    }

    function toggleThinking() {
        thinkingCollapsed = !thinkingCollapsed;
    }

    function buildMarkdown(r: DeepReadResult): string {
        const lines: string[] = [];
        lines.push('## 句子精读');
        if (r.vocab.length) {
            lines.push('');
            lines.push('### 单词详解');
            lines.push('| 单词 | 音标 | 词性 | 释义 | 例句 | 掌握度 |');
            lines.push('| --- | --- | --- | --- | --- | --- |');
            for (const w of r.vocab) {
                const defs = (w.definitions || []).join('；');
                const exs = (w.examples || []).join('<br>');
                lines.push(
                    `| ${w.term} | ${w.phonetic || ''} | ${w.pos || ''} | ${defs} | ${exs} | ${w.mastery} |`
                );
            }
        }
        if (r.sentenceAnalysis.length) {
            lines.push('');
            lines.push('### 句子结构分析');
            for (const s of r.sentenceAnalysis) {
                lines.push('');
                lines.push(`**${s.sentence}**`);
                if (s.translation) lines.push(`> 译文：${s.translation}`);
                if (s.components?.length) {
                    lines.push('');
                    lines.push('| 成分 | 内容 |');
                    lines.push('| --- | --- |');
                    for (const c of s.components) {
                        lines.push(`| ${c.role} | ${c.text} |`);
                    }
                }
                if (s.grammar) lines.push(`\n语法点：${s.grammar}`);
            }
        }
        return lines.join('\n');
    }

    async function copyMarkdown() {
        if (!result) return;
        const md = buildMarkdown(result);
        try {
            await navigator.clipboard.writeText(md);
            copied = true;
            setTimeout(() => (copied = false), 1500);
        } catch (e) {
            error = '复制失败：' + (e as Error).message;
        }
    }

    function masteryLabel(m: number): string {
        return ['不认识', '生疏', '模糊', '半熟', '较熟', '掌握'][m] ?? '未知';
    }

    onDestroy(() => abort?.abort());
</script>

<div class="deepread-panel">
    <div class="deepread-header">
        <div class="deepread-title">句子精读 · 词库联动</div>
        {#if sourceBlockId}
            <div class="deepread-source">来源块：{sourceBlockId}</div>
        {/if}
    </div>

    <div class="deepread-input-wrap">
        <textarea
            class="deepread-input b3-text-field"
            bind:value={inputText}
            placeholder="粘贴或输入要精读的英文段落（也可在正文中选中文字后点击工具栏按钮自动带入）"
            rows="6"
        ></textarea>
    </div>

    <div class="deepread-actions">
        {#if !loading}
            <button class="b3-button" on:click={start}>开始精读</button>
        {:else}
            <button class="b3-button b3-button--error" on:click={stop}>停止</button>
        {/if}
        {#if result}
            <button class="b3-button b3-button--outline" on:click={copyMarkdown}>
                {copied ? '已复制' : '复制为 Markdown'}
            </button>
        {/if}
    </div>

    {#if error}
        <div class="deepread-error">{error}</div>
    {/if}

    {#if thinking}
        <div class="ai-message__thinking">
            <div
                class="ai-message__thinking-header"
                on:click={toggleThinking}
                role="button"
                tabindex="0"
                on:keydown={(e) => e.key === 'Enter' && toggleThinking()}
            >
                <svg
                    class="ai-message__thinking-icon"
                    class:collapsed={thinkingCollapsed}
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                >
                    <path d="M8 5v14l11-7z" />
                </svg>
                <span class="ai-message__thinking-title">💭 思考过程</span>
            </div>
            {#if !thinkingCollapsed}
                <div class="ai-message__thinking-content b3-typography">
                    {@html formatMessage(thinking)}
                </div>
            {/if}
        </div>
    {/if}

    {#if result}
        {#if savedNote}
            <div class="deepread-saved">✅ 已自动写入词库 vocab.json（含来源块溯源）</div>
        {/if}

        {#if result.vocab.length}
            <div class="deepread-section">
                <h3>单词详解表</h3>
                <div class="deepread-table-wrap">
                    <table class="deepread-table b3-table">
                        <thead>
                            <tr>
                                <th>单词</th>
                                <th>音标</th>
                                <th>词性</th>
                                <th>释义</th>
                                <th>例句</th>
                                <th>掌握度</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each result.vocab as w (w.term)}
                                <tr>
                                    <td class="dr-word">{w.term}</td>
                                    <td class="dr-phon">{w.phonetic || ''}</td>
                                    <td class="dr-pos">{w.pos || ''}</td>
                                    <td class="dr-def">{w.definitions?.join('；') || ''}</td>
                                    <td class="dr-ex"
                                        >{#each w.examples || [] as ex, i}
                                            <div>{ex}</div>
                                        {/each}</td
                                    >
                                    <td class="dr-mastery">
                                        <span class="dr-mastery-badge m{w.mastery}"
                                            >{w.mastery} · {masteryLabel(w.mastery)}</span
                                        >
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        {/if}

        {#if result.sentenceAnalysis.length}
            <div class="deepread-section">
                <h3>句子结构分析表</h3>
                <div class="deepread-sentences">
                    {#each result.sentenceAnalysis as s, i (i)}
                        <div class="deepread-sentence">
                            <div class="dr-sentence-text">{s.sentence}</div>
                            {#if s.translation}
                                <div class="dr-sentence-trans">↳ {s.translation}</div>
                            {/if}
                            {#if s.components?.length}
                                <table class="deepread-table b3-table dr-comp">
                                    <thead>
                                        <tr><th>成分</th><th>内容</th></tr>
                                    </thead>
                                    <tbody>
                                        {#each s.components as c}
                                            <tr>
                                                <td class="dr-role">{c.role}</td>
                                                <td>{c.text}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            {/if}
                            {#if s.grammar}
                                <div class="dr-grammar">语法点：{s.grammar}</div>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    {/if}
</div>

<style>
    .deepread-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 16px;
        box-sizing: border-box;
        overflow: auto;
        gap: 12px;
        color: var(--b3-theme-on-background);
    }
    .deepread-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
    }
    .deepread-title {
        font-size: 16px;
        font-weight: 600;
    }
    .deepread-source {
        font-size: 12px;
        color: var(--b3-theme-on-surface);
        opacity: 0.7;
        max-width: 50%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .deepread-input {
        width: 100%;
        resize: vertical;
        font-family: var(--b3-font-family-code);
        box-sizing: border-box;
        line-height: 1.5;
    }
    .deepread-actions {
        display: flex;
        gap: 8px;
    }
    .deepread-error {
        color: var(--b3-theme-error);
        background: var(--b3-theme-error-background);
        padding: 8px 10px;
        border-radius: 4px;
        font-size: 13px;
    }
    .deepread-saved {
        font-size: 13px;
        color: var(--b3-theme-success);
    }
    .deepread-section h3 {
        margin: 4px 0 8px;
        font-size: 14px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }
    .deepread-table-wrap {
        overflow-x: auto;
    }
    .deepread-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }
    .deepread-table th,
    .deepread-table td {
        border: 1px solid var(--b3-theme-surface-lighter);
        padding: 6px 8px;
        text-align: left;
        vertical-align: top;
    }
    .deepread-table th {
        background: var(--b3-theme-surface);
        font-weight: 600;
    }
    .dr-word {
        font-weight: 600;
        color: var(--b3-theme-primary);
    }
    .dr-phon {
        color: var(--b3-theme-on-surface);
        font-style: italic;
    }
    .dr-mastery-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 12px;
        white-space: nowrap;
        color: #fff;
    }
    .m0 { background: #d9534f; }
    .m1 { background: #ec971f; }
    .m2 { background: #f0ad4e; }
    .m3 { background: #5bc0de; }
    .m4 { background: #5cb85c; }
    .m5 { background: #4cae4c; }
    .deepread-sentences {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .deepread-sentence {
        border-left: 3px solid var(--b3-theme-primary-lighter);
        padding-left: 12px;
    }
    .dr-sentence-text {
        font-weight: 600;
        line-height: 1.5;
    }
    .dr-sentence-trans {
        color: var(--b3-theme-on-surface);
        font-size: 13px;
        margin-top: 2px;
    }
    .dr-comp {
        margin-top: 6px;
        font-size: 12px;
    }
    .dr-role {
        font-weight: 600;
        color: var(--b3-theme-primary);
        white-space: nowrap;
    }
    .dr-grammar {
        margin-top: 6px;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
    }
    /* 复用思源思考面板折叠图标旋转 */
    .ai-message__thinking-icon {
        transition: transform 0.2s ease;
    }
    .ai-message__thinking-icon.collapsed {
        transform: rotate(-90deg);
    }
    .ai-message__thinking-header {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
    }
    .ai-message__thinking-content {
        margin-top: 6px;
        padding: 8px 10px;
        background: var(--b3-theme-surface);
        border-radius: 4px;
        font-size: 13px;
    }
</style>
