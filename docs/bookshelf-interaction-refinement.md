# 书架交互细化方案

> 日期:2026-08-29
> 范围:`src/reader/BookshelfView.svelte` + `src/reader/bookshelf-store.ts`
> 触发问题:用户反馈「组无法再编辑名字」「无法对文档改颜色」+ 我自己梳理出的其他盲点
> 目标:对齐 macOS Finder / Calibre 的成熟交互模式,补齐分组重命名 / 颜色标签 / 右键菜单 / 拖拽排序等核心操作

---

## 0. 一句话总结

**补齐三件事,顺带把次要的也填了:**

1. **分组改名可发现性** — 三击隐藏的按钮改为一击直达(双击组名 / 悬停铅笔图标 / 右键菜单)
2. **macOS 风格颜色标签** — 7 色 swatch(红/橙/黄/绿/蓝/紫/灰)同时支持分组和书籍
3. **右键菜单作为操作总入口** — 把现在散落在悬停层/弹窗里的操作统一收口

---

## 1. 现状审计(我摸完代码整理的问题清单)

### 1.1 致命级(用户主动抱怨)

| # | 问题 | 现状 | 触达路径 | 修复方向 |
|---|---|---|---|---|
| **F1** | **组无法再编辑名字** | `renameGroup` API 存在 (`bookshelf-store.ts:611`),UI 在「管理分组」弹窗里有「重命名」按钮 (`BookshelfView.svelte:1298`)| 侧边栏 → 点 ＋ → 弹出管理分组 → 找到目标组 → 点重命名 → 输入 → 回车。**5 步 + 用户根本不知道入口在弹窗里** | 双击侧边栏组名直接进入编辑模式 / 悬停显示 ✎ / 右键菜单 |
| **F2** | **无法对文档/分组染色** | `BookGroup` 只有 `id/name/createdAt` (`bookshelf-store.ts:41-45`),`BookMeta` 完全没有 `color` 字段 | 无路径 | 扩数据模型 + 加 7 色 swatch + 联动筛选/排序 |

### 1.2 重要级(我自己 review 发现)

| # | 问题 | 现状 | 修复方向 |
|---|---|---|---|
| **I1** | **右键菜单完全缺失** | grep 全文 `oncontextmenu` 0 命中。所有操作(改状态/改评分/移组/加标签/换封面)只能通过悬停层 ✎ 按钮进编辑弹窗 | 引入一个轻量右键菜单组件 `bookshelf-context-menu.svelte`,book/group 各自一套菜单项 |
| **I2** | **批量操作缺颜色 / 评分 / 收藏** | `batchSetStatus/SetGroup/AddTag/RemoveTag/Remove` 5 个 API,没有 `batchSetColor/SetRating/SetFavorite` | 补 store API + 在批量工具栏加 dropdown |
| **I3** | **列表视图不显示组归属** | 行视图 (`BookshelfView.svelte:1120-1190`) 显示作者/格式/大小/进度/时长/标签,没显示 `groupId` | 在行尾加组名 chip(未分组的书显示「—」) |
| **I4** | **组内无排序控制** | 没有 `order` 字段,书在组内的顺序等于 `query()` 后的全局排序 | `BookMeta` 加 `order?: number`(同组内手动置顶用),侧边栏组上右键「排序方式 / 手动排序」 |
| **I5** | **没有「继续读最近一本」快捷入口** | 续读按钮每本书卡片都有,但顶栏没有"上次读到 X"总入口,得手动找 | 顶栏在视图切换按钮旁加一个 ⏵ 继续读 按钮(打开 `lastReadAt` 最大的未完读书) |
| **I6** | **筛选维度缺颜色 / 评分** | `BookFilter` (`bookshelf-store.ts:62-77`) 有 keyword/status/format/tag/groupId/favoriteOnly/minRating,但没 `color` | 加 `color?: string`(单色 / "all" / undefined) |
| **I7** | **没有 series 维度的快速操作** | `BookMeta.series` 已存,但没有任何 UI 入口去「按丛书批量选」 | 侧边栏加「丛书」区块(参考现有「格式」区块),点击丛书筛选,批量工具栏加「同丛书批量加标签」 |

### 1.3 锦上添花级

