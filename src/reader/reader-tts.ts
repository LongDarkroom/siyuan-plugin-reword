/**
 * ReaderTtsController —— Reword 阅读器连续朗读控制器
 * --------------------------------------------------------------------------
 * 设计目标（参考 Readest 朗读体验）：
 *   - 连续朗读（不是只读一个词）：基于 foliate 的 getSentences() 枚举文档句子序列
 *   - 句子高亮跟随：临时 class 套在当前句 range 上，停止/卸载即清理（零正文污染）
 *   - 播放控制条：上段/上句/播放暂停/下句/下段/停止 + 语速即时调节
 *   - 多引擎：系统语音(Web Speech) / 有道 dictvoice / Edge TTS（云端神经音，受浏览器限制）/ 讯飞语记（云端神经音，URL 鉴权可行）
 *
 * 与 foliate 的关系：
 *   - foliate 的 TTS 类（vendor/foliate-js/tts.js）只做「分段 + SSML + 高亮定位」，
 *     不负责发声。这里直接复用更底层的 getSentences() 生成器，拿到 {blockIndex, markName, range}，
 *     range 既用于高亮也用于取文本，对不同发声引擎都友好，且绕开了 SSML 解析复杂度。
 *
 * 重要约束（reword 维护铁律）：
 *   - 高亮必须走临时通道，绝不写进 addAnnotation / foliate 标注体系（卸载无残留）
 *   - 绝不修改书籍 DOM 结构：优先用 CSS Custom Highlight API（零 DOM 修改，不改排版），
 *     旧环境降级为仅给文本节点父元素加 class（同样不包裹/不拆分节点，绝不用 surroundContents）
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

/** 朗读引擎类型（在 reword 内扩展 foliate，新增 edge / iflytek） */
export type TtsEngineKind = "system" | "youdao" | "edge" | "iflytek" | "auto";

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
  preferVoiceURI?: string; // 系统语音优先 voiceURI（兼容旧字段）
  /** 中文朗读首选嗓音 voiceURI（手动指定，覆盖自动选择） */
  preferVoiceURIZh?: string;
  /** 英文朗读首选嗓音 voiceURI（手动指定，覆盖自动选择） */
  preferVoiceURIEn?: string;
  // —— 讯飞语记（讯飞开放平台 语音合成 WebAPI）——
  /** 讯飞 APPID */
  iflytekAppId?: string;
  /** 讯飞 APIKey */
  iflytekApiKey?: string;
  /** 讯飞 APISecret */
  iflytekApiSecret?: string;
  /** 讯飞中文发音人（默认 xiaoyan 讯飞小燕；可填 x4_lingfeizhe_assist 等增强音） */
  iflytekVoice?: string;
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
  iflytekVoice: "xiaoyan",
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

/** 系统语音（Web Speech API / speechSynthesis）—— 离线、支持中英日韩等多语言 */
export class SystemBackend implements TtsBackend {
  readonly name = "system" as const;
  readonly supportsBoundary = true;
  private synth: SpeechSynthesis | null;
  /** 预热缓存的嗓音列表（macOS/Electron 首次 getVoices 异步为空，必须等 voiceschanged） */
  private voices: SpeechSynthesisVoice[] = [];
  /** 每次 speak 自增；cancel/新 speak 时作废旧句，防止 30ms 延迟窗口里旧句被误播 */
  private speakToken = 0;

  constructor() {
    this.synth =
      typeof window !== "undefined" && "speechSynthesis" in window
        ? (window.speechSynthesis as SpeechSynthesis)
        : null;
    this.warmVoices();
  }

  supported(): boolean {
    return !!this.synth;
  }

  /** 预热：立即读一次，空则挂 voiceschanged 监听；之后 getVoices() 永远返回最新 */
  private warmVoices() {
    if (!this.synth) return;
    const vs = this.synth.getVoices();
    if (vs && vs.length) { this.voices = vs; return; }
    try {
      this.synth.onvoiceschanged = () => {
        const v2 = this.synth?.getVoices?.() || [];
        if (v2.length) this.voices = v2;
      };
    } catch { /* 忽略 */ }
  }

