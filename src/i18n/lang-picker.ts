/**
 * 界面语言选择弹窗（首次启动 / 手动切换共用）。
 *
 * ## 为什么首次启动要弹窗
 * 用户拍板（2026-09-10）：**第一次使用时就选择默认语言（中文 / English）**，
 * 而不是默默跟一个猜出来的值。之后在设置里可随时切换。
 *
 * ## 首次弹窗的文案为什么是中英双语、且不过 t()
 * 首次弹窗出现的时刻，我们还不知道用户用什么语言（这正是要问的问题），
 * 所以标题与说明**中英并列写死**——对两种用户都友好，也不依赖语言状态。
 * 手动切换弹窗则正常走 t()（此时语言已知）。
 *
 * ## 超时兜底
 * 首次弹窗在 `onload` 里 await，万一 Dialog 因环境异常没渲染出来，
 * 会把插件启动永久挂住。故加超时：到点按中文继续并落盘（下次不再弹）。
 */

import { Dialog } from "siyuan";
import { LANG_OPTIONS, t, type Lang } from "./index.ts";

/** 首次选择的最长等待时间（超时按中文继续，避免卡住插件启动） */
const FIRST_PICK_TIMEOUT_MS = 20_000;

function renderBody(descHtml: string, activeLang: Lang | ""): string {
  const buttons = LANG_OPTIONS.map((o) => {
    const active = o.id === activeLang ? " is-active" : "";
    return `<button type="button" class="hiword-lang-btn${active}" data-lang="${o.id}">${o.label}</button>`;
  }).join("");
  return `<div class="hiword-lang-pick">
  <p class="hiword-lang-pick-desc">${descHtml}</p>
  <div class="hiword-lang-pick-row">${buttons}</div>
</div>`;
}

interface ShowOptions {
  /** 首次选择：不可取消（超时兜底）；手动切换：可取消，返回 null */
  initial: boolean;
  /** 当前语言（手动切换时高亮） */
  current: Lang;
}

function showLangDialog(opts: ShowOptions): Promise<Lang | null> {
  const descHtml = opts.initial
    ? "选择 REword 插件的界面显示语言，之后可在设置中随时切换。<br>Choose the display language for REword. You can change it anytime in settings."
    : t("选择 REword 插件的界面显示语言，之后可在设置中随时切换。");
  const title = opts.initial ? "REword · 选择界面语言 / Select Language" : t("选择界面语言");

  return new Promise<Lang | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (v: Lang | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };

    let dlg: Dialog | undefined;
    try {
      dlg = new Dialog({
        title,
        content: renderBody(descHtml, opts.initial ? "" : opts.current),
        width: "420px",
      });
    } catch {
      // Dialog 构造失败（极端环境）→ 首次按中文继续，切换视为取消
      finish(opts.initial ? "zh_CN" : null);
      return;
    }

    const root = dlg.element;
    const close = () => {
      try {
        dlg?.destroy();
      } catch {
        /* 已销毁 */
      }
    };

    // 语言按钮
    root.querySelectorAll<HTMLElement>(".hiword-lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lang = btn.dataset.lang === "en_US" ? "en_US" : "zh_CN";
        close();
        finish(lang);
      });
    });

    // 手动切换：点遮罩 / 关闭按钮视为取消
    if (!opts.initial) {
      const closeBtn = root.querySelector('.b3-dialog__header .b3-dialog__close, [data-type="close"]');
      closeBtn?.addEventListener("click", () => {
        close();
        finish(null);
      });
    }

    if (opts.initial) {
      timer = setTimeout(() => {
        close();
        finish("zh_CN"); // 超时兜底：按中文继续，调用方会落盘，下次不再弹
      }, FIRST_PICK_TIMEOUT_MS);
    }
  });
}

/** 首次启动：选择默认语言（不可取消；异常时回落中文） */
export function pickInitialLang(): Promise<Lang> {
  return showLangDialog({ initial: true, current: "zh_CN" }).then((v) => v ?? "zh_CN");
}

/** 手动切换：返回新语言，取消返回 null */
export function openLangSwitcher(current: Lang): Promise<Lang | null> {
  return showLangDialog({ initial: false, current });
}