| # | 问题 | 修复方向 |
|---|---|---|
| **N1** | 编辑弹窗 (`BookshelfView.svelte:1313-1427`) 没有 Esc 关闭 / Enter 提交 | 全局监听 keydown |
| **N2** | 列表视图没有键盘导航(J/K 上下、Enter 打开) | 加 `tabindex` + keydown |
| **N3** | 顶栏「全部 / 收藏 / 未分组」数字旁边没有「在读 / 读完」 | 已实现 facets 但 UI 没暴露 (`bookshelf-store.ts:775-779` 已有 `statusCounts`) |
| **N4** | 重复导入时静默 skip,没提示哪几本跳过了 | 导入完成 toast 加上「N 本已存在,跳过」 |
| **N5** | 删除分组时只 toast,没明确告知组内书回到「未分组」 | 已有 toast 文字,但 dialog 警告文字应同时出现 |

### 1.4 优先级判断

| 等级 | 必须 | 重要 | 锦上 |
|---|---|---|---|
| **数量** | F1 + F2 (2 项) | I1-I7 (7 项) | N1-N5 (5 项) |
| **工作量** | F1:半天 / F2:1.5 天 | 每项 0.5-1 天 | 零碎 |
| **总投入** | **2 天** | **5 天** | 1.5 天 |

---

## 2. macOS 风格颜色选择器设计(核心)

### 2.1 配色(token-based,留扩展空间)

| Token | 中文 | Hex (Light) | Hex (Dark) | 用途 |
|---|---|---|---|---|
| `red` | 红 | `#ff453a` | `#ff453a` | 必读 / 高优 |
| `orange` | 橙 | `#ff9f0a` | `#ff9f0a` | 技术 / 工具书 |
| `yellow` | 黄 | `#ffd60a` | `#ffd60a` | 速读 / 笔记源 |
| `green` | 绿 | `#34c759` | `#30d158` | 文学 / 已完成 |
| `blue` | 蓝 | `#0a84ff` | `#0a84ff` | 教材 / 学习中 |
| `purple` | 紫 | `#bf5af2` | `#bf5af2` | 小说 / 兴趣 |
| `gray` | 灰 | `#8e8e93` | `#98989d` | 归档 / 暂时搁置 |

> 不用 macOS 原生 6 色是因为用户截图里多了灰色(归档用),沿用截图 7 色。
> Token 而非裸 hex 是为了未来加自定义色 / 主题色,只要在 `BOOK_COLORS` 字典里加一行。

### 2.2 swatch UI

