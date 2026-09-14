/**
 * REword · 日历同步设置页（渲染进统一设置面板的「日历同步」Tab）
 * ------------------------------------------------------------------
 * 第三块能力（对应需求「日历同步设置」）：
 *   - CalDAV 服务器地址 / 账户 / 密码 / 日历集合路径
 *   - 事件默认时长、提醒提前量
 *   - 托管待办文档路径（默认 /Reword/待办）
 *   - 「测试连接」与「立即同步」按钮
 *
 * 交互取「改即存」：字段变更立刻写入 store（与阅读设置同款思路），
 * 因此本页不参与统一面板底部的「保存所有设置」按钮。
 */
import { t } from "../i18n/index.ts";
import {
  DEFAULT_SERVICE_CONFIG,
  DEFAULT_SERVICE_PYTHON,
  type CalendarHost,
} from "./types.ts";
import { listTodos } from "./todo-model.ts";
import {
  caldavTestConnection,
  isSettingsUsable,
  syncTodosToCaldav,
} from "./caldav.ts";
import {
  getServiceStatus,
  startService,
  stopService,
  type ServiceActionResult,
} from "./radicale-service.ts";

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderCalendarSettings(host: CalendarHost, root: HTMLElement | null): void {
  if (!root) return;
  const s = host.calendarStore.settings();

  const svcPathHint = DEFAULT_SERVICE_PYTHON;

  root.innerHTML = `
    <div class="hiword-up-group">
      <div class="hiword-up-group-label">
        <span class="hiword-up-group-name">${t("Radicale 服务")}</span>
        <span class="hiword-up-group-desc">${t("本地 CalDAV 服务由插件负责启停，不必手动开终端或配置开机自启")}</span>
      </div>
      <div class="rw-cal-svc-modes">
        <label class="rw-cal-svc-mode">
          <input type="radio" name="rw-cal-svc-mode" value="follow" ${s.serviceMode === "follow" ? "checked" : ""} />
          <span class="rw-cal-svc-mode-name">${t("跟随思源")}</span>
          <span class="rw-cal-svc-mode-desc">${t("思源启动时自动运行服务，退出时停止")}</span>
        </label>
        <label class="rw-cal-svc-mode">
          <input type="radio" name="rw-cal-svc-mode" value="manual" ${s.serviceMode === "manual" ? "checked" : ""} />
          <span class="rw-cal-svc-mode-name">${t("手动控制")}</span>
          <span class="rw-cal-svc-mode-desc">${t("仅在点击下方按钮时启动或停止")}</span>
        </label>
      </div>
      <div class="hiword-up-row hiword-up-row--actions">
        <button class="b3-button b3-button--outline b3-button--small" id="rw-cal-svc-start">${t("启动服务")}</button>
        <button class="b3-button b3-button--outline b3-button--small" id="rw-cal-svc-stop">${t("停止服务")}</button>
        <button class="b3-button b3-button--outline b3-button--small" id="rw-cal-svc-refresh">${t("刷新状态")}</button>
      </div>
      <div class="rw-cal-svc-state" id="rw-cal-svc-state">${t("正在检查服务状态…")}</div>
      <div class="hiword-up-row hiword-up-row--block">
        <span class="hiword-up-row-k">${t("服务程序（解释器）")}</span>
        <input type="text" class="hiword-up-input" id="rw-cal-svc-python" placeholder="${svcPathHint}" value="${esc(s.servicePythonPath)}" />
        <span class="hiword-up-row-sub">${t("留空则用默认路径 {p}", { p: svcPathHint })}</span>
      </div>
      <div class="hiword-up-row hiword-up-row--block">
        <span class="hiword-up-row-k">${t("服务配置文件")}</span>
        <input type="text" class="hiword-up-input" id="rw-cal-svc-config" placeholder="${DEFAULT_SERVICE_CONFIG}" value="${esc(s.serviceConfigPath)}" />
        <span class="hiword-up-row-sub">${t("留空则用默认路径 {p}", { p: DEFAULT_SERVICE_CONFIG })}</span>
      </div>
    </div>

    <div class="hiword-up-group">
      <div class="hiword-up-group-label">
        <span class="hiword-up-group-name">${t("日历同步（CalDAV）")}</span>
        <span class="hiword-up-group-desc">${t("把带时间的待办同步到局域网 CalDAV 服务器，手机日历 / 手表即可收到提醒")}</span>
      </div>
      <div class="hiword-up-row hiword-up-row--switch">
        <label class="hiword-up-switch">
          <input type="checkbox" id="rw-cal-enabled" ${s.enabled ? "checked" : ""} />
          <span>${t("启用日历同步")}</span>
        </label>
      </div>
      <div class="hiword-up-row">
        <span class="hiword-up-row-k">${t("服务器地址")}</span>
        <input type="text" class="hiword-up-input" id="rw-cal-server" placeholder="http://192.168.10.191:5232" value="${esc(s.serverUrl)}" />
      </div>
      <div class="hiword-up-row">
        <span class="hiword-up-row-k">${t("账户")}</span>
        <input type="text" class="hiword-up-input" id="rw-cal-user" value="${esc(s.username)}" />
      </div>
      <div class="hiword-up-row">
        <span class="hiword-up-row-k">${t("密码")}</span>
        <input type="password" class="hiword-up-input" id="rw-cal-pass" value="${esc(s.password)}" />
      </div>
      <div class="hiword-up-row hiword-up-row--block">
        <span class="hiword-up-row-k">${t("日历集合路径")}</span>
        <input type="text" class="hiword-up-input" id="rw-cal-path" placeholder="/test/reword/" value="${esc(s.calendarPath)}" />
        <span class="hiword-up-row-sub">${t("形如 /账户/日历名/ ；实际请求地址 = 服务器地址 + 集合路径 + 块ID.ics")}</span>
      </div>
    </div>

    <div class="hiword-up-group">
      <div class="hiword-up-group-label">
        <span class="hiword-up-group-name">${t("事件默认值")}</span>
        <span class="hiword-up-group-desc">${t("决定日历事件的时长与提醒提前量")}</span>
      </div>
      <div class="hiword-up-row">
        <span class="hiword-up-row-k">${t("事件时长（分钟）")}</span>
        <input type="number" class="hiword-up-input" id="rw-cal-dur" min="5" max="1440" step="5" value="${s.defaultDurationMinutes}" />
      </div>
      <div class="hiword-up-row">
        <span class="hiword-up-row-k">${t("提前提醒（分钟）")}</span>
        <input type="number" class="hiword-up-input" id="rw-cal-remind" min="0" max="1440" step="5" value="${s.reminderMinutes}" />
      </div>
      <div class="hiword-up-row hiword-up-row--block">
        <span class="hiword-up-row-k">${t("托管待办文档路径")}</span>
        <input type="text" class="hiword-up-input" id="rw-cal-docpath" value="${esc(s.managedDocPath)}" />
        <span class="hiword-up-row-sub">${t("插件在此文档下集中创建待办；留空则用默认 /Reword/待办")}</span>
      </div>
    </div>

    <div class="hiword-up-group">
      <div class="hiword-up-group-label">
        <span class="hiword-up-group-name">${t("连接与同步")}</span>
        <span class="hiword-up-group-desc">${t("改动即时保存；点「立即同步」把当前全部待办推到日历服务器")}</span>
      </div>
      <div class="hiword-up-row hiword-up-row--actions">
        <button class="b3-button b3-button--outline b3-button--small" id="rw-cal-set-test">${t("测试连接")}</button>
        <button class="b3-button b3-button--primary b3-button--small" id="rw-cal-set-sync">${t("立即同步")}</button>
      </div>
      <div class="rw-cal-set-status" id="rw-cal-set-status">
        ${host.calendarStore.state().lastSyncAt
          ? t("上次同步：{t}", { t: new Date(host.calendarStore.state().lastSyncAt).toLocaleString() })
          : t("尚未同步")}
      </div>
    </div>
  `;

  const statusEl = root.querySelector("#rw-cal-set-status") as HTMLElement | null;
  const q = <T extends HTMLElement = HTMLInputElement>(sel: string) =>
    root.querySelector(sel) as T | null;

  const setStatus = (msg: string) => { if (statusEl) statusEl.textContent = msg; };

  /** 收集当前表单值并落库 */
  async function commit() {
    await host.calendarStore.updateSettings({
      enabled: q("#rw-cal-enabled")?.checked ?? false,
      serverUrl: q("#rw-cal-server")?.value.trim() ?? "",
      username: q("#rw-cal-user")?.value ?? "",
      password: q("#rw-cal-pass")?.value ?? "",
      calendarPath: q("#rw-cal-path")?.value.trim() ?? "",
      defaultDurationMinutes: Math.max(5, Math.min(1440, Number(q("#rw-cal-dur")?.value) || 30)),
      reminderMinutes: Math.max(0, Math.min(1440, Number(q("#rw-cal-remind")?.value) || 0)),
      managedDocPath: q("#rw-cal-docpath")?.value.trim() || "/Reword/待办",
      serviceMode:
        q<HTMLInputElement>('input[name="rw-cal-svc-mode"]:checked')?.value === "manual"
          ? "manual"
          : "follow",
      servicePythonPath: q("#rw-cal-svc-python")?.value.trim() ?? "",
      serviceConfigPath: q("#rw-cal-svc-config")?.value.trim() ?? "",
    });
  }

  for (const sel of [
    "#rw-cal-enabled",
    "#rw-cal-server",
    "#rw-cal-user",
    "#rw-cal-pass",
    "#rw-cal-path",
    "#rw-cal-dur",
    "#rw-cal-remind",
    "#rw-cal-docpath",
    "#rw-cal-svc-python",
    "#rw-cal-svc-config",
  ]) {
    const el = q(sel);
    el?.addEventListener("change", () => { void commit(); });
  }

  /* ---------- Radicale 服务：状态与启停 ---------- */

  const svcStateEl = root.querySelector("#rw-cal-svc-state") as HTMLElement | null;
  const setSvcState = (msg: string) => {
    if (svcStateEl) svcStateEl.textContent = msg;
  };
  const withPid = (text: string, pid: number | null) => (pid ? `${text}（PID ${pid}）` : text);

  async function refreshSvcStatus(): Promise<void> {
    const st = await getServiceStatus(host.calendarStore.settings());
    setSvcState(withPid(st.detail, st.pid));
  }

  function applySvcResult(r: ServiceActionResult): void {
    setSvcState(withPid(r.message, r.status.pid));
    host.showMessage(r.message, r.ok ? 2500 : 4000, r.ok ? "info" : "error");
  }

  // 模式切换：选「跟随思源」时立刻把服务拉起来，避免「选了却不生效」的困惑
  for (const el of Array.from(root.querySelectorAll('input[name="rw-cal-svc-mode"]'))) {
    el.addEventListener("change", async () => {
      await commit();
      const cur = host.calendarStore.settings();
      if (cur.serviceMode === "follow") {
        const st = await getServiceStatus(cur);
        if (st.running) setSvcState(withPid(st.detail, st.pid));
        else applySvcResult(await startService(cur));
      } else {
        await refreshSvcStatus();
      }
    });
  }

  q("#rw-cal-svc-start")?.addEventListener("click", async () => {
    await commit();
    setSvcState(t("正在启动服务…"));
    applySvcResult(await startService(host.calendarStore.settings()));
  });

  q("#rw-cal-svc-stop")?.addEventListener("click", async () => {
    await commit();
    setSvcState(t("正在停止服务…"));
    applySvcResult(await stopService(host.calendarStore.settings()));
  });

  q("#rw-cal-svc-refresh")?.addEventListener("click", async () => {
    setSvcState(t("正在检查服务状态…"));
    await refreshSvcStatus();
  });

  void refreshSvcStatus();

  q("#rw-cal-set-test")?.addEventListener("click", async () => {
    await commit();
    setStatus(t("正在测试连接…"));
    const r = await caldavTestConnection(host.calendarStore.settings());
    if (r.ok) {
      setStatus(t("连接成功（{m}）", { m: r.message }));
      host.showMessage(t("CalDAV 连接成功"), 2500, "info");
    } else {
      setStatus(t("连接失败：{m}", { m: r.message }));
      host.showMessage(t("CalDAV 连接失败：{m}", { m: r.message }), 4000, "error");
    }
  });

  q("#rw-cal-set-sync")?.addEventListener("click", async () => {
    await commit();
    const s2 = host.calendarStore.settings();
    if (!isSettingsUsable(s2)) {
      setStatus(t("请先填写服务器地址与日历路径"));
      return;
    }
    setStatus(t("正在同步…"));
    const todos = await listTodos(s2.managedDocPath);
    const sum = await syncTodosToCaldav(s2, todos, host.calendarStore);
    const msg = t("同步完成：新增 {c} · 更新 {u} · 删除 {d} · 失败 {f}", {
      c: sum.created, u: sum.updated, d: sum.deleted, f: sum.failed,
    });
    setStatus(sum.failed ? `${msg}｜${sum.messages.slice(0, 3).join("；")}` : msg);
    host.refreshCalendarPanels();
  });

  // 首次打开即把默认值落库，保证「托管文档路径」等有确定值
  void commit();
}
