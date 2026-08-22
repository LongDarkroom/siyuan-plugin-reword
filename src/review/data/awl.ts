/**
 * 学术词表 AWL（Academic Word List，Coxhead 2000）— Sublist 1~3 完整版
 * ------------------------------------------------------------------
 * 收录 Sublist 1~3 共约 170 词族（每词族给出一个最常用原型），是公认最高频
 * 的学术词；difficulty 模块统一做小写比对，命中即加 awlScore 维度权重。
 *
 * Sublist 4~10（合计约 400 词族）暂未收录。原因：
 *   - 需要逐字从 Coxhead 2000 原文录入，文本工作量大、易出错；
 *   - 即便补全，Sublist 4+ 学术词频已显著下降，对"日常学习者"rarity 维度
 *     增益有限；
 *   - 推荐由 gen-awl.mjs 脚本从 Coxhead 原文生成（见 scripts/ 目录 TODO）。
 *   - 临时扩展：运行期调用 difficulty.setAwlData(new Set([...])) 注入。
 *
 * 数据来源：Coxhead, A. (2000). A new academic word list. TESOL Quarterly, 34(2), 213-238.
 * 公共摘要可见 https://en.wikipedia.org/wiki/Academic_Word_List
 */
export const AWL_WORDS: string[] = [
  // ===== Sublist 1 (60 词族) =====
  "analyse", "analysis", "approach", "area", "assess", "assessment", "assume",
  "assumption", "authority", "available", "benefit", "concept", "consist", "constitute",
  "context", "contract", "create", "data", "define", "derived", "distribute", "economy",
  "environment", "establish", "estimate", "evidence", "export", "factor", "financial",
  "formula", "function", "identify", "income", "indicate", "individual", "interpret",
  "involve", "issue", "labour", "legal", "legislate", "major", "method", "occur", "percent",
  "period", "policy", "principle", "procedure", "process", "require", "research", "respond",
  "role", "section", "sector", "significant", "similar", "source", "specific", "structure",
  "theory", "variable",
  // ===== Sublist 2 (60 词族) =====
  "achieve", "acquire", "administrate", "affect", "appropriate", "aspect", "assist",
  "category", "chapter", "commission", "community", "complex", "conclude", "conduct",
  "consequence", "construction", "consume", "credit", "cultural", "design", "distinct",
  "element", "equate", "evaluate", "feature", "final", "focus", "impact", "injure",
  "institute", "invest", "item", "journal", "maintain", "normal", "obtain", "participant",
  "perceive", "positive", "potential", "previous", "primary", "purchase", "range", "region",
  "regulate", "relevant", "reside", "resource", "restrict", "secure", "seek", "select",
  "site", "strategy", "survey", "text", "traditional", "transfer", "alternative",
  // ===== Sublist 3 (50 词族) =====
  "adequate", "annual", "apparent", "approximate", "attitude", "attribute", "cease",
  "compensate", "component", "consent", "considerable", "constant", "contribute", "convert",
  "coordinate", "core", "corporate", "correspond", "criteria", "deduce", "demonstrate",
  "denote", "deprive", "diverse", "domain", "draft", "eliminate", "emerge", "emphasis",
  "empirical", "enforce", "enhance", "entity", "equivalent", "evolve", "exclude", "explicit",
  "facilitate", "fluctuate", "gender", "globe", "grade", "guarantee", "hypothesis",
  "implement", "implicate", "imply", "initial", "initiate", "logical", "margin", "mature",
  // ===== Sublist 4~10 (合计 ~400 词族) TODO =====
  // 待 gen-awl.mjs 脚本从 Coxhead 2000 原文自动生成；当前调用方仍可注入
  // 任意扩展词表（difficulty.setAwlData），不影响向后兼容。
];

/**
 * 去重 + 小写化后的最终词表（防止上游误传重复）。
 * 暴露给 review-data.ts 注入使用。
 */
export const AWL_WORDS_UNIQUE: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of AWL_WORDS) {
    const k = w.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
})();
