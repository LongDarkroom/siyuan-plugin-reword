/**
 * foliate-js customElement 注册保护
 * ---------------------------------------------------------------
 * 思源插件热重载会重新执行入口模块，触发 foliate-js 内部的
 * `customElements.define('foliate-view' / 'foliate-paginator', ...)`
 * 重复注册，抛 `NotSupportedError: ... has already been used with this registry`，
 * 阻断整个 plugin onload（addDock 不执行 → 图标消失）。
 *
 * 本 shim 在 foliate 任何模块加载之前把 `customElements.define` 包裹一层：
 * 已注册的 name 静默跳过，未注册的照常注册。
 * 对其他插件/库完全透明（重复 define 本就是用户错误，跳过不影响任何正常行为）。
 *
 * 必须在 import 任何 foliate-js 模块之前加载（参见 src/index.ts 顶部）。
 */
(function patchCustomElementsForFoliate(): void {
  // 浏览器 customElements 全局单例
  const CE: any = (typeof customElements !== "undefined" ? customElements : null) as any;
  if (!CE) return; // 非浏览器环境（理论上不会到这里）
  if (CE.__foliatePatched) return;
  CE.__foliatePatched = true;
  const origDefine: (name: string, ctor: CustomElementConstructor, opts?: ElementDefinitionOptions) => void = CE.define.bind(CE);
  CE.define = function (name: string, ctor: CustomElementConstructor, opts?: ElementDefinitionOptions): void {
    try {
      if (CE.get(name)) return; // 已注册则跳过（热重载场景）
    } catch {
      /* get 在某些早期实现可能抛错；fallback 到正常 define */
    }
    return origDefine(name, ctor, opts);
  };
})();

export {};
