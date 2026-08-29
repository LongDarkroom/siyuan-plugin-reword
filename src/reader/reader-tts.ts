/**
 * ReaderTtsController —— Reword 阅读器连续朗读控制器
 * --------------------------------------------------------------------------
 * 设计目标（参考 Readest 朗读体验）：
 *   - 连续朗读（不是只读一个词）：基于 foliate 的 getSentences() 枚举文档句子序列
 *   - 句子高亮跟随：临时 class 套在当前句 range 上，停止/卸载即清理（零正文污染）
 *   - 播放控制条：上段/上句/播放暂停/下句/下段/停止 + 语速即时调节
 *   - 多引擎：系统语音(Web Speech) / 有道 dictvoice / Edge TTS（云端神经音）
 *
 * 与 foliate 的关系：
 *   - foliate 的 TTS 类（vendor/foliate-js/tts.js）只做「分段 + SSML + 高亮定位」，
 *     不负责发声。这里直接复用更底层的 getSentences() 生成器，拿到 {blockIndex, markName, range}，
 *     range 既用于高亮也用于取文本，对不同发声引擎都友好，且绕开了 SSML 解析复杂度。
 *
 * 重要约束（reword 维护铁律）：
 *   - 高亮必须走临时通道，绝不写进 addAnnotation / foliate 标注体系（卸载无残留）
 *   - 不修改任何书籍 DOM 结构（surroundContents 跨节点失败则降级，清理时 unwrap）
 *
 * 不依赖：annotation / vocab / ai / dict（reader 内部独立模块）
 */
// @ts-ignore - foliate vendor 为纯 JS，无类型声明（仅运行时 import）
import { getSentences } from "./vendor/foliate-js/tts.js";
// @ts-ignore - foliate vendor 为纯 JS，无类型声明（仅运行时 import）
import { textWalker } from "./vendor/foliate-js/text-walker.js";

// ============================================================
// 类型定义
// ============================================================

/** 朗读引擎类型（在 reword 内扩展 foliate，新增 edge） */
export type TtsEngineKind = "system" | "youdao" | "edge" | "auto";

/** 朗读粒度 */
export type TtsGranularity = "sentence" | "word";

/** 朗读范围 */
export type TtsScope = "selection" | "section" | "book";

/** 高亮样式 */
export type TtsHighlightStyle = "background" | "underline" | "wave" | "outline";

/** 扩展后的朗读设置（兼容旧 TtsSettings 的 engine/rate/pitch/accent/preferVoiceURI/interval） */
export interface RewordTtsSettings {
  engine: TtsEngineKind;
  rate: number;            // 0.5 ~ 3（系统/Edge 生效；有道忽略）
  pitch: number;           // 0.5 ~ 2（仅系统语音生效）
  volume: number;          // 0 ~ 1（Edge/有道/系统均生效）
  accent: "uk" | "us";     // 有道口音：uk=英音 / us=美音
  preferVoiceURI?: string; // 系统语音优先 voiceURI
  granularity: TtsGranularity;
  scope: TtsScope;
  enableHighlight: boolean;
  highlightStyle: TtsHighlightStyle;
  highlightColor: string;
  autoPage: boolean;       // 读完当前节自动翻页续读
  sleepTimerMin: number;   // 0 = 关闭
  interval: number;        // 句间停顿（毫秒）
}

export const DEFAULT_REWORD_TTS: RewordTtsSettings = {
  engine: "system",
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  accent: "us",
  granularity: "sentence",
  scope: "book",
  enableHighlight: true,
  highlightStyle: "background",
  highlightColor: "#ffe082",
  autoPage: true,
  sleepTimerMin: 0,
  interval: 350,
};

export type TtsState = "idle" | "playing" | "paused";

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceURI?: string;
  accent?: "uk" | "us";
  onBoundary?: (charIndex: number) => void;
}