  private getVoices(): SpeechSynthesisVoice[] {
    if (this.voices.length) return this.voices;
    const vs = this.synth?.getVoices?.() || [];
    if (vs.length) this.voices = vs;
    return this.voices;
  }

  /** 中文（含普通话 cmn / 粤语 yue）跨方言合并候选 */
  private isChineseLang(l: string): boolean {
    return /^(zh|cmn|yue)/i.test(l || "");
  }
  /** 在候选列表里挑质量最高的嗓音：Neural/Online/Premium/Enhanced > 普通 > Standard/Basic */
  private pickBest(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice {
    const rank = (v: SpeechSynthesisVoice): number => {
      const n = (v.name || "").toLowerCase();
      if (/(neural|online|premium|enhanced|natural)/.test(n)) return 0;
      if (/(standard|basic)/.test(n)) return 2;
      return 1;
    };
    return [...list].sort((a, b) => rank(a) - rank(b))[0];
  }
  /** 按语言选最佳嗓音：优先本语言（中文跨 zh/cmn/yue 合并），并在同语言里选 Neural/增强嗓音 */
  private pickVoice(lang: string): SpeechSynthesisVoice | null {
    const voices = this.getVoices();
    if (!voices.length) return null;
    const base = (lang || "en-US").toLowerCase();
    const sameLang = (v: SpeechSynthesisVoice) => {
      const vl = (v.lang || "").toLowerCase();
      if (vl === base) return true;
      if (this.isChineseLang(base) && this.isChineseLang(vl)) return true; // 中文跨方言
      if (vl.split("-")[0] === base.split("-")[0]) return true;
      return false;
    };
    const candidates = voices.filter(sameLang);
    const pool = candidates.length
      ? candidates
      : base.startsWith("en")
        ? voices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"))
        : [];
    if (!pool.length) return null;
    return this.pickBest(pool);
  }

  speak(text: string, opts: SpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const synth = this.synth;
      if (!synth) return reject(new Error("speechSynthesis 不可用"));
      const lang = opts.lang || "en-US";

      // 嗓音可能尚未加载完（首次）：轮询 getVoices 最多 ~1.2s，避免零声音
      const ensureVoices = () =>
        new Promise<void>((res) => {
          if (this.getVoices().length) return res();
          let done = false;
          const t = setTimeout(() => { if (!done) { done = true; res(); } }, 1200);
          const poll = setInterval(() => {
            if (this.getVoices().length && !done) {
              done = true; clearTimeout(t); clearInterval(poll); res();
            }
          }, 100);
        });

      ensureVoices()
        .then(() => {
          const myToken = ++this.speakToken;
          const u = new SpeechSynthesisUtterance(text);
          u.lang = lang;
          u.rate = clamp(opts.rate ?? 1, 0.1, 10);
          u.pitch = clamp(opts.pitch ?? 1, 0, 2);
          u.volume = clamp(opts.volume ?? 1, 0, 1);
          // 优先用用户手动指定的该语言嗓音，其次按语言自动选（中文书用中文嗓音）
          const userVoice = opts.voiceURI
            ? this.getVoices().find((x) => x.voiceURI === opts.voiceURI)
            : null;
          const v = userVoice || this.pickVoice(lang);
          if (v) u.voice = v;

          let settled = false;
          let keepAlive: ReturnType<typeof setInterval> | null = null;
          const stopKeepAlive = () => { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } };
          // 看门狗：单句朗读安全上限（防止 onend 不触发导致循环卡死）
          const maxMs = Math.max(4000, text.length * 240 + 6000);
          const watchdog = setTimeout(() => {
            if (!settled) { settled = true; stopKeepAlive(); resolve(); }
          }, maxMs);

          u.onend = () => {
            if (!settled) { settled = true; stopKeepAlive(); clearTimeout(watchdog); resolve(); }
          };
          u.onerror = (e: any) => {
            if (!settled) {
              settled = true; stopKeepAlive(); clearTimeout(watchdog);
              reject(new Error(e?.error || "speech error"));
            }
          };
          if (opts.onBoundary) u.onboundary = (e: any) => opts.onBoundary?.(e.charIndex || 0);

          // 15s 保活：macOS/Electron 长句经典「读到一半静音」bug 的通用修复
          // （短句 onend 早于 14s 触发，不会真正 pause/resume，无听觉瑕疵）
          keepAlive = setInterval(() => {
            if (settled) return;
            try { synth.pause(); synth.resume(); } catch { /* 忽略 */ }
          }, 14000);

          try {
            // 关键：先 cancel 旧任务，下一拍再 speak —— 避免 macOS 同步 cancel 误杀新句。
            // 注意：此处【不要】再 ++this.speakToken！本句已通过上方 `myToken = ++this.speakToken`
            // 拿到唯一代际；若这里再自增，30ms 后 myToken !== this.speakToken 永远成立，
            // 直接 return 导致句子永不真正 speak（即「完全没声音」的根因）。
            // 作废在途旧句交给外部 cancel() 与下一次 speak() 的 ++ 处理即可。
            synth.cancel();
            setTimeout(() => {
              if (settled || myToken !== this.speakToken) return; // 已被 stop/新句取代
              try { synth.speak(u); }
              catch (err) {
                if (!settled) { settled = true; stopKeepAlive(); clearTimeout(watchdog); reject(err as Error); }
              }
            }, 30);
          } catch (err) {
            if (!settled) { settled = true; stopKeepAlive(); clearTimeout(watchdog); reject(err as Error); }
          }
        })
        .catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
    });
  }

  cancel(): void {
    this.speakToken++; // 作废在途旧句（含 30ms 延迟窗口）
    try { this.synth?.cancel(); } catch { /* 忽略 */ }
  }
}

