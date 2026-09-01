// L2 组件规范：在 L0 令牌包 + L1 控件之上，沉淀 ReWord 高频「复合组件」。
// 单一真源：所有外观走 src/index.less 的 .rw-* 规则（用 --b3-/--hw-/--reword-glass-* 令牌着色）。
// 框架无关：返回原生 HTMLElement，Svelte 面板与 innerHTML 拼装的浮层（如划词/批注浮层）都能用。
// dispose 解绑监听 / 清空子节点，满足「卸载无残留」。
// Svelte 侧另有 src/ui/components/*.svelte 薄封装（直接套 .rw-* 类 + <slot/>），结构与此处一致。

export type CardVariant = "dark" | "light";

export interface CardOptions {
  variant?: CardVariant;
  className?: string;
  role?: string;
  ariaLabel?: string;
}

export interface CardHandle {
  root: HTMLElement;
  /** 替换卡片内容（string 走 textContent，Node 走 appendChild） */
  setContent(node: Node | string): void;
  dispose(): void;
}

/** 玻璃浮动面板（统一替代各处散落的 .reword-glass 硬编码 / InkToolbar 重复样式） */
export function createCard(opts: CardOptions = {}): CardHandle {
  const root = document.createElement("div");
  root.className = "rw-card" + (opts.variant === "light" ? " rw-card--light" : "");
  if (opts.className) root.className += " " + opts.className;
  if (opts.role) root.setAttribute("role", opts.role);
  if (opts.ariaLabel) root.setAttribute("aria-label", opts.ariaLabel);
  const setContent = (node: Node | string) => {
    root.replaceChildren();
    if (typeof node === "string") root.textContent = node;
    else if (node) root.appendChild(node);
  };
  return {
    root,
    setContent,
    dispose() {
      root.replaceChildren();
    },
  };
}

export interface ListItemOptions {
  primary: string;
  secondary?: string;
  /** 可选图标（emoji / 字符 / 单字符 HTML） */
  icon?: string;
  /** 右侧内容：Node 直接挂，string 走 innerHTML */
  trailing?: Node | string;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: (e: MouseEvent) => void;
}

export interface ListItemHandle {
  root: HTMLElement;
  setSelected(v: boolean): void;
  setPrimary(text: string): void;
  dispose(): void;
}

/** 列表行（TOC / 书架 / 词表 / 标注列表等高频复用） */
export function createListItem(opts: ListItemOptions = { primary: "" }): ListItemHandle {
  const root = document.createElement("div");
  root.className = "rw-list-item" + (opts.className ? " " + opts.className : "");
  const iconEl = document.createElement("span");
  iconEl.className = "rw-list-item-icon";
  const textWrap = document.createElement("div");
  textWrap.className = "rw-list-item-text";
  const primaryEl = document.createElement("div");
  primaryEl.className = "rw-list-item-primary";
  primaryEl.textContent = opts.primary;
  const secondaryEl = document.createElement("div");
  secondaryEl.className = "rw-list-item-secondary";
  if (opts.secondary) secondaryEl.textContent = opts.secondary;
  else secondaryEl.style.display = "none";
  textWrap.appendChild(primaryEl);
  textWrap.appendChild(secondaryEl);
  const trailingEl = document.createElement("div");
  trailingEl.className = "rw-list-item-trailing";
  if (opts.trailing) {
    if (typeof opts.trailing === "string") trailingEl.innerHTML = opts.trailing;
    else trailingEl.appendChild(opts.trailing);
  } else trailingEl.style.display = "none";
  if (opts.icon) iconEl.innerHTML = opts.icon;
  else iconEl.style.display = "none";
  root.appendChild(iconEl);
  root.appendChild(textWrap);
  root.appendChild(trailingEl);
  if (opts.selected) root.classList.add("rw-list-item--selected");
  if (opts.disabled) root.classList.add("rw-list-item--disabled");
  const handler = (e: MouseEvent) => {
    if (!opts.disabled && opts.onClick) opts.onClick(e);
  };
  if (opts.onClick) root.addEventListener("click", handler);
  return {
    root,
    setSelected(v) {
      root.classList.toggle("rw-list-item--selected", v);
    },
    setPrimary(text) {
      primaryEl.textContent = text;
    },
    dispose() {
      if (opts.onClick) root.removeEventListener("click", handler);
      root.replaceChildren();
    },
  };
}

export interface SectionOptions {
  title?: string;
  hint?: string;
  className?: string;
}

export interface SectionHandle {
  root: HTMLElement;
  /** 内容插槽，addContent / appendChild 都挂到这里 */
  body: HTMLElement;
  addContent(node: Node): void;
  dispose(): void;
}

/** 分节容器（标题 + 说明 + 内容插槽；设置面板 / 面板区块分组用） */
export function createSection(opts: SectionOptions = {}): SectionHandle {
  const root = document.createElement("div");
  root.className = "rw-section" + (opts.className ? " " + opts.className : "");
  if (opts.title || opts.hint) {
    const header = document.createElement("div");
    header.className = "rw-section-header";
    if (opts.title) {
      const titleEl = document.createElement("div");
      titleEl.className = "rw-section-title";
      titleEl.textContent = opts.title;
      header.appendChild(titleEl);
    }
    if (opts.hint) {
      const hintEl = document.createElement("div");
      hintEl.className = "rw-section-hint";
      hintEl.textContent = opts.hint;
      header.appendChild(hintEl);
    }
    root.appendChild(header);
  }
  const body = document.createElement("div");
  body.className = "rw-section-body";
  root.appendChild(body);
  return {
    root,
    body,
    addContent(node) {
      body.appendChild(node);
    },
    dispose() {
      root.replaceChildren();
    },
  };
}
