/**
 * 英文单词形态学变形（离线、词典无关）
 *
 * 用于词库卡片「简洁模式」中展示单词的常见变形：
 *   - 动词：过去式 / 过去分词 / 现在分词（=现在进行时）
 *   - 形容词：比较级 / 最高级
 *   - 副词：比较级 / 最高级（多数以 more / most 构成，少数 flat 副词用 -er / -est）
 *
 * 设计：规则生成 + 不规则表覆盖。规则生成处理绝大多数规则词，
 * 不规则表收录最常用的一批不规则动词与形容词/副词，保证常见词准确。
 * 不依赖词典内容，结果确定、可离线。
 */

/** 动词三种变形 */
export interface VerbForms {
  past: string;
  pastParticiple: string;
  presentParticiple: string;
}

/** 形容词 / 副词的比较级、最高级 */
export interface GradableForms {
  comparative: string;
  superlative: string;
}

/** 名词复数 */
export interface NounForms {
  plural: string;
}

/** 结构化变形结果（按需包含某一类） */
export interface WordInflections {
  verb?: VerbForms;
  adjective?: GradableForms;
  adverb?: GradableForms;
  noun?: NounForms;
}

function isVowel(ch: string): boolean {
  return "aeiou".includes(ch.toLowerCase());
}

/** 按样本词首字母大小写，统一变形结果的首字母大小写 */
function applyCase(form: string, sample: string): string {
  if (!sample || sample[0] !== sample[0].toUpperCase()) return form;
  return form.charAt(0).toUpperCase() + form.slice(1);
}