/** 有道 dictvoice 在线真人音（按词朗读质量优于机械音，句子偏机械） */
export class YoudaoBackend implements TtsBackend {
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
 * 采用 Edge 公开 trusted client token；音频累积为 mp3 Blob 后用 <audio> 播放。
 * 失败（网络/区域拦截/超时/握手缺 Sec-MS-GEC 头）会 reject，由上层 speakWithFallback 回退到系统语音。
 * 重要限制：浏览器/Electron 渲染进程的 WebSocket 无法发送自定义 HTTP 头（如 Sec-MS-GEC），
 *           因此微软云端神经 TTS 在纯前端插件环境大多不可用；本后端保留为「有惊喜时的备份」，
 *           超时后自动回退系统语音（中文质量则靠本机 Neural 嗓音优选保证）。
 */
export class EdgeBackend implements TtsBackend {
  readonly name = "edge" as const;
  private current: HTMLAudioElement | null = null;

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

  // 公共 URL/Token 改为可选 const，方便测试/未来替换
  private static readonly TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  private static readonly WS_URL =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  /** 浏览器/Electron 渲染进程的 WebSocket 无法携带 Sec-MS-GEC 认证头，
   *  微软云端神经 TTS 在纯前端环境通常握手失败；缩短超时，让不可用时快速回退系统语音，
   *  避免「每句卡 8s」的糟糕体验。 */
  private static readonly NO_AUDIO_TIMEOUT_MS = 4000;
  private static readonly WS_OPEN_TIMEOUT_MS = 4000;

  speak(text: string, opts: SpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof WebSocket === "undefined") {
        return reject(new Error("WebSocket 不可用"));
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(EdgeBackend.WS_URL);
      } catch (err) {
        return reject(err);
      }
      const chunks: Uint8Array[] = [];
      void EdgeBackend.TRUSTED_TOKEN; // 预留：现代 Edge 部分区域要求 Sec-MS-GEC，这里用基础握手
      let gotAudio = false;
      let settled = false;
      // 关键约束：settled 标志只在 settleOk/settleErr 内部统一管理，
      // 各 timer / event 路径都走 finish()，由 finish 内部判断 settled
      // 避免「timeout 已 settled=true，但 finish 内部 settleErr 二次检查 settled 时
      //   看到 true 就跳过 reject」的 bug。
      const settleOk = () => { if (!settled) { settled = true; resolve(); } };
      const settleErr = (e: unknown) => {
        if (settled) return;
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      };

