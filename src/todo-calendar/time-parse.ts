/**
 * REword · 待办时间「自然语言」解析
 * ------------------------------------------------------------------
 * 场合：用户在文档里写一条待办 `- [ ] 明天上午 9 点复习单词`，选中块 → 「加入日历」，
 * 插件需要把句中的时间短语解析成 `custom-due`（YYYY-MM-DDTHH:MM，本地时间）。
 *
 * 支持（解析优先级：显式日期/相对日/星期 > 时刻）：
 *  - 显式日期：`2026-09-20` / `2026/9/20` / `2026年9月20日` / `9-20` / `9月20日`
 *  - 相对日：今天/今日/今晚/今早、明天/明日/明晚、后天、大后天、N 天后
 *  - 星期：周X / 星期X / 礼拜X（可带 下/下下/这/本 前缀）
 *  - 时刻：`9:30` / `9点` / `9点半` / `9点30分`（含中文数字 九点）
 *  - 时段词：凌晨/早上/上午/中午/下午/傍晚/晚上/夜里（修正 12/24 小时制）
 *  - 仅有日期 → 用默认时刻（默认 09:00）；仅有时刻 → 今天，若已过则顺延到明天
 *
 * 纯函数实现（不碰 DOM），便于单测。
 */

import { t } from "../i18n/index.ts";

export interface ParsedNaturalTime {
  /** YYYY-MM-DDTHH:MM（本地时间） */
  due: string;
  /** 命中的原文片段（UI 可回显） */
  matched: string;
  /** 是否含显式时刻（false = 用的是默认时刻） */
  hasTime: boolean;
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const WEEK_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 末: 6,
};

/** 时段词 → 小时修正（12 小时制 → 24 小时制） */
const PERIODS: Array<[RegExp, (h: number) => number]> = [
  [/凌晨|半夜/, (h) => (h === 12 ? 0 : h)],
  [/早上|早晨|清晨|今早|明早/, (h) => (h === 12 ? 0 : h)],
  [/上午/, (h) => (h === 12 ? 0 : h)],
  [/中午|正午/, (h) => (h < 11 ? h + 12 : h)],
  [/下午/, (h) => (h < 12 ? h + 12 : h)],
  [/傍晚|晚上|夜里|今晚|明晚|晚间/, (h) => (h < 12 ? h + 12 : h)],
];

/** 全角数字 / 全角冒号 归一化 */
function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/．/g, ".")
    .replace(/\u3000/g, " ");
}