```
┌─────────────────────────────────────┐
│  颜色                                │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐│
│  │● │ │● │ │● │ │● │ │● │ │● │ │● ││  ← 当前选中用白色描边 + 阴影
│  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘│
│   红   橙   黄   绿   蓝   紫   灰   │
│  ┌─────────────────────────────────┐│
│  │  ✕ 移除颜色                     ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

- swatch 32×32 圆角 50%(macOS 是方形 + 圆角 4px,沿用 4px 更稳)
- 选中态:外圈 2px `--b3-theme-primary` + 内圈 1px white inset
- 悬停态:scale(1.08) + 阴影
- 移除色按钮独立一栏,只有当前已选色才显示

### 2.3 出现位置(2 个)

**A. 书籍编辑弹窗** (`BookshelfView.svelte:1313` 区域)
- 在「丛书 / 系列」字段下方插入「颜色」区块
- 触发即改(`on:click={() => (editColor = token)}`),不需保存按钮
- 保存时随 `updateMeta` 一起落盘

**B. 分组管理弹窗** (`BookshelfView.svelte:1276` 区域)
- 每个 `group-item` 行尾加一个小色点(8×8 圆),点击展开 7 色 swatch(行内 popover)
- 同步给「侧边栏组名前的小圆点」上色(初始没有,设了色就显示)

### 2.4 筛选与排序联动

- `BookFilter.color` 单色精确匹配(string = token)
- 侧边栏「颜色」区块:7 个小色点,点击筛选该色,显示数量
- 列表视图标题旁加「按颜色排序」入口(色相 HSL 顺序:红→橙→黄→绿→蓝→紫→灰)
- 网格视图卡片右上角加一个 8×8 圆点色标(hover 时放大显示色名 tooltip)

### 2.5 视觉一致性

- swatch 在 light/dark 主题下用同一组 token 颜色(macOS 自己的做法),靠 opacity 区分
- 已选色在卡片上显示时,如果卡片背景较亮(白色),色点加 1px `--b3-border-color` 描边防止看不清

---

## 3. 分组改名可发现性设计(核心)

### 3.1 三入口并联

| 入口 | 触发方式 | 适用范围 | 反馈 |
|---|---|---|---|
| **A. 侧边栏双击组名** | `on:dblclick` on `.shelf-sb-label` | 鼠标用户(桌面端主流) | 输入框替换文字 + 自动 focus + select all + Enter 提交 / Esc 取消 |
| **B. 侧边栏悬停 ✎** | hover group 60ms 后右侧浮出 12×12 铅笔图标 | 移动端 / 触屏(双击不灵敏) | 同上 |
| **C. 右键菜单** | 详见 §4 | 高效用户 | 菜单项「重命名」,弹输入框 |

### 3.2 视觉提示(让用户知道「可编辑」)

- 侧边栏组名 hover 时:**下划线虚线**(dashed underline,1px,50% opacity) — macOS Finder 对可重命名项的处理
- 光标变成 `text`
- 已有 `title="点击筛选,可把书拖到这里归组"` 提示文案,改为「双击重命名 · 拖书归组 · 右键更多」

### 3.3 不破坏现状

- 现有的「管理分组」弹窗的重命名按钮 **保留**(高级用户已经形成肌肉记忆)
- 旧的弹窗路径仍可用,不强制迁移

---

## 4. 右键菜单设计(统一操作总入口)

### 4.1 实现思路

- 新增 `src/reader/bookshelf-context-menu.svelte`(单文件,~150 行)
- 接收 `items: MenuItem[]`,绝对定位 + 视口边缘 flip
- 点击外部 / Esc / 滚轮自动关闭
- **支持嵌套菜单**(分组子菜单用 hover 展开,不需点击)

### 4.2 书籍右键菜单项(按使用频次排序)

```
┌──────────────────────────────────────┐
│  📖 续读  /  开始阅读                 │
│  ─────────────────────────────────   │
│  ✎  编辑信息                         │
│  🏷  设置标签...                  ▶   │ ← 子菜单:已有标签 + 「新建标签...」
│  📁  移到分组...                  ▶   │ ← 子菜单:facets.groups + 「未分组」+「管理分组...」
│  ⭐  收藏 / 取消收藏                   │
│  ⏱  状态                            ▶ │ ← 子菜单:想读 / 在读 / 读完
│  ★   评分                            ▶ │ ← 子菜单:1-5 星 + 清除
│  ●   颜色                            ▶ │ ← 子菜单:7 色 swatch 网格 + 移除
│  ─────────────────────────────────   │
│  🖼  替换封面...                      │
│  📋  复制书名 / 复制路径               │
│  ─────────────────────────────────   │
│  🗑  从书架移除...                ⚠   │ ← 红色
└──────────────────────────────────────┘
```

### 4.3 分组右键菜单项

```
┌──────────────────────────────────────┐
│  ✎  重命名                           │
│  ●   颜色                            ▶ │ ← 子菜单:7 色 + 移除
│  ─────────────────────────────────   │
│  📂  在主区域打开                     │ ← 把 filterGroup 切到该组
│  📋  复制组名                         │
│  ─────────────────────────────────   │
│  🗑  删除分组                    ⚠   │ ← 红色 + 二次确认(组内书回到未分组)
└──────────────────────────────────────┘
```

### 4.4 性能与防误触

- 单例:全文档只一个 menu 元素,切换数据时只更新内容
- 长按 500ms 触屏:触屏右键用 `contextmenu` 事件,桌面用 `oncontextmenu`
- macOS Control+Click 在触屏板上等价右键(浏览器原生),无需特殊处理

---

## 5. 数据模型扩展

### 5.1 `BookGroup` 扩字段

```typescript
export interface BookGroup {
  id: string;
  name: string;
  createdAt: number;
  /** 2026-08-29 新增:macOS 风格 7 色 token,见 BOOK_COLORS 字典 */
  color?: BookColor;
}

export type BookColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

/** 7 色字典:UI swatch 渲染 + 筛选时反查名字用 */
export const BOOK_COLORS: readonly { token: BookColor; label: string; hex: string }[] = [
  { token: "red",    label: "红", hex: "#ff453a" },
  { token: "orange", label: "橙", hex: "#ff9f0a" },
  { token: "yellow", label: "黄", hex: "#ffd60a" },
  { token: "green",  label: "绿", hex: "#34c759" },
  { token: "blue",   label: "蓝", hex: "#0a84ff" },
  { token: "purple", label: "紫", hex: "#bf5af2" },
  { token: "gray",   label: "灰", hex: "#8e8e93" },
] as const;
```

### 5.2 `BookMeta` 扩字段

```typescript
export interface BookMeta {
  // ... 现有字段 ...
  /** 2026-08-29 新增:macOS 风格 7 色 token;组有颜色时也允许单本书覆盖 */
  color?: BookColor;
  /** 2026-08-29 新增:同组内手动排序用(数字小 = 靠前),缺省 = 跟随 query 排序 */
  order?: number;
}
```

### 5.3 `BookFilter` 扩字段

```typescript
export interface BookFilter {
  // ... 现有字段 ...
  /** 单色精确匹配;缺省 = 不限 */
  color?: BookColor;
}
```

### 5.4 `bookshelf-store.ts` 新 API

```typescript
/** 单本设色 */
async setColor(id: string, color?: BookColor): Promise<boolean>