      let openTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        finish(false, new Error("edge ws open timeout"));
      }, EdgeBackend.WS_OPEN_TIMEOUT_MS);
      let noAudioTimer: ReturnType<typeof setTimeout> | null = null;
      const resetNoAudio = () => {
        if (noAudioTimer) clearTimeout(noAudioTimer);
        noAudioTimer = setTimeout(() => {
          finish(false, new Error("edge tts no audio in time"));
        }, EdgeBackend.NO_AUDIO_TIMEOUT_MS);
      };

      const finish = (ok: boolean, err?: unknown) => {
        if (settled) return; // 关键：已 settle 直接返回，不再重入
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        if (noAudioTimer) { clearTimeout(noAudioTimer); noAudioTimer = null; }
        try { ws.close(); } catch { /* 忽略 */ }
        if (!ok) { this.cancel(); return settleErr(err || new Error("edge tts failed")); }
        if (!chunks.length) { this.cancel(); return settleErr(new Error("edge tts empty audio")); }
        const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.current = audio;
        audio.volume = opts.volume ?? 1;
        audio.onended = () => { URL.revokeObjectURL(url); this.current = null; settleOk(); };
        audio.onerror = () => { URL.revokeObjectURL(url); this.current = null; settleErr(new Error("edge play error")); };
        const p = audio.play();
        if (p && typeof p.catch === "function") p.catch((e) => { URL.revokeObjectURL(url); this.current = null; settleErr(e); });
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
          resetNoAudio(); // 收到一帧就续命
          chunks.push(body);
        } catch {
          /* 忽略坏帧 */
        }
      };

      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        resetNoAudio();
        try {
          const ts = new Date().toUTCString().replace("GMT", "GMT");
          ws.send(`X-Timestamp: ${ts}\r\n` +
            `Content-Type: application/json; charset=utf-8\r\n` +
            `Path: speech.config\r\n\r\n` +
            `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
          ws.send(`X-Timestamp: ${ts}\r\n` +
            `Content-Type: application/ssml+xml\r\n` +
            `Path: ssml\r\n\r\n` +
            this.buildSsml(text, opts));
        } catch (err) {
          finish(false, err);
        }
      };
      ws.onmessage = onMessage;
      ws.onerror = () => finish(false, new Error("edge ws error"));
      ws.onclose = (ev: CloseEvent) => {
        // 异常关闭（且还没收到音频）→ 视为失败，触发 fallback
        if (!gotAudio && ev && ev.code !== 1000) {
          finish(false, new Error(`edge ws closed code=${ev.code}`));
        }
      };
    });
  }

  cancel(): void {
    try { this.current?.pause(); } catch { /* 忽略 */ }
    this.current = null;
  }
}

/**
 * 讯飞语记（讯飞开放平台 语音合成流式版 WebAPI）。
 * 鉴权采用 WebSocket URL query 参数（authorization/date/host），由前端用
 * crypto.subtle 计算 HMAC-SHA256 签名 —— 浏览器/Electron 渲染进程可直接建连，
 * 无需自定义 HTTP 头（这正是 Edge TTS 在纯前端不可行的硬限制，而讯飞没有该限制）。
 * 音频以 base64 JSON 帧返回，累积为 mp3 Blob 后用 <audio> 播放。
 * 需要用户在设置里填入 AppID/APIKey/APISecret（讯飞开放平台免费领取，中文神经音质量优于系统嗓音）。
 */
export class IflytekBackend implements TtsBackend {
  readonly name = "iflytek" as const;
  private current: HTMLAudioElement | null = null;
  private cfg: RewordTtsSettings;

  constructor(cfg: RewordTtsSettings) {
    this.cfg = cfg;
  }

  supported(): boolean {
    return (
      typeof WebSocket !== "undefined" &&
      typeof crypto !== "undefined" &&
      !!crypto.subtle &&
      typeof btoa !== "undefined"
    );
  }

  /** 计算 HMAC-SHA256 签名并拼出带鉴权参数的 wss URL */
  private async buildWsUrl(): Promise<string> {
    const host = "tts-api.xfyun.cn";
    const date = new Date().toUTCString();
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(this.cfg.iflytekApiSecret || ""),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signatureOrigin));
    const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
    const authorizationOrigin = `api_key="${this.cfg.iflytekApiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = btoa(authorizationOrigin);
    const params = new URLSearchParams({ authorization, date, host });
    return `wss://${host}/v2/tts?${params.toString()}`;
  }

  private pickVoice(lang?: string): string {
    const isZh = (lang || "en-US").toLowerCase().startsWith("zh");
    return isZh
      ? this.cfg.iflytekVoice || "xiaoyan"
      : "x4_EnUs_Gavin_assist"; // 英文句用讯飞英文神经音
  }

  speak(text: string, opts: SpeakOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.supported()) return reject(new Error("讯飞 TTS 不可用（环境不支持 WebSocket/crypto）"));
      if (!(this.cfg.iflytekAppId && this.cfg.iflytekApiKey && this.cfg.iflytekApiSecret)) {
        return reject(new Error("讯飞密钥未配置"));
      }
      let ws: WebSocket;
      this.buildWsUrl()
        .then((url) => {
          try { ws = new WebSocket(url); }
          catch (err) { return reject(err instanceof Error ? err : new Error(String(err))); }
          const audioChunks: string[] = [];
          let gotAudio = false;
          let settled = false;
          const settleOk = () => { if (!settled) { settled = true; resolve(); } };
          const settleErr = (e: unknown) => {
            if (settled) return;
            settled = true;
            reject(e instanceof Error ? e : new Error(String(e)));
          };

          const NO_AUDIO_MS = 10000;
          const openTimer = setTimeout(() => { if (!settled) settleErr(new Error("讯飞 ws 连接超时")); }, 8000);
          const noAudioTimer = setTimeout(() => {
            if (!gotAudio && !settled) settleErr(new Error("讯飞未返回音频（检查密钥/额度/网络）"));
          }, NO_AUDIO_MS);

          const play = () => {
            if (!audioChunks.length) { settleErr(new Error("讯飞返回空音频")); return; }
            try {
              const bytes = audioChunks
                .map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
              const blob = new Blob(bytes as BlobPart[], { type: "audio/mpeg" });
              const u = URL.createObjectURL(blob);
              const audio = new Audio(u);
              this.current = audio;
              audio.volume = opts.volume ?? 1;
              audio.onended = () => { URL.revokeObjectURL(u); this.current = null; settleOk(); };
              audio.onerror = () => { URL.revokeObjectURL(u); this.current = null; settleErr(new Error("讯飞音频播放失败")); };
              const p = audio.play();
              if (p && typeof p.catch === "function") p.catch((e) => { URL.revokeObjectURL(u); this.current = null; settleErr(e); });
            } catch (err) {
              settleErr(err instanceof Error ? err : new Error(String(err)));
            }
          };

          ws.onopen = () => {
            clearTimeout(openTimer);
            const speed = Math.round(clamp((opts.rate ?? 1) * 50, 0, 100));
            const pitch = Math.round(clamp((opts.pitch ?? 1) * 50, 0, 100));
            const volume = Math.round(clamp((opts.volume ?? 1) * 100, 0, 100));
            const payload = {
              common: { app_id: this.cfg.iflytekAppId },
              business: {
                aue: "lame",
                auf: "audio/L16;rate=16000",
                vcn: this.pickVoice(opts.lang),
                tte: "utf8",
                speed,
                pitch,
                volume,
                sfl: 1,
              },
              data: {
                status: 2,
                text: btoa(unescape(encodeURIComponent(text))),
                tts_res_type: 1,
              },
            };
            try { ws.send(JSON.stringify(payload)); }
            catch (err) { settleErr(err instanceof Error ? err : new Error(String(err))); }
          };

          ws.onmessage = (ev: MessageEvent) => {
            if (typeof ev.data !== "string") return;
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.code !== 0 && msg.code !== undefined) {
              settleErr(new Error(`讯飞错误 code=${msg.code} ${msg.message || ""}`));
              return;
            }
            const d = msg.data;
            if (d && d.audio) {
              gotAudio = true;
              clearTimeout(noAudioTimer);
              audioChunks.push(d.audio);
            }
            if (d && d.status === 2) {
              clearTimeout(noAudioTimer);
              try { ws.close(); } catch { /* 忽略 */ }
              play();
            }
          };

          ws.onerror = () => { if (!settled) settleErr(new Error("讯飞 ws 错误")); };
          ws.onclose = () => { /* 正常结束由 status=2 的 play() 处理 */ };
        })
        .catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
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
    case "iflytek": {
      // 讯飞语记：URL query 鉴权（非自定义 HTTP 头），浏览器/Electron 可直接建连；
      // 但需用户在设置里填 AppID/APIKey/APISecret，缺任一则回退系统语音。
      const ifly = new IflytekBackend(settings);
      const hasCred = !!(settings.iflytekAppId && settings.iflytekApiKey && settings.iflytekApiSecret);
      primary = hasCred && available(ifly) ? ifly : system;
      fallback = primary === ifly ? system : null;
      if (!hasCred) console.warn("[REword TTS] 讯飞引擎未配置密钥，已回退系统语音");
      break;
    }
    case "auto":
    default:
      // 系统语音最稳（离线、支持中英日韩等多语言嗓音）；在线仅作兜底
      // 注：Edge 公开 readaloud 端点自 2024 起已陆续下线，若作主引擎每句都会先等 8s 超时，
      //     故 auto 直接走 system，由 speakWithFallback 的「一次性降级」保证容错。
      primary = system;
      fallback = available(youdao) ? youdao : null;
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
  /** 该句推断语言（如 zh-CN / en-US / ja-JP），用于按语言选嗓音（中文朗读支持） */
  lang?: string;
}