function p2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** 本地 Date → YYYY-MM-DDTHH:MM */
export function toDueString(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** YYYY-MM-DDTHH:MM → 本地 Date（解析失败返回 null） */
export function fromDueString(due: string): Date | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(due);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** 中文数字（1~24 内够用）转数值；纯阿拉伯数字原样返回 */
function cnNum(raw: string): number | null {
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const s = raw.replace(/点/g, "").trim();
  if (!s) return null;
  if (s === "十") return 10;
  if (s.length === 1 && CN_DIGITS[s] != null) return CN_DIGITS[s];
  const m = /^([一二两三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(s);
  if (m) {
    const tens = m[1] ? CN_DIGITS[m[1]] : 1;
    const ones = m[2] ? CN_DIGITS[m[2]] : 0;
    return tens * 10 + ones;
  }
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 整数天差（a 相对 b，按本地零点） */
function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

/**
 * 解析自然语言时间。
 * @param text        待解析文本（如整条待办标题）
 * @param now         参照时间（默认当前）
 * @param defaultHour 仅有日期时的默认时刻（小时，默认 9）
 */
export function parseNaturalTime(
  text: string,
  now: Date = new Date(),
  defaultHour = 9
): ParsedNaturalTime | null {
  if (!text) return null;
  const s = normalize(text);
  const matchedParts: string[] = [];

  /* ---------- 1. 时段词 ---------- */
  let periodFix: ((h: number) => number) | null = null;
  for (const [re, fix] of PERIODS) {
    if (re.test(s)) { periodFix = fix; break; }
  }

  /* ---------- 2. 时刻 ---------- */
  let hour: number | null = null;
  let minute = 0;

  let tm = /(\d{1,2}):(\d{1,2})/.exec(s);
  if (tm) {
    hour = parseInt(tm[1], 10);
    minute = parseInt(tm[2], 10);
    matchedParts.push(tm[0]);
  } else {
    tm = /((?:\d{1,2})|十[一二]?|[一二两三四五六七八九])\s*点\s*(半|\d{1,2}\s*分?)?/.exec(s);
    if (tm) {
      const h = cnNum(tm[1]);
      if (h != null) {
        hour = h;
        if (tm[2] === "半") minute = 30;
        else if (tm[2]) minute = parseInt(tm[2], 10) || 0;
        matchedParts.push(tm[0]);
      }
    }
  }

  const hasTime = hour != null && hour >= 0 && hour <= 24 && minute >= 0 && minute < 60;
  if (hasTime && hour != null) {
    hour = Math.min(23, hour);
    if (periodFix) hour = periodFix(hour);
    minute = Math.min(59, minute);
  } else {
    hour = null;
  }

  /* ---------- 3. 日期 ---------- */
  let base: Date | null = null;

  // 3a. 绝对日期
  let dm = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/.exec(s);
  if (dm) {
    base = new Date(+dm[1], +dm[2] - 1, +dm[3]);
    matchedParts.push(dm[0]);
  } else {
    dm = /(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/.exec(s);
    if (dm) {
      // 形如 9-20 / 9月20日：用当年；已过则补到明年
      const cand = new Date(now.getFullYear(), +dm[1] - 1, +dm[2]);
      base = dayDiff(cand, now) < 0
        ? new Date(now.getFullYear() + 1, +dm[1] - 1, +dm[2])
        : cand;
      matchedParts.push(dm[0]);
    }
  }

  // 3b. 相对日
  if (!base) {
    const rel = /(大后天|后天|明天|明日|明晚|明早|今天|今日|今晚|今早|当日)/.exec(s);
    if (rel) {
      const off = rel[1] === "大后天" ? 3 : (rel[1] === "后天" ? 2 : (rel[1].startsWith("明") ? 1 : 0));
      base = startOfDay(now);
      base.setDate(base.getDate() + off);
      matchedParts.push(rel[0]);
    } else {
      const nd = /(\d{1,3})\s*天\s*[后之]后?/.exec(s);
      if (nd) {
        base = startOfDay(now);
        base.setDate(base.getDate() + parseInt(nd[1], 10));
        matchedParts.push(nd[0]);
      }
    }
  }

  // 3c. 星期
  if (!base) {
    const wk = /(下下|下|这|本|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天末])/.exec(s);
    if (wk) {
      const target = WEEK_MAP[wk[2]];
      if (target != null) {
        const cur = startOfDay(now);
        let delta = target - cur.getDay();
        const prefix = wk[1] || "";
        if (prefix === "下") delta += 7;
        else if (prefix === "下下") delta += 14;
        else if (prefix === "上") delta -= 7;
        else if (prefix !== "这" && prefix !== "本" && delta < 0) delta += 7; // 无前缀取「下一个」
        base = cur;
        base.setDate(base.getDate() + delta);
        matchedParts.push(wk[0]);
      }
    }
  }

  /* ---------- 4. 组装 ---------- */
  if (!base && !hasTime) return null;

  let out: Date;
  if (base && hasTime) {
    out = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour as number, minute);
  } else if (base) {
    out = new Date(base.getFullYear(), base.getMonth(), base.getDate(), defaultHour, 0);
  } else {
    // 仅有时刻：今天；若已过则顺延到明天
    out = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour as number, minute);
    if (out.getTime() <= now.getTime()) out.setDate(out.getDate() + 1);
  }

  return { due: toDueString(out), matched: matchedParts.join(" ").trim(), hasTime };
}

/** 相对今天的可读描述（今天 / 明天 / 3 天后 / 2026-09-20 等），相对词走 i18n */
export function describeDue(due: string, now: Date = new Date()): string {
  const d = fromDueString(due);
  if (!d) return due;
  const diff = dayDiff(d, now);
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (diff === 0) return `${t("今天")} ${hm}`;
  if (diff === 1) return `${t("明天")} ${hm}`;
  if (diff === 2) return `${t("后天")} ${hm}`;
  if (diff === -1) return `${t("昨天")} ${hm}`;
  if (diff > 2 && diff <= 7) return `${diff} ${t("天后")} ${hm}`;
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${hm}`;
}