/** 发声后端抽象：把一段文本朗读完（resolve）或失败（reject） */
export interface TtsBackend {
  readonly name: TtsEngineKind;
  supported(): boolean;
  /** 朗读文本，resolved 表示朗读结束；reject 表示失败（供 fallback 使用） */
  speak(text: string, opts: SpeakOptions): Promise<void>;
  cancel(): void;
  /** 是否能在朗读中上报词边界（用于逐词高亮） */
  readonly supportsBoundary?: boolean;
}

// ============================================================
// 引擎后端实现
// ============================================================

/** 系统语音（Web Speech API / speechSynthesis） */
class SystemBackend implements TtsBackend {
  readonly name = "system" as const;
  readonly supportsBoundary = true;
  private synth: SpeechSynthesis | null;

  constructor() {
    this.synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  }

  supported(): boolean {
    return !!this.synth;
  }

  speak(text: string, opts: SpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const synth = this.synth;
      if (!synth) return reject(new Error("speechSynthesis 不可用"));
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang || "en-US";
      u.rate = opts.rate ?? 1;
      u.pitch = opts.pitch ?? 1;
      u.volume = opts.volume ?? 1;
      if (opts.voiceURI) {
        const v = (synth.getVoices() || []).find((x) => x.voiceURI === opts.voiceURI);
        if (v) u.voice = v;
      }
      let done = false;
      u.onend = () => { if (!done) { done = true; resolve(); } };
      u.onerror = (e: any) => { if (!done) { done = true; reject(new Error(e?.error || "speech error")); } };
      if (opts.onBoundary) u.onboundary = (e: any) => opts.onBoundary?.(e.charIndex || 0);
      try {
        synth.cancel(); // 取消上一条，避免排队堆积
        synth.speak(u);
      } catch (err) {
        reject(err);
      }
    });
  }

  cancel(): void {
    try { this.synth?.cancel(); } catch { /* 忽略 */ }
  }
}

/** 有道 dictvoice 在线真人音（按词朗读质量优于机械音，句子偏机械） */
class YoudaoBackend implements TtsBackend {
  readonly name = "youdao" as const;
  private current: HTMLAudioElement | null = null;

  supported(): boolean {
    return typeof Audio !== "undefined";
  }

  speak(text: string, opts: SpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const type = opts.accent === "uk" ? 1 : 2;
        const audio = new Audio(
          `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}&le=en`
        );
        this.current = audio;
        audio.volume = opts.volume ?? 1;
        audio.onended = () => { this.current = null; resolve(); };
        audio.onerror = () => { this.current = null; reject(new Error("youdao play error")); };
        const p = audio.play();
        if (p && typeof p.catch === "function") p.catch((e) => { this.current = null; reject(e); });
      } catch (err) {
        reject(err);
      }
    });
  }

  cancel(): void {
    try { this.current?.pause(); } catch { /* 忽略 */ }
    this.current = null;
  }
}

/**
 * Edge TTS 云端神经语音（WebSocket 流式）。
 * 采用 Edge 公开 trusted client token + X-Timestamp 头；音频累积为 mp3 Blob 后用 <audio> 播放。
 * 失败（网络/区域拦截）会 reject，由 createBackend 回退到系统语音。
 */
class EdgeBackend implements TtsBackend {
  readonly name = "edge" as const;
  private current: HTMLAudioElement | null = null;
  // Edge 公开 trusted client token（历史常量，社区通用）
  private static readonly TRUSTED_TOKEN = "6A5AA1D18AC1447B9A5172F5FB41C3E3";
  private static readonly WS_URL =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

  supported(): boolean {
    return typeof WebSocket !== "undefined" && typeof Audio !== "undefined";
  }