// ============ 不规则动词表：[past, pastParticiple, presentParticiple?] ============
// presentParticiple 缺省时按规则推导（drop-e + ing 等），仅在特殊时显式给出（如 be → being）。
const IRREGULAR_VERBS: Record<string, [string, string, string?]> = {
  be: ["was/were", "been", "being"],
  bear: ["bore", "borne", "bearing"],
  beat: ["beat", "beaten", "beating"],
  become: ["became", "become", "becoming"],
  begin: ["began", "begun", "beginning"],
  bend: ["bent", "bent", "bending"],
  bet: ["bet", "bet", "betting"],
  bid: ["bid", "bid", "bidding"],
  bind: ["bound", "bound", "binding"],
  bite: ["bit", "bitten", "biting"],
  bleed: ["bled", "bled", "bleeding"],
  blow: ["blew", "blown", "blowing"],
  break: ["broke", "broken", "breaking"],
  breed: ["bred", "bred", "breeding"],
  bring: ["brought", "brought", "bringing"],
  build: ["built", "built", "building"],
  burn: ["burnt", "burnt", "burning"],
  burst: ["burst", "burst", "bursting"],
  buy: ["bought", "bought", "buying"],
  catch: ["caught", "caught", "catching"],
  choose: ["chose", "chosen", "choosing"],
  cling: ["clung", "clung", "clinging"],
  come: ["came", "come", "coming"],
  cost: ["cost", "cost", "costing"],
  creep: ["crept", "crept", "creeping"],
  cut: ["cut", "cut", "cutting"],
  deal: ["dealt", "dealt", "dealing"],
  dig: ["dug", "dug", "digging"],
  do: ["did", "done", "doing"],
  draw: ["drew", "drawn", "drawing"],
  dream: ["dreamt", "dreamt", "dreaming"],
  drink: ["drank", "drunk", "drinking"],
  drive: ["drove", "driven", "driving"],
  eat: ["ate", "eaten", "eating"],
  fall: ["fell", "fallen", "falling"],
  feed: ["fed", "fed", "feeding"],
  feel: ["felt", "felt", "feeling"],
  fight: ["fought", "fought", "fighting"],
  find: ["found", "found", "finding"],
  flee: ["fled", "fled", "fleeing"],
  fling: ["flung", "flung", "flinging"],
  fly: ["flew", "flown", "flying"],
  forbid: ["forbade", "forbidden", "forbidding"],
  forget: ["forgot", "forgotten", "forgetting"],
  forgive: ["forgave", "forgiven", "forgiving"],
  freeze: ["froze", "frozen", "freezing"],
  get: ["got", "got", "getting"],
  give: ["gave", "given", "giving"],
  go: ["went", "gone", "going"],
  grow: ["grew", "grown", "growing"],
  hang: ["hung", "hung", "hanging"],
  hear: ["heard", "heard", "hearing"],
  hide: ["hid", "hidden", "hiding"],
  hit: ["hit", "hit", "hitting"],
  hold: ["held", "held", "holding"],
  hurt: ["hurt", "hurt", "hurting"],
  keep: ["kept", "kept", "keeping"],
  kneel: ["knelt", "knelt", "kneeling"],
  know: ["knew", "known", "knowing"],
  lay: ["laid", "laid", "laying"],
  lead: ["led", "led", "leading"],
  lean: ["leant", "leant", "leaning"],
  leap: ["leapt", "leapt", "leaping"],
  learn: ["learnt", "learnt", "learning"],
  leave: ["left", "left", "leaving"],
  lend: ["lent", "lent", "lending"],
  let: ["let", "let", "letting"],
  lie: ["lay", "lain", "lying"],
  light: ["lit", "lit", "lighting"],
  lose: ["lost", "lost", "losing"],
  make: ["made", "made", "making"],
  mean: ["meant", "meant", "meaning"],
  meet: ["met", "met", "meeting"],
  pay: ["paid", "paid", "paying"],
  put: ["put", "put", "putting"],
  read: ["read", "read", "reading"],
  ride: ["rode", "ridden", "riding"],
  ring: ["rang", "rung", "ringing"],
  rise: ["rose", "risen", "rising"],
  run: ["ran", "run", "running"],
  say: ["said", "said", "saying"],
  see: ["saw", "seen", "seeing"],
  seek: ["sought", "sought", "seeking"],
  sell: ["sold", "sold", "selling"],
  send: ["sent", "sent", "sending"],
  set: ["set", "set", "setting"],
  sew: ["sewed", "sewn", "sewing"],
  shake: ["shook", "shaken", "shaking"],
  shine: ["shone", "shone", "shining"],
  shoot: ["shot", "shot", "shooting"],
  show: ["showed", "shown", "showing"],
  shut: ["shut", "shut", "shutting"],
  sing: ["sang", "sung", "singing"],
  sink: ["sank", "sunk", "sinking"],
  sit: ["sat", "sat", "sitting"],
  sleep: ["slept", "slept", "sleeping"],
  slide: ["slid", "slid", "sliding"],
  sling: ["slung", "slung", "slinging"],
  slink: ["slunk", "slunk", "slinking"],
  sow: ["sowed", "sown", "sowing"],
  speak: ["spoke", "spoken", "speaking"],
  spend: ["spent", "spent", "spending"],
  spill: ["spilt", "spilt", "spilling"],
  spin: ["spun", "spun", "spinning"],
  spit: ["spat", "spat", "spitting"],
  split: ["split", "split", "splitting"],
  spread: ["spread", "spread", "spreading"],
  spring: ["sprang", "sprung", "springing"],
  stand: ["stood", "stood", "standing"],
  steal: ["stole", "stolen", "stealing"],
  stick: ["stuck", "stuck", "sticking"],
  sting: ["stung", "stung", "stinging"],
  stink: ["stank", "stunk", "stinking"],
  strike: ["struck", "struck", "striking"],
  string: ["strung", "strung", "stringing"],
  swear: ["swore", "sworn", "swearing"],
  sweep: ["swept", "swept", "sweeping"],
  swell: ["swelled", "swollen", "swelling"],
  swim: ["swam", "swum", "swimming"],
  swing: ["swung", "swung", "swinging"],
  take: ["took", "taken", "taking"],
  teach: ["taught", "taught", "teaching"],
  tear: ["tore", "torn", "tearing"],
  tell: ["told", "told", "telling"],
  think: ["thought", "thought", "thinking"],
  throw: ["threw", "thrown", "throwing"],
  thrust: ["thrust", "thrust", "thrusting"],
  tread: ["trod", "trodden", "treading"],
  understand: ["understood", "understood", "understanding"],
  wake: ["woke", "woken", "waking"],
  wear: ["wore", "worn", "wearing"],
  weave: ["wove", "woven", "weaving"],
  weep: ["wept", "wept", "weeping"],
  win: ["won", "won", "winning"],
  wind: ["wound", "wound", "winding"],
  withdraw: ["withdrew", "withdrawn", "withdrawing"],
  wring: ["wrung", "wrung", "wringing"],
  write: ["wrote", "written", "writing"],
  die: ["died", "died", "dying"],
  tie: ["tied", "tied", "tying"],
};

/** 不规则形容词 / 副词：比较级、最高级（同一词形同时覆盖 adj 与 adv 场景） */
const IRREGULAR_GRADABLE: Record<string, [string, string]> = {
  good: ["better", "best"],
  well: ["better", "best"],
  bad: ["worse", "worst"],
  badly: ["worse", "worst"],
  far: ["farther", "farthest"],
  little: ["less", "least"],
  many: ["more", "most"],
  much: ["more", "most"],
  late: ["later", "latest"],
  early: ["earlier", "earliest"],
};