/** 单本在同组内手动排序(数字小 = 靠前) */
async setOrder(id: string, order: number): Promise<boolean>

/** 批量设色,返回实际生效数量 */
async batchSetColor(ids: string[], color?: BookColor): Promise<number>

/** 批量评分 */
async batchSetRating(ids: string[], rating: number): Promise<number>

/** 批量收藏 */
async batchSetFavorite(ids: string[], favorite: boolean): Promise<number>

/** 分组设色(color = undefined = 移除) */
async setGroupColor(id: string, color?: BookColor): Promise<boolean>
```

### 5.5 `updateMeta` Pick 扩展

当前 `updateMeta` 的 `Pick<BookMeta, ...>` 缺 `color` / `order`,需要加:

```typescript
async updateMeta(
  id: string,
  patch: Partial<
    Pick<BookMeta,
      "title" | "author" | "series" | "status" | "rating" | "favorite"
      | "tags" | "groupId" | "bookmarks" | "color" | "order"   // ← 新增
    >
  >
): Promise<boolean>
```

### 5.6 query 排序

- `BookSortKey` 加 `"color"`,按 `BOOK_COLORS` 数组索引升序(红→橙→黄→绿→蓝→紫→灰)
- 数字排序稳定(已实现 `a.title.localeCompare` 次级键)

### 5.7 兼容性

- `BookGroup.color` / `BookMeta.color` / `BookMeta.order` 都是 optional,老数据无此字段直接 undefined,UI 显示「无色」+ 不影响现有功能
- 数据迁移:**零迁移成本**(JSON 缺字段自动 fallback)

---

## 6. UI 实施清单

### 6.1 文件改动列表

| 文件 | 改动 | 行数估计 |
|---|---|---|
| `src/reader/bookshelf-store.ts` | 扩 `BookGroup` / `BookMeta` / `BookFilter` / `BookSortKey`,加 `BOOK_COLORS` 常量,加 6 个新 API,扩 `updateMeta` Pick | +120 |
| `src/reader/BookshelfView.svelte` | 加 editColor 状态 / edit dialog 颜色区块 / sidebar 双击重命名 / sidebar 悬停 ✎ / 列表视图组 chip / 网格视图色点 / 顶栏 ⏵ 继续读 / series 区块 / 颜色区块(侧边栏) | +250 |
| `src/reader/bookshelf-context-menu.svelte` | **新文件** | +180 |
| `test/bookshelf-p0p1.test.mjs` | 已有,加 ~10 个新 case 覆盖 color/order/batchSetColor | +80 |
| `test/bookshelf-color.test.mjs` | **新文件** — 7 色字典完整性、token 合法性、setColor 幂等、batchSetColor 数量返回、query() 颜色筛选、颜色排序稳定 | +200 |

### 6.2 视觉位置总览

```
┌──────────────────────┬──────────────────────────────────────┐
│ 侧边栏                │ 主区域                                │
│                      │                                      │
│ 搜索                  │ ┌─顶栏─┐  📚 ⏵ 继续读  视图切换 导入  │
│ 全部 (N)              │ 搜索...                              │
│ 收藏 (N)              │ 批量工具栏 (选中时显示)               │
│ 未分组 (N)            ├──────────────────────────────────────┤
│ 阅读状态              │                                      │
│  想读 (N)             │  网格 / 列表                         │
│  在读 (N)             │                                      │
│  读完 (N)             │  卡片右上:色点 ●(如有色)             │
│ 我的分组              │  列表行尾:组名 chip / 色点           │
│  ●📁 文学 (N)         │                                      │
│  ●📁 技术 (N)         │                                      │
│  ...                  │                                      │
│ 颜色                  │                                      │
│  ●●●●●●● (各 N)      │                                      │
│ 丛书 (N)              │                                      │
│  哈利·波特 (N)        │                                      │
│  ...                  │                                      │
│ 标签                  │                                      │
│ 格式                  │                                      │
└──────────────────────┴──────────────────────────────────────┘
```

### 6.3 交互流示例:给一本书染色

```
入口 1:右键菜单 (高效)
  右键卡片 → 颜色 → [swatch 子菜单] → 点 ● 蓝 → 立即落盘 → 卡片右上出现蓝点 + toast「已设为蓝色」