  private buildSsml(text: string, opts: SpeakOptions): string {
    const voice = opts.lang && opts.lang.toLowerCase().startsWith("zh")
      ? "zh-CN-XiaoxiaoNeural"
      : "en-US-AriaNeural";
    const rate = Math.round(((opts.rate ?? 1) - 1) * 100); // -100% ~ +100%
    const pitch = Math.round(((opts.pitch ?? 1) - 1) * 50);  // -50% ~ +50%
    const vol = Math.round((opts.volume ?? 1) * 100);
    const rateStr = (rate >= 0 ? "+" : "") + rate + "%";
    const pitchStr = (pitch >= 0 ? "+" : "") + pitch + "%";
    const volStr = (vol >= 0 ? "+" : "") + vol + "%";
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${opts.lang || "en-US"}">` +
      `<voice name="${voice}"><prosody rate="${rateStr}" pitch="${pitchStr}" volume="${volStr}">` +
      `${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</prosody></voice></speak>`;
  }

  speak(text: string, opts: SpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(EdgeBackend.WS_URL);
      } catch (err) {
        return reject(err);
      }
      const chunks: Uint8Array[] = [];
      void EdgeBackend.TRUSTED_TOKEN; // 预留：现代 Edge 部分区域要求 Sec-MS-GEC，这里用基础握手
      let gotAudio = false;