/** 形容词常见「more / most」派生后缀（多音节，不加 -er / -est） */
const MORE_MOST_SUFFIXES = [
  "ful", "less", "ous", "able", "ible", "ive", "al", "ic",
  "ant", "ent", "ing", "ed", "ward", "like", "ish", "ar", "est",
];

// ============ 名词复数 ============

/** 不规则复数表（含外来语复数 -a/-ae/-i/-es、f→ves 等常见词） */
const IRREGULAR_PLURALS: Record<string, string> = {
  // 完全不规则 / 同形
  child: "children", man: "men", woman: "women", foot: "feet", tooth: "teeth",
  goose: "geese", mouse: "mice", louse: "lice", person: "people", ox: "oxen",
  die: "dice", penny: "pence",
  sheep: "sheep", deer: "deer", fish: "fish", series: "series", species: "species",
  aircraft: "aircraft", offspring: "offspring", headquarters: "headquarters",
  means: "means", crossroads: "crossroads", works: "works",
  // 拉丁 / 希腊外来语
  datum: "data", medium: "media", criterion: "criteria", phenomenon: "phenomena",
  analysis: "analyses", basis: "bases", crisis: "crises", thesis: "theses",
  hypothesis: "hypotheses", diagnosis: "diagnoses", oasis: "oases", parenthesis: "parentheses",
  appendix: "appendices", index: "indices", matrix: "matrices", vertex: "vertices",
  axis: "axes", focus: "foci", nucleus: "nuclei", stimulus: "stimuli",
  syllabus: "syllabi", alumnus: "alumni", cactus: "cacti", fungus: "fungi",
  bacterium: "bacteria", curriculum: "curricula", memorandum: "memoranda",
  // -o → -es（白名单，其余 +s）
  hero: "heroes", potato: "potatoes", tomato: "tomatoes", echo: "echoes",
  veto: "vetoes", torpedo: "torpedoes", embargo: "embargoes", buffalo: "buffaloes",
  // -f / -fe → -ves
  knife: "knives", life: "lives", wife: "wives", half: "halves", loaf: "loaves",
  leaf: "leaves", shelf: "shelves", thief: "thieves", calf: "calves", wolf: "wolves",
  self: "selves", scarf: "scarves", hoof: "hooves",
};

/** 规则复数推导（-es / -ies / -ves / -s） */
function pluralOf(base: string): string {
  const w = base.toLowerCase();
  const irr = IRREGULAR_PLURALS[w];
  if (irr) return applyCase(irr, base);
  // 咝音结尾（s / x / z / ch / sh）→ -es
  if (/(?:s|x|z|ch|sh)$/.test(w)) return applyCase(w + "es", base);
  // 辅音 + y → -ies
  if (w.endsWith("y") && !isVowel(w[w.length - 2])) {
    return applyCase(w.slice(0, -1) + "ies", base);
  }
  // -fe / -f → -ves（roof/chief/belief/proof 等例外走默认 +s）
  if (w.endsWith("fe")) return applyCase(w.slice(0, -2) + "ves", base);
  if (w.endsWith("f") && !["roof", "chief", "belief", "proof", "gulf", "cliff", "safe", "brief", "chef", "dwarf"].includes(w)) {
    return applyCase(w.slice(0, -1) + "ves", base);
  }
  return applyCase(w + "s", base);
}

// ============ 动词规则 ============

/** 规则过去式 / 过去分词（规则动词二者同形） */
function regularPast(w: string): string {
  if (w.endsWith("e")) return w + "d"; // bake → baked, like → liked
  if (w.endsWith("y") && !isVowel(w[w.length - 2])) {
    return w.slice(0, -1) + "ied"; // try → tried, carry → carried
  }
  // 单音节 CVC 且末字母非 w/x/y：双写末辅音（stop → stopped）
  if (isCvcWord(w)) return w + w[w.length - 1] + "ed";
  return w + "ed"; // play → played, open → opened
}

/** 现在分词（进行式） */
function presentParticiple(w: string): string {
  if (w.endsWith("ie")) return w.slice(0, -2) + "ying"; // die → dying, lie → lying
  if (w.length >= 2 && w.endsWith("e") && !w.endsWith("ee")) {
    return w.slice(0, -1) + "ing"; // make → making, come → coming
  }
  if (isCvcWord(w)) return w + w[w.length - 1] + "ing"; // run → running, sit → sitting
  return w + "ing";
}