// ============================================================
// 语言 / 嗓音工具
// ============================================================

/** 数值夹取 */
function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

const XML_LANG_NS = "http://www.w3.org/XML/1998/namespace";

/** 沿祖先链读取 lang（含 xml:lang），用于复用书籍正文声明的语言 */
function langOfRange(range: Range): string | null {
  try {
    let el: Node | null = range.commonAncestorContainer;
    while (el && el.nodeType !== 9 /* DOCUMENT_NODE */) {
      const lang = (el as HTMLElement).lang
        || (el as Element).getAttributeNS?.(XML_LANG_NS, "lang");
      if (lang) return lang;
      el = el.parentNode;
    }
  } catch { /* 忽略 */ }
  return null;
}

/** 内容语言兜底检测（书籍未声明 lang 时）：CJK → 中文，其余按字符集粗分 */
function detectLangByText(text: string): string {
  if (/[一-鿿]/.test(text)) return "zh-CN";
  if (/[぀-ヿ]/.test(text)) return "ja-JP";
  if (/[가-힯]/.test(text)) return "ko-KR";
  if (/[Ѐ-ӿ]/.test(text)) return "ru-RU";
  if (/[؀-ۿ]/.test(text)) return "ar-SA";
  return "en-US";
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
  /** 是否正在使用 CSS Custom Highlight API（零 DOM 修改）高亮 */
  private usingCssHighlight = false;
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

  /** 枚举所有已加载 doc 的句子（多节可见时拼接），并为每句推断语言 */
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
          // 优先用正文声明的 lang；缺失则按内容字符集兜底（中文朗读关键）
          const lang = langOfRange(range) || detectLangByText(text);
          items.push({ blockIndex: seg.blockIndex, markName: seg.markName, range, text, lang });
        }
      } catch (e) {
        console.warn("[REword TTS] 枚举句子失败", e);
      }
    }
    // 去重相邻的同文本（foliate 多节拼接偶尔会重复首句）
    const dedup: SentenceItem[] = [];
    for (const it of items) {
      const last = dedup[dedup.length - 1];
      if (last && last.text === it.text && last.lang === it.lang) continue;
      dedup.push(it);
    }
    return dedup;
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

      const spoken = await this.speakWithFallback(item.text, item.lang);
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

  private async speakWithFallback(text: string, lang?: string): Promise<boolean> {
    const isZh = (lang || "en-US").toLowerCase().startsWith("zh");
    const opts: SpeakOptions = {
      lang: lang || "en-US",
      rate: this.settings.rate,
      pitch: this.settings.pitch,
      volume: this.settings.volume,
      // 按句语言选对应手动嗓音：中文句用 preferVoiceURIZh，英文句用 preferVoiceURIEn
      voiceURI: isZh ? this.settings.preferVoiceURIZh : this.settings.preferVoiceURIEn,
      accent: this.settings.accent,
    };
    try {
      await this.backend!.speak(text, opts);
      return true;
    } catch {
      // 主引擎失败：一次性降级到 fallback，并标记主引擎失效，
      // 避免每句都重试坏引擎（如已下线的 Edge 每次都在 8s 超时后才回退）
      if (this.fallback) {
        this.backend = this.fallback;
        this.fallback = null;
        try {
          await this.backend.speak(text, opts);
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

  /** 注入一次全局 ::highlight 样式（仅在首次高亮时） */
  private ensureHighlightStyle() {
    try {
      const doc = typeof document !== "undefined" ? document : null;
      if (!doc || doc.getElementById("reword-tts-hl-style")) return;
      const style = doc.createElement("style");
      style.id = "reword-tts-hl-style";
      style.textContent =
        "::highlight(reword-tts-hl){ background-color: var(--reword-tts-hl-color, rgba(255,224,130,0.55)); color: inherit; }";
      (doc.head || doc.documentElement).appendChild(style);
    } catch { /* 忽略 */ }
  }

  /** 高亮当前句 —— 零 DOM 结构修改，绝不改变书籍排版 */
  private highlight(range: Range) {
    this.clearHighlight();
    if (!this.settings.enableHighlight || !range) return;
    const color = this.settings.highlightColor || "#ffe082";
    const win: any =
      (range.startContainer as any)?.ownerDocument?.defaultView
      || (typeof window !== "undefined" ? window : null);
    const CSSns: any = win?.CSS;

    // 同步高亮色（CSS 变量）
    try {
      const root =
        (range.startContainer as any)?.ownerDocument?.documentElement
        || (typeof document !== "undefined" ? document.documentElement : null);
      root?.style?.setProperty?.("--reword-tts-hl-color", color);
    } catch { /* 忽略 */ }

    // 优先：CSS Custom Highlight API（只改绘制层，不动 DOM，永不撕裂排版）
    if (CSSns && "highlights" in CSSns && typeof win.Highlight === "function") {
      try {
        this.ensureHighlightStyle();
        const hl = new win.Highlight(range);
        CSSns.highlights.set("reword-tts-hl", hl);
        this.usingCssHighlight = true;
        return;
      } catch {
        this.usingCssHighlight = false;
        // 落到 class 兜底
      }
    }
    // 兜底：仅给范围内文本节点的父元素加 class（不包裹、不拆分节点）
    this.highlightByClass(range, color);
  }

  /** 兜底高亮：仅给文本节点父元素上色，绝不 surroundContents（不改 DOM 结构） */
  private highlightByClass(range: Range, color: string) {
    const doc = (range.startContainer as any)?.ownerDocument;
    if (!doc) return;
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
    // CSS Custom Highlight API 通道（零 DOM 修改，直接删注册）
    try {
      const win: any = typeof window !== "undefined" ? window : null;
      win?.CSS?.highlights?.delete?.("reword-tts-hl");
    } catch { /* 忽略 */ }
    this.usingCssHighlight = false;
    // class 兜底通道
    for (const el of this.highlightEls) {
      try {
        if (el.classList.contains(HL_CLASS) && el.firstChild && el.parentNode) {
          // unwrap span（仅兜底路径可能产生）
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
