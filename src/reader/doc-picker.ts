import { Dialog } from "siyuan";
import { lsNotebooks, createDocWithMd, listDocsByPath } from "../siyuan/filetree.ts";

export interface PickedDoc {
  notebookId: string;
  docId: string;
  path: string;
  title: string;
}

/**
 * 通用「选择思源文档」弹窗：笔记本下拉 + 逐层文档树（进入 / 选择）+ 当前位置新建文档。
 * 返回选中的文档信息；取消返回 null。
 * 2026-09-01 新增，用于绑定「阅读摘录」「书图谱」目标文档。
 */
export function openDocPicker(opts: { title?: string } = {}): Promise<PickedDoc | null> {
  // 注入一次基础按钮样式，避免依赖外部 less（重复定义无害）
  const STYLE_ID = "reword-docpicker-style";
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      .bset-btn{padding:5px 12px;border:1px solid var(--b3-border-color,#d3d3d3);background:var(--b3-theme-surface,#f5f5f5);color:var(--b3-theme-on-surface,#333);border-radius:6px;cursor:pointer;font-size:13px;}
      .bset-btn:hover{background:var(--b3-theme-surface-hover,#eaeaea);}
      .bset-btn-primary{background:var(--b3-theme-primary,#3b82f6);color:#fff;border-color:transparent;}
      .bset-btn-primary:hover{opacity:.92;}
    `;
    document.head.appendChild(st);
  }
  return new Promise((resolve) => {
    let notebookId = "";
    let currentPath = ""; // 空串 = 笔记本根
    let dlg: any = null;

    async function render(container: HTMLElement) {
      container.innerHTML = "";
      const nbs = await lsNotebooks();
      const open = (nbs || []).filter((n: any) => !n.closed);
      if (!notebookId && open.length) notebookId = open[0].id;

      // 笔记本选择
      const sel = document.createElement("select");
      sel.className = "bset-select";
      sel.style.cssText = "width:100%;margin-bottom:8px;padding:6px;border-radius:6px;border:1px solid var(--b3-border-color,#ddd);";
      open.forEach((nb: any) => {
        const o = document.createElement("option");
        o.value = nb.id;
        o.textContent = nb.name;
        if (nb.id === notebookId) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = () => {
        notebookId = sel.value;
        currentPath = "";
        render(container);
      };
      container.appendChild(sel);

      // 路径面包屑
      const crumb = document.createElement("div");
      crumb.style.cssText = "margin:6px 0;color:var(--b3-theme-on-surface,#888);font-size:12px;";
      crumb.textContent = "当前位置：/" + (currentPath || "");
      container.appendChild(crumb);

      // 文档列表
      const list = document.createElement("div");
      list.style.cssText = "max-height:300px;overflow:auto;border:1px solid var(--b3-border-color,#eee);border-radius:8px;";
      let nodes: any[] = [];
      try {
        nodes = await listDocsByPath(notebookId, currentPath);
      } catch {
        nodes = [];
      }
      if (!nodes.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:16px;text-align:center;color:#999;font-size:13px;";
        empty.textContent = "（此位置暂无文档，可新建）";
        list.appendChild(empty);
      }
      nodes.forEach((n: any) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--b3-border-color,#eee);";
        const name = document.createElement("span");
        name.textContent = (n.type === "node" ? "📁 " : "📄 ") + (n.name || n.title || "未命名");
        row.appendChild(name);
        const right = document.createElement("span");
        if (n.type === "node") {
          const enter = document.createElement("button");
          enter.className = "bset-btn";
          enter.textContent = "进入";
          enter.onclick = () => {
            currentPath = (currentPath ? currentPath : "") + "/" + (n.name || n.title || "");
            render(container);
          };
          right.appendChild(enter);
        } else {
          const pick = document.createElement("button");
          pick.className = "bset-btn bset-btn-primary";
          pick.textContent = "选择";
          pick.onclick = () => {
            resolve({
              notebookId,
              docId: n.id,
              path: n.path || (currentPath ? currentPath : "") + "/" + (n.name || n.title),
              title: n.name || n.title || "未命名",
            });
            dlg?.destroy();
          };
          right.appendChild(pick);
        }
        row.appendChild(right);
        list.appendChild(row);
      });
      container.appendChild(list);

      // 新建文档
      const newBtn = document.createElement("button");
      newBtn.className = "bset-btn bset-btn-primary";
      newBtn.style.cssText = "margin-top:10px;";
      newBtn.textContent = "＋ 在当前位置新建文档";
      newBtn.onclick = async () => {
        const name = window.prompt("新文档名称：", "新文档");
        if (!name) return;
        const safe = name.trim().replace(/[\\/:*?"<>|]/g, "_");
        if (!safe) return;
        const p = (currentPath ? currentPath : "") + "/" + safe;
        try {
          const id = await createDocWithMd(notebookId, p, "");
          if (id) {
            resolve({ notebookId, docId: id, path: p, title: safe });
            dlg?.destroy();
          }
        } catch (e) {
          console.warn("[REword] 新建文档失败:", e);
        }
      };
      container.appendChild(newBtn);

      // 取消
      const cancel = document.createElement("button");
      cancel.className = "bset-btn";
      cancel.style.cssText = "margin-top:8px;";
      cancel.textContent = "取消";
      cancel.onclick = () => {
        dlg?.destroy();
        resolve(null);
      };
      container.appendChild(cancel);
    }

    dlg = new Dialog({
      title: opts.title || "选择思源文档",
      content: `<div class="bset-docpicker" style="padding:16px;"></div>`,
      width: "440px",
    });
    const host = dlg.element.querySelector(".bset-docpicker") as HTMLElement;
    if (host) render(host);
    else {
      const c = dlg.element.querySelector(".b3-dialog__content") as HTMLElement;
      if (c) render(c);
    }
  });
}