/** 判断单词是否为「单音节 + 辅音-元音-辅音」结尾（用于双写），末字母非 w/x/y */
function isCvcWord(w: string): boolean {
  if (w.length < 3) return false;
  const last = w[w.length - 1];
  const mid = w[w.length - 2];
  const prev = w[w.length - 3];
  if ("wxy".includes(last)) return false;
  return !isVowel(last) && isVowel(mid) && !isVowel(prev);
}

function verbForms(base: string): VerbForms {
  const w = base.toLowerCase();
  const irr = IRREGULAR_VERBS[w];
  if (irr) {
    const past = irr[0];
    const pp = irr[1];
    const ing = irr[2] || presentParticiple(w);
    return {
      past: applyCase(past, base),
      pastParticiple: applyCase(pp, base),
      presentParticiple: applyCase(ing, base),
    };
  }
  const past = regularPast(w);
  return {
    past: applyCase(past, base),
    pastParticiple: applyCase(past, base),
    presentParticiple: applyCase(presentParticiple(w), base),
  };
}

// ============ 形容词 / 副词 比较级 ============

function erEst(w: string): [string, string] {
  // 以不发音 e 结尾（非 ee / ie）：large → larger / largest
  if (w.length >= 2 && w.endsWith("e") && !w.endsWith("ee") && !w.endsWith("ie")) {
    return [w + "r", w + "st"];
  }
  // 辅音 + y：happy → happier / happiest
  if (w.endsWith("y") && !isVowel(w[w.length - 2])) {
    const stem = w.slice(0, -1) + "i";
    return [stem + "er", stem + "est"];
  }
  // 单音节 CVC：big → bigger / biggest（双写末辅音 + er / est）
  if (isCvcWord(w)) {
    const d = w[w.length - 1];
    return [w + d + "er", w + d + "est"];
  }
  // 其余辅音结尾：tall → taller / tallest（est 含 e）
  return [w + "er", w + "est"];
}

function gradableForms(base: string, isAdverb: boolean): GradableForms {
  const w = base.toLowerCase();
  const irr = IRREGULAR_GRADABLE[w];
  if (irr) {
    return { comparative: applyCase(irr[0], base), superlative: applyCase(irr[1], base) };
  }
  if (isAdverb) {
    // 多数副词以 -ly 结尾 → more / most（quickly → more quickly / most quickly）
    if (w.endsWith("ly")) {
      return {
        comparative: applyCase("more " + w, base),
        superlative: applyCase("most " + w, base),
      };
    }
    // 少数 flat 副词（fast / hard / late / long / near）：用 -er / -est
    const [er, est] = erEst(w);
    return { comparative: applyCase(er, base), superlative: applyCase(est, base) };
  }
  // 形容词：多音节派生后缀 → more / most
  if (MORE_MOST_SUFFIXES.some((s) => w.endsWith(s) && w.length > s.length + 1)) {
    return {
      comparative: applyCase("more " + w, base),
      superlative: applyCase("most " + w, base),
    };
  }
  // 形容词以 -ly 结尾（friendly / lovely / lonely 等）：用 more / most
  if (w.endsWith("ly")) {
    return {
      comparative: applyCase("more " + w, base),
      superlative: applyCase("most " + w, base),
    };
  }
  const [er, est] = erEst(w);
  return { comparative: applyCase(er, base), superlative: applyCase(est, base) };
}

/**
 * 根据单词与其在卡片中出现的词性标签，返回应展示的变形。
 *
 * @param word    单词（通常为词库中的原形）
 * @param posTags 该词在词典中出现的词性标签数组，如 ["v.", "n."] / ["adj."] / ["adv."]
 *                支持 v. / vt. / vi. / adj. / adv.（末尾点可省略）
 */
export function getWordInflections(word: string, posTags: string[]): WordInflections {
  const result: WordInflections = {};
  if (!word || !posTags || posTags.length === 0) return result;

  const norm = posTags.map((p) => p.trim().replace(/\.$/, "").toLowerCase());
  const isVerb = norm.some((p) => p === "v" || p === "vt" || p === "vi");
  const isAdj = norm.some((p) => p === "adj");
  const isAdv = norm.some((p) => p === "adv");
  const isNoun = norm.some((p) => p === "n" || p === "nc" || p === "nu" || p === "cn" || p === "un");

  if (isVerb) result.verb = verbForms(word);
  if (isAdj) result.adjective = gradableForms(word, false);
  if (isAdv) result.adverb = gradableForms(word, true);
  if (isNoun) result.noun = { plural: pluralOf(word) };

  return result;
}
