/**
 * MDX to SQLite 转换脚本 (子进程版)
 *
 * 使用子进程池执行 lookup，每个子进程处理一个词条后退出
 * 彻底解决文件句柄泄漏问题
 */
const { fork } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');

const OUTPUT_PATH = '/Users/xieyue/Downloads/思源笔记/data/plugins/siyuan-plugin-hiword/dict/ncecd.sqlite';
const WORKER_SCRIPT = path.join(__dirname, 'dict-worker.cjs');

async function convert() {
  console.log('[DictConverter] 开始转换 (子进程模式)...');
  const startTime = Date.now();

  // 第一步：在主进程中收集所有 key
  const { dictionary } = require('mdict');
  const MDX_PATH = '/Users/xieyue/Downloads/新世纪英汉大词典_atauzki_191008改版[全量提取词组版]/新世纪英汉大词典[全量提取词组版]A.mdx';

  console.log('[DictConverter] 收集词条索引...');
  const md = await dictionary(MDX_PATH);
  const allKeys = new Set();
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';

  for (const letter of alphabet) {
    try {
      const results = await md.search(letter, 10);
      if (results) {
        for (const r of results) {
          allKeys.add(typeof r === 'string' ? r : r.key || String(r));
        }
      }
    } catch (e) {}
    process.stdout.write(`\r已收集 ${allKeys.size} 个词条`);
  }

  const keyArray = Array.from(allKeys);
  console.log(`\n共 ${keyArray.length} 个唯一词条`);

  // 关闭主进程中的 md 实例，释放句柄
  // (mdict 没有显式 close 方法，置 null 让 GC 回收)

  // 第二步：创建数据库
  const db = new Database(OUTPUT_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL COLLATE NOCASE,
      definition TEXT NOT NULL,
      word_lower TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_word_lower ON entries(word_lower);
  `);

  const insert = db.prepare('INSERT INTO entries (word, definition, word_lower) VALUES (?, ?, ?)');
  let total = 0;
  let failCount = 0;

  // 第三步：使用子进程逐个查询
  console.log(`[DictConverter] 使用子进程查询释义 (${keyArray.length} 条)...`);

  const CONCURRENCY = 3; // 同时运行的子进程数

  async function processBatch(startIdx, endIdx) {
    const batch = keyArray.slice(startIdx, endIdx);

    // 分批处理，每批 CONCURRENCY 个
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);

      const promises = chunk.map(key => {
        return new Promise((resolve) => {
          const worker = fork(WORKER_SCRIPT, [MDX_PATH, key], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
          });

          let timeoutId;

          const cleanup = () => {
            clearTimeout(timeoutId);
            try { worker.kill(); } catch (e) {}
          };

          timeoutId = setTimeout(() => {
            cleanup();
            resolve(null); // 超时返回 null
          }, 10000); // 10 秒超时

          worker.on('message', (msg) => {
            cleanup();
            resolve(msg); // { word, definition } 或 null
          });

          worker.on('error', (err) => {
            cleanup();
            console.warn(`Worker error for ${key}:`, err.message);
            resolve(null);
          });

          worker.on('exit', (code) => {
            cleanup();
            if (code !== 0 && !worker.exitedAfterDisconnect) {
              resolve(null);
            }
          });
        });
      });

      const results = await Promise.all(promises);

      for (const result of results) {
        if (result && result.definition) {
          insert.run(result.word, result.definition, result.word.toLowerCase());
          total++;
        } else if (result === null) {
          failCount++;
        }
      }

      const processed = Math.min(i + CONCURRENCY, batch.length) + startIdx;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r进度: ${processed}/${keyArray.length} (${total} 条写入, ${failCount} 失败) [${elapsed}s]`);
    }
  }

  // 分大批处理（每批 100 条）
  const BATCH_SIZE = 100;
  for (let i = 0; i < keyArray.length; i += BATCH_SIZE) {
    await processBatch(i, Math.min(i + BATCH_SIZE, keyArray.length));
  }

  console.log(`\n\n=== 转换完成 ===`);
  console.log(`耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`成功: ${total} 条 | 失败: ${failCount}`);

  const count = db.prepare('SELECT COUNT(*) as cnt FROM entries').get();
  console.log(`数据库: ${count.cnt} 条`);

  const test = db.prepare("SELECT word FROM entries WHERE word_lower = 'hello' LIMIT 1").get();
  console.log(`hello 测试: ${test ? '✓ ' + test.word : '✗'}`);

  db.close();
}

convert().catch(console.error);
