/**
 * REword · CalDAV 同步（Transport + ICS + 增量同步）
 * ------------------------------------------------------------------
 * 传输层不走浏览器 fetch，而是**借思源内核转发** `/api/network/forwardProxy`：
 *   - 彻底绕开「插件前端 fetch 局域网 http 被 CORS 拦」的问题（无需改 Radicale 配置）；
 *   - 请求头（Basic 鉴权）与 PUT 方法体原样透传到 CalDAV 服务器。
 *
 * 事件模型（与 vivo 日历 / 手表提醒对齐，已在真机验证）：
 *   - `UID = <blockId>@reword`（块 ID 即身份，天然一对一）
 *   - `DTSTART` 用 **floating local time**（不带 Z/时区），手机按本地时区显示
 *   - `VALARM` = `ACTION:DISPLAY` + `TRIGGER:-PT{m}M`（m=0 即事件开始时提醒）
 *
 * 增量策略：仅比对 state.entries 快照，变化才 PUT、消失/完成才 DELETE。
 */
import { fetchSyncPost } from "siyuan";
import type { CalendarSyncSettings, CalendarStoreLike, TodoItem, SyncEntry } from "./types.ts";
import { t } from "../i18n/index.ts";
import { SIYUAN_API } from "../siyuan/client.ts";

export interface CalResponse {
  status: number;
  body: string;
  headers: Record<string, string[]>;
}

export interface SyncSummary {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
  messages: string[];
}

/* ================= ICS 生成 ================= */

