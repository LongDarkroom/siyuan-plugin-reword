/**
 * 微阅风格确认弹窗（删除批注等二次确认）
 * ------------------------------------------------------------------
 * 仿 whale-dlg-overlay / whale-dlg 结构，Promise 封装。
 * 独立 overlay，不参与 whale-manager 的 activeDialog 单例管理，
 * 因此可与批注编辑弹窗互不干扰。
 */

/** 弹出确认框，返回用户选择（true=确认，false=取消/关闭） */
export function confirmDelete(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "whale-dlg-overlay";
    ov.innerHTML = `
      <div class="whale-dlg whale-confirm" role="alertdialog" aria-modal="true">
        <div class="whale-dlg-head">
          <span class="whale-dlg-title">确认删除</span>
          <div class="whale-dlg-head-right">
            <button class="whale-dlg-close" id="wc-cancel" title="取消">✕</button>
          </div>
        </div>
        <div class="whale-confirm-body">${escapeHtml(message)}</div>
        <div class="whale-dlg-foot">
          <span class="whale-dlg-spacer"></span>
          <button class="whale-dlg-btn" id="wc-cancel2">取消</button>
          <button class="whale-dlg-btn whale-dlg-btn--danger" id="wc-ok">删除</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);

    // Esc 关闭的全局监听（done 中统一移除，避免经按钮关闭后残留，根因修复 #1）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
    };

    const done = (r: boolean) => {
      document.removeEventListener("keydown", onKey);
      ov.remove();
      resolve(r);
    };

    // 点击遮罩关闭
    ov.addEventListener("mousedown", (e) => {
      if (e.target === ov) done(false);
    });
    ov.querySelector("#wc-cancel")?.addEventListener("click", () => done(false));
    ov.querySelector("#wc-cancel2")?.addEventListener("click", () => done(false));
    ov.querySelector("#wc-ok")?.addEventListener("click", () => done(true));

    document.addEventListener("keydown", onKey);
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
