/**
 * 「本次发送注入了什么」清单（纯函数，无副作用，便于单测）。
 *
 * ## 为什么需要它
 * 用户长期不知道自己发出去的消息被哪些系统提示词限定过——注入是隐式的。
 * 本模块把「对话链路**实际**会拼进 system 的内容」如实算出，供面板常驻显示。
 *
 * ## 只反映真实注入，不反映意图
 * 对照 `runAiChat`（ai-orchestrator.ts）的实际组装顺序（2026-09-10 零注入后）：
 * 1. `prepareChatMessages` —— **不再**自动补 `DEFAULT_AI_CHAT_SYSTEM`、**不再**给 user
 *    消息套 `<user_input>`；只丢弃空 system 占位，其余原样透传
 *    （旧实现会让模型把正常提问判成「材料里夹带的指令」而拒答，见该函数注释）；
 * 2. `resolveModelSystemPrompt` —— 非空时**替换** system（不是追加）；无 system 时补一条；
 * 3. `buildSoulSection` —— 追加在 system 末尾；无 system 时只补 soul 本身（不再夹带旧禁令）。
 *
 * ⚠️ AI 角色的提示词目前写进 `settings.promptTemplate`，而对话链路不消费该字段
 * （只有已下线的精读链路读过）——故如实标为 `off`（未生效），不假装它生效。
 */
import {
  resolveModelSystemPrompt,
  activePlatformOf,
  type AiSettings,
} from "./ai-settings.ts";
import type { AiPreset } from "./ai-preset.ts";
import { t } from "../i18n/index.ts";

/** 清单里的一段注入内容 */
export interface InjectSegment {
  /** 段名（界面显示） */
  label: string;
  /** 来源说明 */
  source: string;
  /** 字数 */
  chars: number;
  /** active = 实际生效；suppressed = 被更高优先级覆盖；off = 未生效 */
  state: "active" | "suppressed" | "off";
}

export interface InjectManifest {
  segments: InjectSegment[];
  /** 实际生效的段数 */
  activeCount: number;
  /** 实际生效的总字数 */
  activeChars: number;
  /** 面板胶囊上的一句话 */
  summary: string;
  /** 悬停提示（多行明细） */
  detail: string;
}

/** 状态的中文标签（面板明细行直接复用，避免两处映射走偏） */
export const INJECT_STATE_LABEL: Record<InjectSegment["state"], string> = {
  active: t("生效"),
  suppressed: t("被覆盖"),
  off: t("未生效"),
};

/**
 * 计算本次发送会注入什么。
 *
 * @param settings 本次发送实际使用的设置（已叠加角色临时覆盖的副本）
 * @param preset   当前激活的 AI 角色（可选）
 */
export function computeInjectManifest(settings: AiSettings, preset?: AiPreset): InjectManifest {
  const segments: InjectSegment[] = [];

  const modelSys = resolveModelSystemPrompt({
    model: settings.model,
    modelParams: activePlatformOf(settings)?.modelParams || settings.modelParams,
  });

  // ① 对话底线指令：2026-09-10 起已停用，**且已从清单移除**（用户指令：已停用的条目
  //    继续挂着「未生效」只是视觉噪音）。现在清单里只列仍会出现的段。

  // ② 模型专属提示词：非空时替换底线
  if (modelSys) {
    segments.push({
      label: t("模型专属提示词"),
      source: `模型「${settings.model}」`,
      chars: modelSys.length,
      state: "active",
    });
  }

  // ③ SOUL 长期记忆：追加在 system 末尾
  if (settings.soulEnabled && settings.soulDocId) {
    segments.push({
      label: t("SOUL 长期记忆"),
      source: "设置 → 记忆",
      chars: settings.soulMaxChars ?? 4000,
      state: "active",
    });
  }

  // ④ 角色提示词：对话链路不消费 promptTemplate → 如实标未生效
  const rolePrompt = (preset?.systemPrompt || "").trim();
  if (rolePrompt) {
    segments.push({
      label: t("角色提示词"),
      source: `「${preset?.name ?? ""}」· ${t("对话链路尚未接入")}`,
      chars: rolePrompt.length,
      state: "off",
    });
  }

  const active = segments.filter((s) => s.state === "active");
  const activeChars = active.reduce((n, s) => n + s.chars, 0);
  const activeCount = active.length;

  const summary = activeCount
    ? t("本次注入 {n} 段 · 约 {m} 字", { n: activeCount, m: activeChars })
    : t("本次不注入任何系统提示词");

  const detail = [
    activeCount ? t("本次发送的 system 由以下内容拼成：") : t("本次发送不携带 system 提示词。"),
    ...segments.map((s) => `· ${s.label}（${s.source}）${s.chars} ${t("字 — ")}${INJECT_STATE_LABEL[s.state]}`),
    t("按 Enter 发送前，这就是模型实际收到的东西。"),
  ].join("\n");

  return { segments, activeCount, activeChars, summary, detail };
}