function p2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** 转义 iCalendar 文本值 */
function escapeICS(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** 按 RFC5545：每行 ≤75 字节，续行以空格开头 */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const len = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 续行首字符是空格，占 1 字节
    if (curLen + len > limit) {
      out.push(cur);
      cur = ch;
      curLen = len;
    } else {
      cur += ch;
      curLen += len;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

/** 'YYYY-MM-DDTHH:MM' → 'YYYYMMDDTHHMM00'（floating local） */
function icsLocal(due: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(due);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00`;
}

/** Date → 'YYYYMMDDTHHMMSSZ'（UTC） */
function icsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`
  );
}

/** 由 due 计算结束时间（+ 默认时长分钟） */
function endLocal(due: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(due);
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  d.setMinutes(d.getMinutes() + Math.max(1, minutes));
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`;
}

/** 单条待办 → 完整 VCALENDAR 文本（CRLF 结尾） */
export function buildVEvent(todo: TodoItem, settings: CalendarSyncSettings): string {
  const start = icsLocal(todo.due);
  const end = endLocal(todo.due, settings.defaultDurationMinutes);
  const title = escapeICS(todo.title || "待办");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//REword//Todo Calendar//CN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${todo.blockId}@reword`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${title}`,
    `TRIGGER:-PT${Math.max(0, Math.round(settings.reminderMinutes))}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/* ================= 传输 ================= */

/** 归一化集合路径：保证前导与结尾都是 `/` */
export function normalizeCollectionPath(p: string): string {
  let s = (p || "").trim();
  if (!s) return "/";
  if (!s.startsWith("/")) s = "/" + s;
  if (!s.endsWith("/")) s += "/";
  return s.replace(/\/{2,}/g, "/");
}

/** UTF-8 安全的 Basic 鉴权头 */
function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

/** 配置是否完整到足以发起请求 */
export function isSettingsUsable(s: CalendarSyncSettings): boolean {
  return !!s.serverUrl.trim() && !!s.calendarPath.trim();
}

/**
 * ⚠️ 内核 forwardProxy 的请求契约（2026-09-13 真机实测，勿凭直觉改动）：
 *
 *  | headers 形状                    | payloadEncoding | 结果                              |
 *  |---------------------------------|-----------------|-----------------------------------|
 *  | `[{ "Authorization": "..." }]`  | 省略            | ✅ 头正确 + body 完整（唯一可用） |
 *  | `[{ name, value }]`             | 省略            | ❌ 发出字面头 `name:` / `value:`  |
 *  | `[{ name, value }]`             | `"text"`        | ❌ 头错 **且 body 变 0 字节**     |
 *  | `{ "Authorization": "..." }`    | 省略            | ❌ 头完全丢失                     |
 *
 * 结论两条：① `headers` 必须是**「单键映射组成的数组」**；② **绝不要传 `payloadEncoding`**
 * （传 `"text"` 会让内核把 body 丢空，静默失败——表现为服务端收到 0 字节请求体）。
 * 响应结构：`data.{status, body, headers, contentType, bodyEncoding, elapsed, url}`。
 *
 * 另外：借内核转发还顺带绕开了浏览器 CORS，局域网 `http://` 的 CalDAV 无需改服务端配置。
 */
export async function caldavRequest(
  settings: CalendarSyncSettings,
  method: string,
  relPath: string,
  body = "",
  contentType = "text/calendar; charset=utf-8"
): Promise<CalResponse> {
  const base = settings.serverUrl.trim().replace(/\/+$/, "");
  const url = base + normalizeCollectionPath(settings.calendarPath) + (relPath || "");
  const r: any = await fetchSyncPost(SIYUAN_API.forwardProxy, {
    url,
    method,
    timeout: 20000,
    contentType,
    headers: [{ Authorization: basicAuth(settings.username, settings.password) }],
    payload: body,
  });
  if (!r || typeof r.code !== "number") throw new Error(t("内核转发无响应"));
  if (r.code !== 0) throw new Error(r.msg || t("转发失败（code={c}）", { c: r.code }));
  const d = r.data || {};
  return {
    status: Number(d.status) || 0,
    body: String(d.body || ""),
    headers: (d.headers || {}) as Record<string, string[]>,
  };
}

/** PUT 失败于 404/409（集合不存在）时，先 MKCOL 再重试一次 */
async function putWithMkcol(
  settings: CalendarSyncSettings,
  relPath: string,
  ics: string
): Promise<CalResponse> {
  let res = await caldavRequest(settings, "PUT", relPath, ics);
  if (res.status === 404 || res.status === 409) {
    await caldavRequest(settings, "MKCOL", "", "", "text/calendar; component=VEVENT");
    res = await caldavRequest(settings, "PUT", relPath, ics);
  }
  return res;
}

/* ================= 测试连接 ================= */

const PROBE_UID = "__reword_probe__";

/** 测试连接：PUT 一条探测事件 → 成功后 DELETE 掉 */
export async function caldavTestConnection(
  settings: CalendarSyncSettings
): Promise<{ ok: boolean; message: string }> {
  if (!isSettingsUsable(settings)) {
    return { ok: false, message: t("请先填写服务器地址与日历路径") };
  }
  const probe: TodoItem = {
    blockId: PROBE_UID,
    title: "REword 连接测试",
    due: icsProbeDue(),
    done: false,
    hpath: "",
    managed: false,
  };
  try {
    const res = await putWithMkcol(settings, `${PROBE_UID}.ics`, buildVEvent(probe, settings));
    if (res.status >= 200 && res.status < 300) {
      try {
        await caldavRequest(settings, "DELETE", `${PROBE_UID}.ics`);
      } catch {
        /* 探测残留可忽略 */
      }
      return { ok: true, message: `HTTP ${res.status}` };
    }
    return { ok: false, message: `HTTP ${res.status}${res.body ? " · " + res.body.slice(0, 120) : ""}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 探测事件用：明天此刻（避开"过去时间"引发的本地提醒） */
function icsProbeDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/* ================= 增量同步 ================= */

/**
 * 把待办集合同步到 CalDAV。
 * @returns 统计（created/updated/deleted/failed + 失败摘要）
 */
export async function syncTodosToCaldav(
  settings: CalendarSyncSettings,
  todos: TodoItem[],
  store: CalendarStoreLike
): Promise<SyncSummary> {
  const summary: SyncSummary = { created: 0, updated: 0, deleted: 0, failed: 0, messages: [] };

  if (!isSettingsUsable(settings)) {
    summary.failed = 1;
    summary.messages.push(t("未配置服务器地址或日历路径"));
    await store.setLastSync(Date.now(), summary.messages[0]);
    return summary;
  }

  // 需要出现在日历上的：有 due 且未完成
  const wanted = new Map<string, TodoItem>();
  for (const t of todos) {
    if (t.due && !t.done && t.blockId) wanted.set(t.blockId, t);
  }

  const prev = store.state().entries;
  const next: Record<string, SyncEntry> = {};

  // 新增 / 更新
  for (const [blockId, t] of wanted) {
    const before = prev[blockId];
    if (before && before.due === t.due && before.title === t.title) {
      next[blockId] = before; // 无变化
      continue;
    }
    try {
      const res = await putWithMkcol(settings, `${blockId}.ics`, buildVEvent(t, settings));
      if (res.status >= 200 && res.status < 300) {
        next[blockId] = { due: t.due, title: t.title };
        if (before) summary.updated++;
        else summary.created++;
      } else {
        summary.failed++;
        summary.messages.push(`${t.title}：HTTP ${res.status}`);
        if (before) next[blockId] = before; // 保留旧快照，下一轮重试
      }
    } catch (e) {
      summary.failed++;
      summary.messages.push(`${t.title}：${(e as Error).message}`);
      if (before) next[blockId] = before;
    }
  }

  // 删除：曾经同步过、但如今不在「应同步集合」里（已删除 / 已勾选完成 / 去掉 due）
  for (const blockId of Object.keys(prev)) {
    if (wanted.has(blockId)) continue;
    try {
      const res = await caldavRequest(settings, "DELETE", `${blockId}.ics`);
      if ((res.status >= 200 && res.status < 300) || res.status === 404) {
        summary.deleted++;
      } else {
        summary.failed++;
        summary.messages.push(`删除 ${blockId}：HTTP ${res.status}`);
        next[blockId] = prev[blockId];
      }
    } catch (e) {
      summary.failed++;
      summary.messages.push(`删除 ${blockId}：${(e as Error).message}`);
      next[blockId] = prev[blockId];
    }
  }

  await store.replaceEntries(next);
  await store.setLastSync(Date.now(), summary.failed ? summary.messages.slice(0, 3).join("；") : "");
  return summary;
}
