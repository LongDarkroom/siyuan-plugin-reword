#!/usr/bin/env node
/**
 * P4 双主题验收预览生成器
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/theme_preview.mjs
 *
 * 生成 qa-reports/theme_preview.html：一个可在浏览器里对比「亮/暗」两套主题的验收页。
 * - 变量取自本机思源真实主题文件（/Applications/Siyuan.app/.../appearance/themes/{daylight,midnight}/theme.css）
 * - 渲染 REword 语义化后的词库卡 / 查词卡 / 词组短语 / 互见卡 / 批注 15 色板
 * - 顶部「亮色 / 暗色」切换，无刷新即时换肤，验证明暗自适应与无样式冲突
 * ------------------------------------------------------------------
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const OUT = path.join(PLUGIN_ROOT, "qa-reports", "theme_preview.html");

// ---------- 提取主题变量 ----------
function extractVars(css) {
  const vars = {};
  const re = /(--b3-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css))) vars[m[1]] = m[2].trim();
  return vars;
}
const THEMES = [
  { name: "daylight", label: "亮色（daylight）" },
  { name: "midnight", label: "暗色（midnight）" },
];
const themeVars = {};
for (const t of THEMES) {
  const p = `/Applications/Siyuan.app/Contents/Resources/appearance/themes/${t.name}/theme.css`;
  const css = fs.readFileSync(p, "utf-8");
  themeVars[t.name] = extractVars(css);
}
const day = themeVars.daylight;
const night = themeVars.midnight;
const varBlock = (v) =>
  Object.entries(v)
    .map(([k, val]) => `${k}: ${val};`)
    .join("\n  ");
console.log("daylight 变量:", Object.keys(day).length, "| midnight 变量:", Object.keys(night).length);

// ---------- 预览 CSS（镜像 REword 新语义化样式，全部走 --b3-* 变量） ----------
const css = `
:root { ${varBlock(day)} }
body.theme-dark { ${varBlock(night)} }
* { box-sizing: border-box; }
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 24px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); transition: background .2s, color .2s; }
.topbar { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; flex-wrap: wrap; }
h1 { font-size: 17px; margin: 0; font-weight: 600; }
.sub { font-size: 12px; color: var(--b3-theme-on-surface-light); }
.toggle { display: inline-flex; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); border-radius: 8px; overflow: hidden; }
.toggle button { border: none; background: transparent; padding: 6px 14px; font-size: 13px; color: var(--b3-theme-on-surface); cursor: pointer; }
.toggle button.active { background: var(--b3-theme-primary); color: var(--b3-theme-on-primary, #fff); font-weight: 600; }
.sec { margin-bottom: 22px; }
.sec-title { font-size: 13px; font-weight: 600; color: var(--b3-theme-on-surface-light); margin-bottom: 10px; border-left: 3px solid var(--b3-theme-primary); padding-left: 8px; }

/* ---- 词库简洁卡（P5 新设计：词性图标+文字徽标、变形下划线）---- */
.vb-card { padding: 10px 0; border-bottom: 1px solid var(--b3-border-color); }
.vb-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.vb-word { font-weight: 700; font-size: 16px; color: var(--b3-protyle-inline-strong-color, var(--b3-theme-on-background)); }
.vb-phon { font-size: 12.5px; font-style: italic; color: var(--b3-protyle-inline-em-color, var(--b3-theme-on-surface-light)); font-family: monospace; }
.vb-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.vb-meaning { font-size: 15px; font-weight: 600; color: var(--b3-theme-on-background); }
.vb-sense { font-size: 12.5px; color: var(--b3-theme-on-surface); padding: 2px 0; }
.vb-infl { font-size: 12px; color: var(--b3-theme-on-surface); margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.vb-infl b { color: var(--b3-theme-on-surface-light); font-size: 11px; font-weight: 600; margin-right: 4px; }
.vb-infl u { color: var(--b3-protyle-inline-u-color, var(--b3-theme-primary)); text-underline-offset: 2px; font-weight: 600; }
.vb-badges { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-left: 2px; }
.vb-pos-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #357abd; background: color-mix(in srgb, currentColor 9%, transparent); border-radius: 6px; padding: 1px 7px 1px 4px; line-height: 1.7; }
.vb-pos-chip[data-pos="n."] { color: #357abd; }
.vb-pos-chip[data-pos="v."] { color: #3a9a5f; }
.vb-pos-chip[data-pos="adj."] { color: #e08a2e; }
.vb-pos-chip[data-pos="adv."] { color: #8b5cf6; }
.vb-pos-chip[data-pos="prep."] { color: #2f9e8f; }
.vb-pos-ico { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 3px; font-size: 9px; font-weight: 700; color: inherit; background: color-mix(in srgb, currentColor 20%, transparent); border-radius: 4px; line-height: 1; }
.vb-pos-text { color: var(--b3-theme-on-surface); }

/* ---- 词库详细卡（P5 双栏：单词意思·例句 | 词组·短语）---- */
.detail-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 4px; align-items: start; }
.detail-col { min-width: 0; }
.detail-col-phrase { border-left: 2px solid var(--b3-theme-primary-light, #ffe9a8); padding-left: 10px; }

/* ---- 查词卡（P2 简化后）---- */
.dict-card { padding: 6px 0 14px; }
.dict-header { display: flex; align-items: center; gap: 10px; padding: 0 0 8px; margin-bottom: 10px; border-bottom: 1px solid var(--b3-border-color); flex-wrap: wrap; }
.dict-word { font-weight: 700; font-size: 20px; color: var(--b3-protyle-inline-strong-color, var(--b3-theme-on-background)); }
.dict-phon { font-family: monospace; font-size: 14px; font-style: italic; color: var(--b3-protyle-inline-em-color, var(--b3-theme-on-surface-light)); }
.senses { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sense-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; border-bottom: 1px dashed var(--b3-border-color); }
.sense-item:last-child { border-bottom: none; }
.pos { flex: 0 0 auto; min-width: 30px; height: 20px; padding: 0 7px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #357abd; background: color-mix(in srgb, #357abd 12%, transparent); border-radius: 5px; margin-top: 2px; }
.num { flex: 0 0 auto; min-width: 28px; font-size: 13px; font-weight: 700; color: var(--b3-theme-on-surface-light); margin-top: 2px; }
.brief { font-style: italic; color: var(--b3-theme-on-surface-light); font-size: 12.5px; margin-right: 4px; }
.zh { font-size: 16px; font-weight: 600; color: var(--b3-theme-on-background); }
.sense-body { flex: 1; min-width: 0; }
.example { margin: 4px 0 0; padding: 6px 10px; border: none; border-left: 3px solid var(--b3-theme-primary); border-radius: 0 6px 6px 0; background: var(--b3-bq-background, rgba(0,0,0,.035)); color: var(--b3-theme-on-surface); font-size: 12.5px; font-style: italic; }
.example .ex-zh { font-style: normal; color: var(--b3-theme-on-surface-light); font-size: 12px; }
.toggle-senses { margin: 8px 0 0; padding: 2px 4px; border: none; background: transparent; color: var(--b3-theme-primary); font-size: 12px; cursor: pointer; }

/* ---- 词组短语 / 互见 ---- */
.phrase { padding: 4px 0 8px; border-bottom: 1px dashed var(--b3-border-color); font-size: 14px; }
.phrase-en { font-weight: 600; color: var(--b3-theme-primary); font-family: monospace; }
.phrase-zh { color: var(--b3-theme-on-surface); }
.crossref { display: flex; align-items: center; gap: 8px; padding: 4px 0 8px; border-bottom: 1px dashed var(--b3-border-color); }
.crossref-eq { font-weight: 700; color: var(--b3-theme-on-surface-light); }
.crossref-target { border: none; background: none; padding: 0; color: var(--b3-protyle-inline-link-color, var(--b3-theme-primary)); font-weight: 600; text-decoration: underline; cursor: pointer; }
.crossref-zh { font-size: 14px; font-weight: 500; color: var(--b3-theme-on-background); }

/* ---- 批注色板（P0.5：data-ann-color 属性选择器）---- */
.ann-wrap { display: flex; flex-wrap: wrap; gap: 10px; }
.ann { padding: 3px 10px; text-decoration-line: underline; text-decoration-style: wavy; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: var(--ann-color, var(--b3-theme-primary)); border-radius: 2px; font-size: 13px; cursor: pointer; }
.hiword-ann-inline[data-ann-color="#4285f4"] { --ann-color: #4285f4; }
.hiword-ann-inline[data-ann-color="#0d9e5f"] { --ann-color: #0d9e5f; }
.hiword-ann-inline[data-ann-color="#e6a23c"] { --ann-color: #e6a23c; }
.hiword-ann-inline[data-ann-color="#db3f84"] { --ann-color: #db3f84; }
.hiword-ann-inline[data-ann-color="#5b6ee1"] { --ann-color: #5b6ee1; }
.hiword-ann-inline[data-ann-color="#17a2b8"] { --ann-color: #17a2b8; }
.hiword-ann-inline[data-ann-color="#f06543"] { --ann-color: #f06543; }
.hiword-ann-inline[data-ann-color="#6c757d"] { --ann-color: #6c757d; }
.hiword-ann-inline[data-ann-color="#9ca3af"] { --ann-color: #9ca3af; }
.hiword-ann-inline[data-ann-color="#facc15"] { --ann-color: #facc15; }
.hiword-ann-inline[data-ann-color="#22c55e"] { --ann-color: #22c55e; }
.hiword-ann-inline[data-ann-color="#06b6d4"] { --ann-color: #06b6d4; }
.hiword-ann-inline[data-ann-color="#ec4899"] { --ann-color: #ec4899; }
.hiword-ann-inline[data-ann-color="#f97316"] { --ann-color: #f97316; }
.hiword-ann-inline[data-ann-color="#8b5cf6"] { --ann-color: #8b5cf6; }
`;

// ---------- 样例内容 ----------
const ANN_COLORS = ["#4285f4","#0d9e5f","#e6a23c","#db3f84","#5b6ee1","#17a2b8","#f06543","#6c757d","#9ca3af","#facc15","#22c55e","#06b6d4","#ec4899","#f97316","#8b5cf6"];
const annStrip = ANN_COLORS.map((c) => `<span class="hiword-ann-inline" data-ann-color="${c}">wavy 波浪线</span>`).join(" ");

const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>REword · 双主题验收预览</title><style>${css}</style></head><body class="">
<div class="topbar">
  <h1>REword · 思源双主题验收</h1>
  <span class="sub">变量取自本机思源 ${THEMES.map((t) => t.label).join(" / ")} 主题（${Object.keys(day).length} 个 --b3-* 变量）</span>
  <span class="toggle" id="theme-toggle">
    <button data-theme="light" class="active">亮色</button>
    <button data-theme="dark">暗色</button>
  </span>
</div>

<div class="sec">
  <div class="sec-title">词库 · 简洁模式（P5：词头加粗 / 音标斜体 / 词性图标+文字徽标 / 变形下划线）</div>
  <div class="vb-card">
    <div class="vb-head"><span class="vb-word">follow</span><span class="vb-phon">/ˈfɒləʊ/</span></div>
    <div class="vb-row"><span class="vb-pos-chip" data-pos="v."><i class="vb-pos-ico">V</i><span class="vb-pos-text">动词</span></span><span class="vb-meaning">1. 跟随；跟着 2. 遵循，听从</span></div>
    <div class="vb-sense">3. 密切注视；关注</div>
    <div class="vb-row"><span class="vb-pos-chip" data-pos="n."><i class="vb-pos-ico">N</i><span class="vb-pos-text">名词</span></span><span class="vb-meaning">1. 跟随；追随</span></div>
    <div class="vb-infl"><span style="color:#3a9a5f;font-weight:600">动词变形</span><span><b>过去式</b><u>followed</u></span><span style="color:var(--b3-theme-on-surface-light)">·</span><span><b>过去分词</b><u>followed</u></span><span style="color:var(--b3-theme-on-surface-light)">·</span><span><b>现在进行时</b><u>following</u></span></div>
  </div>
  <div class="vb-card">
    <div class="vb-head"><span class="vb-word">child</span><span class="vb-phon">/tʃaɪld/</span></div>
    <div class="vb-row"><span class="vb-pos-chip" data-pos="n."><i class="vb-pos-ico">N</i><span class="vb-pos-text">名词</span></span><span class="vb-meaning">1. 小孩；儿童 2. 子女</span></div>
    <div class="vb-infl"><span style="color:#357abd;font-weight:600">名词复数</span><span><u>children</u></span></div>
  </div>
</div>

<div class="sec">
  <div class="sec-title">词库 · 详细模式（P5 双栏：左 = 单词意思·例句 / 右 = 词组·短语）</div>
  <div class="vb-card">
    <div class="vb-head">
      <span class="vb-word">procrastinate</span><span class="vb-phon">/prəʊˈkræstɪneɪt; prə-/</span>
      <span class="vb-badges"><span class="vb-pos-chip" data-pos="v."><i class="vb-pos-ico">V</i><span class="vb-pos-text">动词</span></span></span>
    </div>
    <div class="detail-cols">
      <div class="detail-col">
        <div style="font-size:12px;font-weight:600;color:var(--b3-theme-on-surface-light);margin-bottom:6px">▾ 单词意思 · 例句</div>
        <ul class="senses">
          <li class="sense-item"><span class="num">1.</span><div class="sense-body"><span class="brief">(to delay)</span><span class="zh">拖延；耽搁</span><blockquote class="example">Most often we procrastinate when faced with something we do not want to do.<span class="ex-zh"> — 面对不想做的事我们常常拖延。</span></blockquote></div></li>
          <li class="sense-item"><span class="num">2.</span><div class="sense-body"><span class="brief">(to postpone)</span><span class="zh">延迟；（使）延期</span></div></li>
        </ul>
      </div>
      <div class="detail-col detail-col-phrase">
        <div style="font-size:12px;font-weight:600;color:var(--b3-theme-on-surface-light);margin-bottom:6px">▾ 词组 · 短语</div>
        <div class="phrase"><span class="phrase-en">to procrastinate over sth</span> <span class="phrase-zh">对某事拖延不决</span><blockquote class="example">He tends to procrastinate over difficult decisions.<span class="ex-zh"> — 他面对艰难决定时总是拖延。</span></blockquote></div>
      </div>
    </div>
  </div>
</div>

<div class="sec">
  <div class="sec-title">查词卡（侧边栏 · P2 简化：无边框 / ul&gt;li / 词性文字标签 / 引用块例句）</div>
  <div class="dict-card">
    <div class="dict-header"><span class="dict-word">procrastinate</span><span class="dict-phon">/prəʊˈkræstɪneɪt; prə-/</span></div>
    <ul class="senses">
      <li class="sense-item"><span class="pos">vi.</span><span class="num">1.</span><div class="sense-body"><span class="brief">(to delay)</span><span class="zh">拖延；耽搁</span><blockquote class="example">Most often we procrastinate when faced with something we do not want to do.<span class="ex-zh"> — 面对不想做的事我们常常拖延。</span></blockquote></div></li>
      <li class="sense-item"><span class="pos">vt.</span><span class="num">2.</span><div class="sense-body"><span class="zh">(使)延迟；（使）耽搁</span></div></li>
      <li class="sense-item"><span class="pos">n.</span><span class="num">3.</span><div class="sense-body"><span class="zh">拖延者</span></div></li>
    </ul>
    <button class="toggle-senses">▾ 查看全部 6 个义项</button>
  </div>
</div>

<div class="sec">
  <div class="sec-title">词组 · 短语（引用块例句可朗读）</div>
  <div class="phrase"><span class="phrase-en">to take the blame for sth</span> <span class="phrase-zh">对某事承担责任</span><blockquote class="example">He took the blame for the team's failure.<span class="ex-zh"> — 他为团队的失败承担责任。</span></blockquote></div>
  <div class="phrase"><span class="phrase-en">keep to the course of</span> <span class="phrase-zh">沿…行进；途经</span></div>
</div>

<div class="sec">
  <div class="sec-title">互见词条（= 目标词可点击跳转，中文跟随补回）</div>
  <div class="crossref"><span class="pos">n.</span><span class="crossref-eq">=</span><button class="crossref-target">pattypan squash</button><span class="crossref-zh">西葫芦</span></div>
</div>

<div class="sec">
  <div class="sec-title">批注 15 色板（P0.5：data-ann-color 属性选择器着色，波浪线=生词）</div>
  <div class="ann-wrap">${annStrip}</div>
</div>

<script>
  const toggle = document.getElementById("theme-toggle");
  toggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (!btn) return;
    document.body.classList.toggle("theme-dark", btn.dataset.theme === "dark");
    toggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  });
</script>
</body></html>`;

fs.writeFileSync(OUT, html, "utf-8");
console.log("已生成:", OUT, `(${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
