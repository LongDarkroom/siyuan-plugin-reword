/**
 * 词典查询 Worker (子进程)
 *
 * 用法: node dict-worker.cjs <mdx_path> <word>
 * 输出: JSON { word, definition } 或 null
 */
const { dictionary } = require('mdict');

const mdxPath = process.argv[2];
const word = process.argv[3];

if (!mdxPath || !word) {
  process.exit(1);
}

(async () => {
  try {
    const md = await dictionary(mdxPath);
    const def = await md.lookup(word);

    // def 可能是字符串或数组（多义词）
    let definition = '';
    if (Array.isArray(def)) {
      // 多个释义，合并为一个 HTML
      definition = def.filter(d => typeof d === 'string' && d.trim()).join('<hr/>');
    } else if (typeof def === 'string' && def.trim()) {
      definition = def;
    }

    if (definition) {
      process.send({ word, definition });
    } else {
      process.send(null);
    }

    setTimeout(() => process.exit(0), 100);
  } catch (e) {
    process.send(null);
    setTimeout(() => process.exit(1), 100);
  }
})();
