// L1 控件工厂：把思源笔记原生控件机制打包成可复用接口。
//
// 设计原则：
// - 单一真源：所有控件样式来自 src/index.less 的 .rw-* 规则（用 --b3- 与 --hw- 令牌着色）；
//   button/text-field/select 同时带思源原生 b3-* 类，在设置上下文里进一步贴合思源外观。
// - 令牌由 L0(siyuan-tokens) 注入、L3(theme-bridge) 同步 → 控件自动跟随思源主题（含 iframe）。
// - 每个工厂函数返回 { root, input?, dispose }，dispose 解除事件监听，满足「卸载无残留」。
// - 框架无关：返回原生 HTMLElement，Svelte 面板与 innerHTML 拼装的浮层都能用。

export type Variant = "primary" | "secondary" | "text" | "danger";

export interface ControlHandle {
  root: HTMLElement;
  /** 对有表单值的控件暴露内部 input/select/textarea，便于 Svelte 双向绑定或外部同步 */
  input?: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  dispose: () => void;
}

export interface ButtonOptions {
  label?: string;
  /** 可选的内联 SVG 字符串或 emoji 文本 */
  icon?: string;
  variant?: Variant;
  disabled?: boolean;
  title?: string;
  onClick?: (e: MouseEvent) => void;
}

export function createButton(opts: ButtonOptions = {}): ControlHandle {
  const root = document.createElement("button");
  root.className = "b3-button rw-button";
  if (opts.variant && opts.variant !== "secondary") root.classList.add("b3-button--" + opts.variant);
  if (opts.icon) {
    const i = document.createElement("span");
    i.className = "rw-btn-icon";
    i.innerHTML = opts.icon;
    root.appendChild(i);
  }
  const span = document.createElement("span");
  span.className = "rw-btn-label";
  span.textContent = opts.label ?? "";
  root.appendChild(span);
  if (opts.title) root.title = opts.title;
  root.disabled = !!opts.disabled;
  const handler = (e: MouseEvent) => opts.onClick?.(e);
  root.addEventListener("click", handler);
  return {
    root,
    dispose: () => root.removeEventListener("click", handler),
  };
}

