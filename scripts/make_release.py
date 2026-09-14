#!/usr/bin/env python3
"""打包思源插件为社区集市 package.zip（GitHub Release 附件）

集市规范：
  - zip 解压后必须【直接】是插件根文件，不能有外层父目录。
  - 必需：plugin.json, index.js, index.css, icon.png, preview.png, README.md, i18n/（多语言时）。
  - 体积建议 < 10MB：词典(dict/，约 64MB) 与废弃 sql.js 资源不随包，运行时按需下载。
    当前实际约 4-5MB：主包 index.js 之外，cmaps/(1.6M) + standard_fonts/(800K)
    为 PDF CJK 渲染必需，虽占 2.4M 但不可省（见下方 INCLUDE_DIRS 注释）。

用法：先 `npm run build`，再 `python scripts/make_release.py`（或 `npm run make`）。
产物：仓库根目录 package.zip
"""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 直接平铺到 zip 根的【白名单文件】
INCLUDE_FILES = [
    "plugin.json",
    "index.js",
    "index.css",
    "icon.png",
    "preview.png",
    "README.md",
    # [2026-08-29 修复] PDF 支持：PDF.js 的 worker 由 copy-dist.mjs 复制到插件根目录，
    # 运行时按 /plugins/siyuan-plugin-reword/pdf.worker.mjs 加载
    # （见 src/reader/bookshelf-store.ts:146-149）。漏掉它 → 从集市安装的插件
    # 在非弱设备（桌面）上解析 PDF 元数据/封面时 worker 加载失败。
    "pdf.worker.mjs",
    "appreciate.jpg",  # 集市 README 赞赏码图片（jsdelivr 源，也随包分发以支持本地渲染）
]
# 直接平铺到 zip 根的【白名单目录】
INCLUDE_DIRS = [
    "i18n",
    # [2026-09-04 修复] PDF CJK 渲染：pdf.js 的 CMap 与标准字体资源。
    # 运行时按 `${origin}/plugins/siyuan-plugin-reword/cmaps/` 与
    # `/standard_fonts/` 加载（见 src/reader/vendor/foliate-js/pdf.js:516-522），
    # 即插件根目录下的同名目录。copy-dist.mjs 会把它们复制到根目录，
    # 但此前 INCLUDE_DIRS 只列了 i18n —— 导致从集市安装的正式版缺这两个目录，
    # 中文 PDF 的 CJK 字形取不到 CMap 而显示为方块（本地开发版因为根目录有
    # copy-dist 的产物，反而正常，故该缺陷长期未被发现）。
    "cmaps",
    "standard_fonts",
]

# 一律排除（非发布物 / 体积过大 / 废弃）
EXCLUDE = {
    "src",
    "node_modules",
    "test",
    "scripts",
    "logs",
    "docs",
    "qa-reports",
    "dist",
    ".workbuddy",
    ".git",
    "dict",          # 64MB 离线词典：运行时下载，不随包
    "public",
    ".DS_Store",
    "package-lock.json",
    "svelte.config.mjs",
    "tsconfig.json",
    "vite.config.mts",
    "review.svg",
    "sql-wasm.wasm",   # 废弃：当前代码用 js-mdict 直读 MDX，未引用 sql.js
    "sql.js-umd.js",   # 废弃
    "package.zip",
}


def is_backup(name: str) -> bool:
    """本地历史快照（*.bak*），一律不进发布包。

    [2026-09-14 修复] i18n 是整目录白名单，而本地长期攒下了 24 个
    `i18n/??_??.json.bak-*` 快照（约 3.4MB 未压缩）。它们既不是发布物、
    也没被 git 跟踪，却被打进了集市包，把 package.zip 从 ~0.9MB 撑到 4.1MB。
    这类快照随时可能再攒出来，所以用规则排除而不是逐个加进 EXCLUDE。
    """
    return ".bak" in name


def collect_paths():
    paths = []  # (abs_path, arcname)
    for fn in INCLUDE_FILES:
        fp = os.path.join(ROOT, fn)
        if os.path.isfile(fp):
            paths.append((fp, fn))
        else:
            print(f"[warn] 缺少发布文件: {fn}")
    for dn in INCLUDE_DIRS:
        dp = os.path.join(ROOT, dn)
        if not os.path.isdir(dp):
            print(f"[warn] 缺少发布目录: {dn}")
            continue
        for cur, dirs, files in os.walk(dp):
            dirs[:] = [d for d in dirs if d not in EXCLUDE]
            for f in files:
                if f in EXCLUDE or is_backup(f):
                    continue
                fp = os.path.join(cur, f)
                arc = os.path.relpath(fp, ROOT)
                paths.append((fp, arc))
    return paths


def main():
    paths = collect_paths()
    if not paths:
        print("没有可打包的文件，请先 npm run build")
        return

    zip_name = "package.zip"
    zip_path = os.path.join(ROOT, zip_name)
    if os.path.exists(zip_path):
        os.remove(zip_path)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp, arc in paths:
            zf.write(fp, arc)

    size_kb = os.path.getsize(zip_path) / 1024
    names = sorted(arc for _, arc in paths)
    print(f"打包完成: {zip_name} ({size_kb:.1f} KB)")
    print(f"包含 {len(names)} 个条目：")
    for n in names:
        print(f"  - {n}")


if __name__ == "__main__":
    main()
