/**
 * REword · 待办日历面板（Dock 面板）
 * ------------------------------------------------------------------
 * 三块能力（对应用户需求「待办日历 / 日历展示 / 日历同步设置」的前两块）：
 *   1. 列表视图：按 due 分组展示，可勾选、编辑、删除；
 *   2. 日历视图：FullCalendar（月 / 周 / 日，周与日是完整时间网格），
 *      点空时段 → 预填时间打开新建表单；
 *   3. 面板内直接新建（`datetime-local` 单框输入）。
 *
 * 第三个能力「日历同步设置」在统一设置面板（见 index.ts 的 renderCalendarSettings）。
 * 同步本身按需触发（工具栏「同步」按钮），不做后台轮询 —— 与 vivo 端 15 分钟拉取节奏匹配。
 */
import { Calendar, type EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import zhCnLocale from "@fullcalendar/core/locales/zh-cn.js";

import { t, getLang } from "../i18n/index.ts";
import type { CalendarHost, TodoItem } from "./types.ts";
import {
  listTodos,
  createTodoInManagedDoc,
  setTodoDue,
  setTodoTitle,
  setTodoDone,
  deleteTodo,
} from "./todo-model.ts";
import { fromDueString } from "./time-parse.ts";
import { syncTodosToCaldav, isSettingsUsable } from "./caldav.ts";

type PanelView = "list" | "dayGridMonth" | "timeGridWeek" | "timeGridDay";

const DAY_MS = 86_400_000;

function p2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** due → `<input type=datetime-local>` 的 value（YYYY-MM-DDTHH:MM） */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** due 的可读标签（本地化） */
function fmtDue(due: string): string {
  const d = fromDueString(due);
  if (!d) return due;
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - base.getTime()) / DAY_MS);
  if (diff === 0) return `${t("今天")} ${hm}`;
  if (diff === 1) return `${t("明天")} ${hm}`;
  if (diff === 2) return `${t("后天")} ${hm}`;
  if (diff === -1) return `${t("昨天")} ${hm}`;
  if (diff > 2 && diff <= 7) return `${diff} ${t("天后")} ${hm}`;
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${hm}`;
}

/**
 * 渲染待办日历面板。重复调用会先销毁旧 FullCalendar 实例（防 detached 泄漏）。
 */
export function renderCalendarPanel(host: CalendarHost, dockElement: HTMLElement): void {
  const contentEl = dockElement.querySelector("#hiword-dock-content") as HTMLElement | null;
  if (!contentEl) return;

  // 销毁上一实例（renderFeatureInto 会整块替换 innerHTML，旧实例必须显式销毁）
  const holder = dockElement as unknown as { __rwCalInstance?: Calendar | null };
  if (holder.__rwCalInstance) {
    try { holder.__rwCalInstance.destroy(); } catch { /* ignore */ }
    holder.__rwCalInstance = null;
  }

  let todos: TodoItem[] = [];
  let view: PanelView = "list";
  let cal: Calendar | null = null;
  let editingId: string | null = null;

  const settings = () => host.calendarStore.settings();

  contentEl.innerHTML = `
    <div class="rw-cal">
      <div class="rw-cal-top">
        <div class="rw-cal-tabs">
          <button class="rw-cal-tab is-active" data-view="list">${t("列表")}</button>
          <button class="rw-cal-tab" data-view="dayGridMonth">${t("月")}</button>
          <button class="rw-cal-tab" data-view="timeGridWeek">${t("周")}</button>
          <button class="rw-cal-tab" data-view="timeGridDay">${t("日")}</button>
        </div>
        <div class="rw-cal-acts">
          <button class="b3-button b3-button--outline b3-button--small" id="rw-cal-sync">${t("同步")}</button>
          <button class="b3-button b3-button--primary b3-button--small" id="rw-cal-new">＋ ${t("新建")}</button>
        </div>
      </div>
      <div class="rw-cal-editor" id="rw-cal-editor" style="display:none;">
        <input class="b3-text-field rw-cal-ed-title" id="rw-cal-ed-title" placeholder="${t("待办内容…")}" />
        <input class="b3-text-field rw-cal-ed-due" id="rw-cal-ed-due" type="datetime-local" />
        <div class="rw-cal-ed-actions">
          <button class="b3-button b3-button--outline b3-button--small" id="rw-cal-ed-cancel">${t("取消")}</button>
          <button class="b3-button b3-button--primary b3-button--small" id="rw-cal-ed-save">${t("保存")}</button>
        </div>
      </div>
      <div class="rw-cal-body">
        <div class="rw-cal-list" id="rw-cal-list"></div>
        <div class="rw-cal-calendar" id="rw-cal-fc" style="display:none;"></div>
      </div>
      <div class="rw-cal-status" id="rw-cal-status"></div>
    </div>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
    contentEl.querySelector(sel) as T | null;

  const listEl = $("#rw-cal-list");
  const calEl = $("#rw-cal-fc");
  const editorEl = $("#rw-cal-editor");
  const titleInput = $("#rw-cal-ed-title") as HTMLInputElement | null;
  const dueInput = $("#rw-cal-ed-due") as HTMLInputElement | null;
  const statusEl = $("#rw-cal-status");

  function setStatus(msg: string) {
    if (statusEl) statusEl.textContent = msg;
  }

  /* ---------------- 数据 ---------------- */

  async function loadTodos() {
    try {
      todos = await listTodos(settings().managedDocPath);
    } catch (e) {
      todos = [];
      setStatus(t("读取待办失败：{m}", { m: (e as Error).message }));
    }
  }

  /* ---------------- 列表视图 ---------------- */

  function itemHtml(item: TodoItem): string {
    const source = item.managed ? t("Reword 待办") : (item.hpath || t("文档"));
    return `
      <div class="rw-cal-item${item.done ? " is-done" : ""}" data-id="${item.blockId}">
        <input type="checkbox" class="rw-cal-cb" data-act="toggle" ${item.done ? "checked" : ""} />
        <div class="rw-cal-item-main" data-act="edit">
          <div class="rw-cal-item-title">${escapeHtml(item.title)}</div>
          <div class="rw-cal-item-meta">${item.due ? escapeHtml(fmtDue(item.due)) : t("未设置时间")} · ${escapeHtml(source)}</div>
        </div>
        <button class="rw-cal-item-del" data-act="del" title="${t("删除")}">✕</button>
      </div>`;
  }

  function renderList() {
    if (!listEl) return;
    const active = todos.filter((x) => !x.done);
    const done = todos.filter((x) => x.done);
    const scheduled = active.filter((x) => x.due);
    const unscheduled = active.filter((x) => !x.due);

    const group = (title: string, arr: TodoItem[]) =>
      arr.length
        ? `<div class="rw-cal-group"><div class="rw-cal-group-h">${title} <em>${arr.length}</em></div>${arr.map(itemHtml).join("")}</div>`
        : "";

    const body =
      group(t("待完成"), scheduled) +
      group(t("未排期"), unscheduled) +
      group(t("已完成"), done);

    listEl.innerHTML = body || `<div class="hiword-empty">${t("还没有待办，点右上角「新建」开始")}</div>`;
  }

  /* ---------------- 日历视图 ---------------- */

  function calendarEvents(): EventInput[] {
    return todos
      .filter((x) => !!x.due)
      .map((x) => ({
        id: x.blockId,
        title: x.title,
        start: x.due, // 'YYYY-MM-DDTHH:MM' 无时区 → FullCalendar 按本地解析
        allDay: false,
        classNames: x.done ? ["rw-cal-ev-done"] : [],
        extendedProps: { done: x.done },
      }));
  }

  function mountCalendar(initial: PanelView) {
    if (!calEl || cal) return;
    const isZh = getLang() === "zh_CN";
    cal = new Calendar(calEl, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
      initialView: initial === "list" ? "timeGridWeek" : initial,
      headerToolbar: { left: "prev,next today", center: "title", right: "" },
      locale: isZh ? zhCnLocale : "en",
      firstDay: 1,
      height: "100%",
      expandRows: true,
      nowIndicator: true,
      allDaySlot: true,
      slotMinTime: "06:00:00",
      slotMaxTime: "24:00:00",
      events: calendarEvents(),
      dateClick: (info) => openEditor(null, toLocalInput(info.date)),
      eventClick: (info) => openEditor(info.event.id, toLocalInput(info.event.start || new Date())),
    });
    cal.render();
    holder.__rwCalInstance = cal;
  }

  function refreshCalendar() {
    if (!cal) return;
    cal.removeAllEvents();
    for (const ev of calendarEvents()) cal.addEvent(ev);
  }

  /* ---------------- 编辑器 ---------------- */

  function openEditor(blockId: string | null, initialDue?: string) {
    editingId = blockId;
    if (editorEl) editorEl.style.display = "";
    if (titleInput) {
      titleInput.value = blockId ? (todos.find((x) => x.blockId === blockId)?.title || "") : "";
      setTimeout(() => titleInput.focus(), 0);
    }
    if (dueInput) {
      dueInput.value = initialDue || (blockId ? (todos.find((x) => x.blockId === blockId)?.due || "") : "");
    }
  }

  function closeEditor() {
    editingId = null;
    if (editorEl) editorEl.style.display = "none";
    if (titleInput) titleInput.value = "";
    if (dueInput) dueInput.value = "";
  }

  async function saveEditor() {
    const title = (titleInput?.value || "").trim();
    const due = dueInput?.value || "";
    if (!title) {
      host.showMessage(t("请输入待办内容"), 2500, "error");
      return;
    }
    try {
      if (editingId) {
        await setTodoTitle(editingId, title);
        await setTodoDue(editingId, due);
      } else {
        await createTodoInManagedDoc(host, title, due);
      }
      closeEditor();
      await loadTodos();
      renderList();
      refreshCalendar();
    } catch (e) {
      host.showMessage(t("保存失败：{m}", { m: (e as Error).message }), 3200, "error");
    }
  }

  /* ---------------- 同步 ---------------- */

  async function doSync() {
    const s = settings();
    if (!isSettingsUsable(s)) {
      host.showMessage(t("请先在「设置 → 日历同步」中填写服务器地址与日历路径"), 3200, "error");
      return;
    }
    setStatus(t("正在同步…"));
    await loadTodos();
    renderList();
    refreshCalendar();
    const sum = await syncTodosToCaldav(s, todos, host.calendarStore);
    const msg = t("同步完成：新增 {c} · 更新 {u} · 删除 {d} · 失败 {f}", {
      c: sum.created, u: sum.updated, d: sum.deleted, f: sum.failed,
    });
    setStatus(sum.failed ? `${msg}｜${sum.messages.slice(0, 2).join("；")}` : msg);
    host.showMessage(msg, 3200, sum.failed ? "error" : "info");
  }

  /* ---------------- 交互绑定 ---------------- */

  // 视图切换
  contentEl.querySelectorAll<HTMLElement>(".rw-cal-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = (btn.dataset.view || "list") as PanelView;
      view = next;
      contentEl.querySelectorAll(".rw-cal-tab").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const listView = view === "list";
      if (listEl) listEl.style.display = listView ? "" : "none";
      if (calEl) calEl.style.display = listView ? "none" : "";
      if (!listView) {
        mountCalendar(view);
        try { cal?.changeView(view); } catch { /* 视图未注册时忽略 */ }
        // 从 display:none 恢复后 FullCalendar 需要重算尺寸（否则网格高度为 0）
        if (cal) setTimeout(() => { try { cal!.updateSize(); } catch { /* ignore */ } }, 0);
      }
    });
  });

  $("#rw-cal-new")?.addEventListener("click", () => openEditor(null));
  $("#rw-cal-sync")?.addEventListener("click", () => void doSync());
  $("#rw-cal-ed-cancel")?.addEventListener("click", () => closeEditor());
  $("#rw-cal-ed-save")?.addEventListener("click", () => void saveEditor());

  // 列表项操作（事件委托）
  listEl?.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const act = target.dataset.act || (target.closest("[data-act]") as HTMLElement | null)?.dataset.act;
    const id = (target.closest("[data-id]") as HTMLElement | null)?.dataset.id;
    if (!act || !id) return;
    if (act === "toggle") {
      const checked = (target as HTMLInputElement).checked;
      try {
        await setTodoDone(id, checked);
        await loadTodos();
        renderList();
        refreshCalendar();
      } catch (err) {
        host.showMessage(t("操作失败：{m}", { m: (err as Error).message }), 3000, "error");
      }
      return;
    }
    if (act === "edit") { openEditor(id); return; }
    if (act === "del") {
      try {
        await deleteTodo(id);
        await loadTodos();
        renderList();
        refreshCalendar();
      } catch (err) {
        host.showMessage(t("删除失败：{m}", { m: (err as Error).message }), 3000, "error");
      }
    }
  });

  // 回车快速保存
  titleInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void saveEditor(); }
  });

  /* ---------------- 首屏 ---------------- */

  void (async () => {
    await loadTodos();
    renderList();
    const s = settings();
    if (!isSettingsUsable(s)) setStatus(t("未配置日历同步（设置 → 日历同步）"));
    else if (host.calendarStore.state().lastSyncAt) {
      setStatus(t("上次同步：{t}", { t: new Date(host.calendarStore.state().lastSyncAt).toLocaleString() }));
    }
  })();
}
