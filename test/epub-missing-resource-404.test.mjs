/**
 * 验证 EPUB 缺失资源不会把原始 href 写回 CSS 导致 404。
 * 根因：kk.eno1 等混淆字体扩展名不被 foliate-js 识别，loadHref 返回原始 href，
 * iframe 请求相对路径产生 404。修复后应返回空字符串。
 */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.com/',
})
globalThis.document = dom.window.document
globalThis.window = dom.window
globalThis.Event = dom.window.Event
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.EventTarget = dom.window.EventTarget
globalThis.DOMParser = dom.window.DOMParser
globalThis.XMLSerializer = dom.window.XMLSerializer
globalThis.URL = dom.window.URL
globalThis.ProcessingInstruction = dom.window.ProcessingInstruction

let blobUrlIndex = 0
URL.createObjectURL = () => `blob:mock-${++blobUrlIndex}`
URL.revokeObjectURL = () => {}

const module = await import('../src/reader/vendor/foliate-js/epub.js')
const { EPUB } = module

const files = {
  'META-INF/container.xml': `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  'OEBPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test</dc:title>
    <dc:identifier id="bookid">test</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
  'OEBPS/chapter.xhtml': `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <style>
    @font-face { font-family: kk; src: url('../fonts/kk.eno1'); }
    body { font-family: kk; }
  </style>
</head>
<body><p>hello</p></body>
</html>`,
}

const loader = {
  loadText: async (name) => files[name] ?? null,
  loadBlob: async () => null,
  getSize: () => 0,
  entries: [],
}

const epub = await new EPUB(loader).init()
assert.ok(epub.sections.length > 0, '应解析出章节')

const section = epub.sections[0]
const url = await section.load()
assert.ok(url, '应成功生成 blob URL')

const content = await section.loadContent()
assert.ok(content, '应能读取替换后的 XHTML 内容')
assert.doesNotMatch(content, /kk\.eno1/, '缺失的 kk.eno1 不应保留原始 href，避免请求相对路径 404')
assert.match(content, /url\("blob:mock-\d+"\)/, '应替换为 blob URL（缺失时为空内容，但不触发网络 404）')

console.log('epub-missing-resource-404: 4/4 ✅')