入口 2:编辑弹窗 (发现性)
  hover 卡片 → ✎ → 弹窗 → 滚动到「颜色」区块 → 点 swatch → 立即落盘 → 点保存关闭

入口 3:批量 (一次染多本)
  切到选择模式 → 选 3 本 → 批量工具栏 → 颜色 → ● 绿 → 3 张卡片同时出现绿点
```

---

## 7. 测试覆盖

| 测试文件 | 新增 case | 覆盖点 |
|---|---|---|
| `test/bookshelf-color.test.mjs` | 15+ | 7 色字典完整性、token 枚举、setColor 幂等、setGroupColor、空色移除 |
| `test/bookshelf-p0p1.test.mjs`(追加) | 10+ | batchSetColor / batchSetRating / batchSetFavorite 数量、setOrder、query 颜色筛选 + 排序、侧边栏 facets 含 color 维度 |
| `test/bookshelf-context-menu.test.mjs` (新) | 8+ | 菜单构造、嵌套子菜单、视口边缘 flip、Esc 关闭 |
| `test/bookshelf-ui-meta.test.mjs` (新,可选) | 6+ | 编辑弹窗 color 字段提交、sidebar 双击重命名触发 commitRenameGroup |

---

## 8. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 右键菜单可能被部分用户误触(尤其 macOS 触屏板双指 tap) | 菜单出现位置用 mousemove 距离阈值判定,小于阈值不弹 |
| 颜色多到 7 色时小色点在小尺寸(8px)看不清 | 选中态用外圈 2px + 内圈 1px white 双层描边,任何主题下都可见 |
| 拖拽排序和 query 排序冲突 | 同组内 `order` 字段优先,跨组保持 query 排序;UI 在「按颜色 / 按时间」时显示「(组内手动排序已忽略)」hint |
| 老数据无 color 字段 | 全部 optional,UI 显示「无色」(不显色点),不影响 filter |
| series 区块在书少时是噪音 | 阈值:只有 ≥ 2 本用同一个 series 才显示该 series,`facets.series` 计算时过滤 |

---

## 9. 实施顺序(2 周计划)

| 周次 | 任务 | 交付 |
|---|---|---|
| 第 1 周 D1 | F1 拆分 3 入口(双击/✎/右键)+ 视觉提示 | sidebar 可重命名,无后端改动 |
| 第 1 周 D2-D3 | F2 数据模型 + BOOK_COLORS + 6 个新 store API + 单元测试 | store 完整,UI 还没接 |
| 第 1 周 D4-D5 | F2 编辑弹窗颜色区块 + sidebar 色点 + 网格卡片色点 | F2 主要功能可用 |
| 第 2 周 D1-D2 | I1 右键菜单组件 + 书籍/分组菜单项 | 右键总入口通 |
| 第 2 周 D3 | I2 批量设色/评分/收藏 + 工具栏 | 批量增强 |
| 第 2 周 D4 | I3 列表行尾组 chip + I5 顶栏 ⏵ 继续读 | 信息密度提升 |
| 第 2 周 D5 | I6 颜色筛选 + 排序 + I7 series 区块 + 全部单测 | v1.4.5 可发版 |

---

## 10. 暂不做(明确 scope out)

| 项 | 原因 |
|---|---|
| 自定义颜色(色盘) | 用户截图是 7 色固定,先满足需求,真要再加 picker 2 周 |
| 标签色(每个 tag 一个色) | 标签是文字 + 计数已够,加色增加视觉噪音 |
| 封面裁切 | 需要 canvas 库,独立功能,后续单独排期 |
| 同步到思源块属性(把 color 写到 custom-color) | 一次写两份数据难维护,先只存 hiword-bookshelf.json |
| 智能分组(规则) | 价值高但工作量大(规则引擎 + UI),独立版本做 |

---

## 11. 截图占位(实施时补)

- [ ] 7 色 swatch 弹窗(light)
- [ ] 7 色 swatch 弹窗(dark)
- [ ] 卡片右上色点状态
- [ ] 列表行尾组 chip
- [ ] 右键菜单(书籍)
- [ ] 右键菜单(分组,带颜色子菜单)
- [ ] 侧边栏双击组名进入编辑
- [ ] 批量工具栏颜色 dropdown

