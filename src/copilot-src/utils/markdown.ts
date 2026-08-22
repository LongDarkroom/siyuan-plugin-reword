/**
 * Markdown -> HTML 渲染工具（共享）
 *
 * 复刻 ai-sidebar.svelte 内局部 formatMessage 的逻辑：
 * 优先使用思源 Lute 的 Md2HTML（不生成带 data-node-id 的块结构，
 * 可正常跨块选择文本），Lute 不可用时降级为正则简单渲染。
 */
import type { MessageContent } from '../ai-chat';

function getMessageText(content: string | MessageContent[]): string {
    if (typeof content === 'string') return content;
    return content
        .map((p) => (p.type === 'text' ? p.text || '' : ''))
        .join('');
}

export function formatMessage(content: string | MessageContent[]): string {
    const textContent = getMessageText(content);

    try {
        if (typeof window !== 'undefined' && (window as any).Lute) {
            const lute = (window as any).Lute.New();
            // Md2HTML 不会生成块级 data-node-id 结构，适合气泡内渲染
            return lute.Md2HTML(textContent);
        }
        // Lute 不可用时的简单降级
        return textContent
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(
                /```(\w+)?\n([\s\S]*?)```/g,
                '<pre><code class="language-$1">$2</code></pre>'
            )
            .replace(/\n/g, '<br>');
    } catch (error) {
        console.error('[deepread] formatMessage error:', error);
        return textContent;
    }
}
