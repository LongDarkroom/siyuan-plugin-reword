/**
 * 高频词种子（word -> 频率排名，越小越常见）
 * ------------------------------------------------------------------
 * 内置约 100 个最常用英文词作为「零外部依赖」时的词频回退数据源，
 * 让 difficulty.ts 的 rarityFactor 维度在没接入 COCA/BNC 全量表时也有料。
 *
 * 排名仅为近似频率序（不必精确到个位），用于把词归一化到 0~1 稀有度；
 * 全量精度请改用 setFrequencyData() 注入完整词频表（rank 越小越常见）。
 *
 * 扩展方式：运行期调用 difficulty.setFrequencyData(new Map([["word", rank], ...]))，
 * 或在 ReviewConfig 中关闭 enableFrequencySeed 后注入自有词表。
 */
export const FREQUENCY_SEED: Record<string, number> = {
  the: 1, of: 2, and: 3, a: 4, to: 5, in: 6, is: 7, you: 8, that: 9, it: 10,
  he: 11, was: 12, for: 13, on: 14, are: 15, as: 16, with: 17, his: 18, they: 19, i: 20,
  at: 21, be: 22, this: 23, have: 24, from: 25, or: 26, one: 27, had: 28, by: 29, word: 30,
  but: 31, not: 32, what: 33, all: 34, were: 35, we: 36, when: 37, your: 38, can: 39, said: 40,
  there: 41, use: 42, an: 43, each: 44, which: 45, she: 46, do: 47, how: 48, their: 49, if: 50,
  will: 51, up: 52, other: 53, about: 54, out: 55, many: 56, then: 57, them: 58, these: 59, so: 60,
  some: 61, her: 62, would: 63, make: 64, like: 65, him: 66, into: 67, time: 68, has: 69, look: 70,
  two: 71, more: 72, write: 73, go: 74, see: 75, number: 76, no: 77, way: 78, could: 79, people: 80,
  my: 81, than: 82, first: 83, water: 84, been: 85, call: 86, who: 87, oil: 88, its: 89, now: 90,
  find: 91, long: 92, down: 93, day: 94, did: 95, get: 96, come: 97, made: 98, may: 99, part: 100,
};