      const finish = (ok: boolean, err?: unknown) => {
        try { ws.close(); } catch { /* 忽略 */ }
        if (!ok) { this.cancel(); return reject(err || new Error("edge tts failed")); }
        if (!chunks.length) { this.cancel(); return reject(new Error("edge tts empty audio")); }
        const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.current = audio;
        audio.volume = opts.volume ?? 1;
        audio.onended = () => { URL.revokeObjectURL(url); this.current = null; resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); this.current = null; reject(new Error("edge play error")); };
        const p = audio.play();
        if (p && typeof p.catch === "function") p.catch((e) => { URL.revokeObjectURL(url); this.current = null; reject(e); });
      };

      const onMessage = (ev: MessageEvent) => {
        if (typeof ev.data === "string") {
          // 控制帧：audio 头出现后即进入音频阶段；turn.end 表示结束
          if (ev.data.includes("Path:turn.end") || ev.data.includes("TurnEnd")) {
            finish(gotAudio);
          }
          return;
        }
        // binary：前 2 字节 header 长度（大端），后面是 audio 或边界 json
        try {
          const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(0);
          if (buf.length < 2) return;
          const headerLen = (buf[0] << 8) | buf[1];
          const body = buf.slice(2 + headerLen);
          gotAudio = true;
          chunks.push(body);
        } catch {
          /* 忽略坏帧 */
        }
      };

      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        const ts = new Date().toUTCString().replace("GMT", "GMT");
        ws.send(`X-Timestamp: ${ts}\r\n` +
          `Content-Type: application/json; charset=utf-8\r\n` +
          `Path: speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
        ws.send(`X-Timestamp: ${ts}\r\n` +
          `Content-Type: application/ssml+xml\r\n` +
          `Path: ssml\r\n\r\n` +
          this.buildSsml(text, opts));
      };
      ws.onmessage = onMessage;
      ws.onerror = () => finish(false, new Error("edge ws error"));
    });
  }

  cancel(): void {
    try { this.current?.pause(); } catch { /* 忽略 */ }
    this.current = null;
  }
}

/** 选择后端（auto 时在线优先，失败回退系统） */
export function createBackend(
  settings: RewordTtsSettings
): { primary: TtsBackend; fallback: TtsBackend | null } {
  const system = new SystemBackend();
  const youdao = new YoudaoBackend();
  const edge = new EdgeBackend();
  const available = (b: TtsBackend) => b.supported();

  let primary: TtsBackend | null = null;
  let fallback: TtsBackend | null = system;

  switch (settings.engine) {
    case "system":
      primary = system;
      fallback = null;
      break;
    case "youdao":
      primary = available(youdao) ? youdao : system;
      fallback = primary === youdao ? system : null;
      break;
    case "edge":
      primary = available(edge) ? edge : system;
      fallback = primary === edge ? system : null;
      break;
    case "auto":
    default:
      // 在线优先：edge > youdao > system
      if (available(edge)) { primary = edge; fallback = system; }
      else if (available(youdao)) { primary = youdao; fallback = system; }
      else { primary = system; fallback = null; }
      break;
  }
  if (!primary) primary = system;
  return { primary, fallback };
}

// ============================================================
// 朗读控制器
// ============================================================

export interface SentenceItem {
  blockIndex: number;
  markName: string;
  range: Range;
  text: string;
}

export interface ReaderTtsCallbacks {
  /** 状态变化（idle/playing/paused） */
  onState?: (s: TtsState) => void;
  /** 当前句下标 / 总句数 变化 */
  onProgress?: (index: number, total: number) => void;
  /** 当前句文本（用于控制条显示 / 收词） */
  onSentence?: (text: string, index: number) => void;
  /** 需要滚动使某 range 可见（自动翻页由 onAutoPage 处理） */
  onNeedVisible?: (range: Range) => void;
  /** 读完当前节且开启 autoPage 时回调（返回 Promise 表示翻页是否成功） */
  onAutoPage?: () => Promise<boolean> | boolean;
  /** 出错（含 fallback 失败） */
  onError?: (msg: string) => void;
}

const HL_CLASS = "reword-tts-hl";

export class ReaderTtsController {
  private getDocs: () => Document[];
  private settings: RewordTtsSettings;
  private cb: ReaderTtsCallbacks;

  private sentences: SentenceItem[] = [];
  private cursor = 0;
  private state: TtsState = "idle";
  private backend: TtsBackend | null = null;
  private fallback: TtsBackend | null = null;
  private highlightEls: HTMLElement[] = [];
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private loopToken = 0; // 防止并发 loop
  private pausedAtSentence = -1;

  constructor(getDocs: () => Document[], settings: RewordTtsSettings, cb: ReaderTtsCallbacks = {}) {
    this.getDocs = getDocs;
    this.settings = { ...settings };
    this.cb = cb;
  }

  setSettings(s: RewordTtsSettings) {
    this.settings = { ...s };
  }

  getState(): TtsState {
    return this.state;
  }

  getProgress(): { index: number; total: number } {
    return { index: this.cursor, total: this.sentences.length };
  }

  /** 枚举所有已加载 doc 的句子（多节可见时拼接） */
  private rebuild(): SentenceItem[] {
    const docs = this.getDocs() || [];
    const items: SentenceItem[] = [];
    for (const doc of docs) {
      if (!doc) continue;
      try {
        for (const seg of getSentences(doc, textWalker, null, this.settings.granularity)) {
          const range = seg.range as Range;
          const text = (range?.toString?.() || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          items.push({ blockIndex: seg.blockIndex, markName: seg.markName, range, text });
        }
      } catch (e) {
        console.warn("[REword TTS] 枚举句子失败", e);
      }
    }
    return items;
  }

  /** 从某个 range（选区）定位起始句 */
  private findCursor(target: Range): number {
    for (let i = 0; i < this.sentences.length; i++) {
      const r = this.sentences[i].range;
      try {
        if (r.compareBoundaryPoints(Range.START_TO_START, target) >= 0) return i;
      } catch { /* 跨 doc 比较可能抛错，忽略 */ }
    }
    return 0;
  }

  /** 检查当前 cursor 的 range 是否仍有效（翻页后失效） */
  private isRangeAlive(range: Range): boolean {
    try {
      const node = range.startContainer;
      let p: Node | null = node;
      while (p) {
        if (p.nodeType === 9 /* DOCUMENT_NODE */) return true;
        p = p.parentNode;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 内容签名：取总句数 + 前 3 句文本拼接，用于判断 autoPage 前后内容是否真的变化。
   * 末节翻页失败（goRight 无实际前进）时前后签名相同 → 控制器据此结束而非重读。
   */
  private signatureOf(items: SentenceItem[]): string {
    return items.length + "|" + items.slice(0, 3).map((x) => x.text).join("§");
  }

  // -------- 公开控制 --------

  /** 从选区或当前位置开始连续朗读 */
  async playFrom(range?: Range) {
    this.sentences = this.rebuild();
    if (this.sentences.length === 0) {
      this.cb.onError?.("无可朗读内容");
      return;
    }
    if (range) this.cursor = this.findCursor(range);
    else if (this.state === "paused" && this.pausedAtSentence >= 0) this.cursor = this.pausedAtSentence;

    const { primary, fallback } = createBackend(this.settings);
    this.backend = primary;
    this.fallback = fallback;

    this.state = "playing";
    this.cb.onState?.(this.state);
    this.startSleepTimer();
    this.loop();
  }

  /** 从头（或当前句）继续 */
  async play() {
    if (this.state === "paused") return this.resume();
    if (this.sentences.length === 0) return this.playFrom();
    this.state = "playing";
    this.cb.onState?.(this.state);
    this.loop();
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.pausedAtSentence = this.cursor;
    this.backend?.cancel();
    this.fallback?.cancel();
    this.clearHighlight();
    this.cb.onState?.(this.state);
    this.stopSleepTimer();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.cb.onState?.(this.state);
    this.startSleepTimer();
    this.loop();
  }

  stop() {
    this.state = "idle";
    this.pausedAtSentence = -1;
    this.backend?.cancel();
    this.fallback?.cancel();
    this.clearHighlight();
    this.stopSleepTimer();
    this.loopToken++;
    this.cb.onState?.(this.state);
    this.sentences = [];
    this.cursor = 0;
  }

  next() {
    if (this.state === "idle") return;
    this.backend?.cancel();
    this.fallback?.cancel();
    this.cursor++;
    if (this.state === "playing") this.loop();
    else this.cb.onProgress?.(this.cursor, this.sentences.length);
  }

  prev() {
    if (this.state === "idle") return;
    this.backend?.cancel();
    this.fallback?.cancel();
    this.cursor = Math.max(0, this.cursor - 2);
    if (this.state === "playing") this.loop();
    else this.cb.onProgress?.(this.cursor, this.sentences.length);
  }

  /** 设置语速即时生效（下次朗读起） */
  setRate(rate: number) {
    this.settings.rate = rate;
  }

  // -------- 核心循环 --------

  private async loop() {
    const token = ++this.loopToken;
    while (this.state === "playing" && token === this.loopToken) {
      // 越界检查
      if (this.cursor >= this.sentences.length) {
        // 本节读完：自动翻页续读（仅全书范围）
        if (this.settings.autoPage && this.settings.scope === "book") {
          const sigBefore = this.signatureOf(this.sentences);
          const advanced = (await this.cb.onAutoPage?.()) ?? false;
          if (advanced) {
            const rebuilt = this.rebuild();
            // 关键护栏：翻页后内容签名未变（已到末节，goRight 无实际前进）
            // 则视为全书读完，避免末节无限重读死循环。
            if (rebuilt.length > 0 && this.signatureOf(rebuilt) !== sigBefore) {
              this.sentences = rebuilt;
              this.cursor = 0;
              continue;
            }
          }
        }
        this.finishBook();
        return;
      }

      // range 失效（翻页导致 doc 重建）→ 重新枚举并重定位到可见位置
      const item = this.sentences[this.cursor];
      if (!item || !this.isRangeAlive(item.range)) {
        const rebuilt = this.rebuild();
        if (rebuilt.length === 0) { this.finishBook(); return; }
        this.sentences = rebuilt;
        this.cursor = 0;
        continue;
      }

      this.highlight(item.range);
      this.cb.onProgress?.(this.cursor, this.sentences.length);
      this.cb.onSentence?.(item.text, this.cursor);
      this.cb.onNeedVisible?.(item.range);

      const spoken = await this.speakWithFallback(item.text);
      if (!spoken) {
        this.cb.onError?.("朗读引擎不可用");
        this.stop();
        return;
      }
      // 句间停顿
      if (this.settings.interval > 0) {
        await this.delay(this.settings.interval);
      }
      this.cursor++;
    }
  }

  private async speakWithFallback(text: string): Promise<boolean> {
    const opts: SpeakOptions = {
      lang: "en-US",
      rate: this.settings.rate,
      pitch: this.settings.pitch,
      volume: this.settings.volume,
      voiceURI: this.settings.preferVoiceURI,
      accent: this.settings.accent,
    };
    try {
      await this.backend!.speak(text, opts);
      return true;
    } catch {
      if (this.fallback) {
        try {
          await this.fallback.speak(text, opts);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  private finishBook() {
    this.state = "idle";
    this.pausedAtSentence = -1;
    this.clearHighlight();
    this.stopSleepTimer();
    this.cb.onState?.(this.state);
    this.cb.onProgress?.(0, 0);
  }

  // -------- 高亮（临时通道，零污染） --------

  private highlight(range: Range) {
    this.clearHighlight();
    if (!this.settings.enableHighlight || !range) return;
    const doc = (range.commonAncestorContainer as any)?.ownerDocument
      || (range.startContainer as any)?.ownerDocument;
    if (!doc) return;
    const color = this.settings.highlightColor || "#ffe082";
    try {
      const span = doc.createElement("span");
      span.className = HL_CLASS;
      this.applyStyle(span, color);
      range.surroundContents(span);
      this.highlightEls.push(span);
    } catch {
      // 跨节点 range 无法 surroundContents → 降级：给范围内文本节点 parent 加 class
      try {
        const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
          acceptNode: (n: any) => {
            const r = doc.createRange();
            r.selectNodeContents(n);
            const intersects = range.intersectsNode ? range.intersectsNode(n) : true;
            return intersects && (n.textContent || "").trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        let n: Node | null;
        const els: HTMLElement[] = [];
        while ((n = walker.nextNode())) {
          const p = n.parentElement;
          if (p && !p.classList.contains(HL_CLASS)) {
            this.applyStyle(p, color);
            p.classList.add(HL_CLASS);
            els.push(p);
          }
        }
        this.highlightEls.push(...els);
      } catch { /* 忽略高亮失败 */ }
    }
  }

  private applyStyle(el: HTMLElement, color: string) {
    el.style.background = "transparent";
    el.style.textDecoration = "none";
    el.style.outline = "none";
    switch (this.settings.highlightStyle) {
      case "background":
        el.style.background = color;
        el.style.borderRadius = "3px";
        break;
      case "underline":
        el.style.textDecoration = `underline 2px ${color}`;
        break;
      case "wave":
        el.style.textDecoration = `underline wavy 2px ${color}`;
        break;
      case "outline":
        el.style.outline = `2px solid ${color}`;
        el.style.borderRadius = "3px";
        break;
    }
  }

  private clearHighlight() {
    for (const el of this.highlightEls) {
      try {
        if (el.classList.contains(HL_CLASS) && el.firstChild && el.parentNode) {
          // unwrap span
          const parent = el.parentNode;
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          parent.normalize?.();
        } else {
          el.classList.remove(HL_CLASS);
          el.style.background = "";
          el.style.textDecoration = "";
          el.style.outline = "";
          el.style.borderRadius = "";
        }
      } catch { /* 忽略清理失败 */ }
    }
    this.highlightEls = [];
  }

  // -------- 睡眠定时 --------

  private startSleepTimer() {
    this.stopSleepTimer();
    if (this.settings.sleepTimerMin > 0) {
      this.sleepTimer = setTimeout(() => this.stop(), this.settings.sleepTimerMin * 60_000);
    }
  }

  private stopSleepTimer() {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 卸载清理（零残留） */
  dispose() {
    this.stop();
  }
}