export interface SwitchOptions {
  label?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

/** 自包含开关（参考仓库既有 hiword-vb-switch：input + graph，不依赖外部 b3-switch，避免不确定性） */
export function createSwitch(opts: SwitchOptions = {}): ControlHandle {
  const root = document.createElement("label");
  root.className = "rw-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "rw-switch-input";
  input.checked = !!opts.checked;
  input.disabled = !!opts.disabled;
  const graph = document.createElement("span");
  graph.className = "rw-switch-graph";
  root.appendChild(input);
  root.appendChild(graph);
  if (opts.label) {
    const lbl = document.createElement("span");
    lbl.className = "rw-switch-label";
    lbl.textContent = opts.label;
    root.appendChild(lbl);
  }
  const handler = () => opts.onChange?.(input.checked);
  input.addEventListener("change", handler);
  return {
    root,
    input,
    dispose: () => input.removeEventListener("change", handler),
  };
}

export interface CheckboxOptions {
  label?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

export function createCheckbox(opts: CheckboxOptions = {}): ControlHandle {
  const root = document.createElement("label");
  root.className = "rw-checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "rw-checkbox-input";
  input.checked = !!opts.checked;
  input.disabled = !!opts.disabled;
  const mark = document.createElement("span");
  mark.className = "rw-checkbox-mark";
  root.appendChild(input);
  root.appendChild(mark);
  if (opts.label) {
    const lbl = document.createElement("span");
    lbl.className = "rw-checkbox-label";
    lbl.textContent = opts.label;
    root.appendChild(lbl);
  }
  const handler = () => opts.onChange?.(input.checked);
  input.addEventListener("change", handler);
  return {
    root,
    input,
    dispose: () => input.removeEventListener("change", handler),
  };
}

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupOptions {
  name?: string;
  options: RadioOption[];
  value?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

export function createRadioGroup(opts: RadioGroupOptions = { options: [] }): ControlHandle {
  const root = document.createElement("div");
  root.className = "rw-radio-group";
  if (opts.name) root.setAttribute("data-name", opts.name);
  const handlers: Array<() => void> = [];
  for (const o of opts.options) {
    const label = document.createElement("label");
    label.className = "rw-radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.className = "rw-radio-input";
    input.value = o.value;
    if (opts.name) input.name = opts.name;
    input.checked = o.value === opts.value;
    input.disabled = !!opts.disabled || !!o.disabled;
    const mark = document.createElement("span");
    mark.className = "rw-radio-mark";
    const text = document.createElement("span");
    text.className = "rw-radio-label";
    text.textContent = o.label;
    label.appendChild(input);
    label.appendChild(mark);
    label.appendChild(text);
    const h = () => opts.onChange?.(o.value);
    input.addEventListener("change", h);
    handlers.push(() => input.removeEventListener("change", h));
    root.appendChild(label);
  }
  return {
    root,
    dispose: () => handlers.forEach((h) => h()),
  };
}

export interface TextInputOptions {
  value?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  onInput?: (value: string) => void;
  onEnter?: (value: string) => void;
}

export function createTextInput(opts: TextInputOptions = {}): ControlHandle {
  const input = document.createElement("input");
  input.type = opts.type ?? "text";
  input.className = "b3-text-field rw-input";
  if (opts.value != null) input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.disabled = !!opts.disabled;
  const inputHandler = () => opts.onInput?.(input.value);
  input.addEventListener("input", inputHandler);
  const enterHandler = (e: KeyboardEvent) => {
    if (e.key === "Enter") opts.onEnter?.(input.value);
  };
  input.addEventListener("keydown", enterHandler);
  return {
    root: input,
    input,
    dispose: () => {
      input.removeEventListener("input", inputHandler);
      input.removeEventListener("keydown", enterHandler);
    },
  };
}

export interface TextAreaOptions {
  value?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  onInput?: (value: string) => void;
}

export function createTextArea(opts: TextAreaOptions = {}): ControlHandle {
  const ta = document.createElement("textarea");
  ta.className = "b3-text-field rw-textarea";
  if (opts.value != null) ta.value = opts.value;
  if (opts.placeholder) ta.placeholder = opts.placeholder;
  if (opts.rows) ta.rows = opts.rows;
  ta.disabled = !!opts.disabled;
  const handler = () => opts.onInput?.(ta.value);
  ta.addEventListener("input", handler);
  return {
    root: ta,
    input: ta,
    dispose: () => ta.removeEventListener("input", handler),
  };
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptions {
  options: SelectOption[];
  value?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

export function createSelect(opts: SelectOptions = { options: [] }): ControlHandle {
  const select = document.createElement("select");
  select.className = "b3-select rw-select";
  for (const o of opts.options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.disabled) opt.disabled = true;
    select.appendChild(opt);
  }
  if (opts.value != null) select.value = opts.value;
  select.disabled = !!opts.disabled;
  const handler = () => opts.onChange?.(select.value);
  select.addEventListener("change", handler);
  return {
    root: select,
    input: select,
    dispose: () => select.removeEventListener("change", handler),
  };
}

export interface SliderOptions {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  label?: string;
  disabled?: boolean;
  onChange?: (value: number) => void;
}

export function createSlider(opts: SliderOptions = {}): ControlHandle {
  const root = document.createElement("div");
  root.className = "rw-slider";
  const input = document.createElement("input");
  input.type = "range";
  input.className = "rw-slider-input";
  input.min = String(opts.min ?? 0);
  input.max = String(opts.max ?? 100);
  if (opts.step != null) input.step = String(opts.step);
  if (opts.value != null) input.value = String(opts.value);
  input.disabled = !!opts.disabled;
  if (opts.label) {
    const lbl = document.createElement("span");
    lbl.className = "rw-slider-label";
    lbl.textContent = opts.label;
    root.appendChild(lbl);
  }
  root.appendChild(input);
  const handler = () => opts.onChange?.(parseFloat(input.value));
  input.addEventListener("input", handler);
  return {
    root,
    input,
    dispose: () => input.removeEventListener("input", handler),
  };
}

export interface FieldOptions {
  label?: string;
  hint?: string;
  /** 已创建的控件 root（通常是某个工厂的 handle.root） */
  control: HTMLElement;
}

/** 带标签 + 可选说明的字段包装，仅负责布局，不接管内部控件的 dispose */
export function createField(opts: FieldOptions): ControlHandle {
  const root = document.createElement("div");
  root.className = "rw-field";
  if (opts.label) {
    const l = document.createElement("label");
    l.className = "rw-field-label";
    l.textContent = opts.label;
    root.appendChild(l);
  }
  const c = document.createElement("div");
  c.className = "rw-field-control";
  c.appendChild(opts.control);
  root.appendChild(c);
  if (opts.hint) {
    const h = document.createElement("div");
    h.className = "rw-field-hint";
    h.textContent = opts.hint;
    root.appendChild(h);
  }
  return { root, dispose: () => {} };
}
