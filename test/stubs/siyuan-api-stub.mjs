/**
 * siyuan/api 测试桩（2026-08-23）
 * ------------------------------------------------------------------
 * test 环境无 fetch / window / siyuan 真实运行时，src/siyuan/api.ts 会
 * 触发 fetchPost 等调用导致抛错。提供一个最小空实现桩，让 reader-fonts.ts
 * 等模块可被测试 import 而不爆炸。本桩不应被生产路径调用。
 */
export const getFileBlob = async () => null;
export const putFile = async () => false;
export const removeFile = async () => undefined;
export const forwardProxyRaw = async () => ({ body: "" });
export const forwardProxy = forwardProxyRaw;
export const forwardProxyFetch = async () => new Response("");
export const getFile = async () => null;
export const readFile = async () => "";
export const getDocBlocks = async () => [];
export const getBlockKramdown = async () => "";
export const getBlockDOM = async () => "";
export const pushErrMsg = () => {};
export const getBlockBreadcrumb = async () => [];
export const getBlockIndex = async () => ({ paths: [] });
export const listDocsByPath = async () => ({ files: [] });
export const getSubDocs = async () => [];
export const createDocWithMd = async () => ({ id: "" });
export const prependBlock = async () => ({});
export const appendBlock = async () => ({});
export const updateBlock = async () => ({});
export const deleteBlock = async () => ({});
export const insertBlock = async () => ({});
export const moveBlock = async () => ({});
export const getAllEditor = async () => [];
export const getActiveBlockId = () => "";
export const getCurrentDocId = () => "";
export const transaction = async () => ({});
export const renderMarkdown = async () => "";
export const exportMdContent = async () => "";
export const getLocalStorage = async () => "";
export const setLocalStorage = async () => undefined;
export const removeLocalStorage = async () => undefined;
export const getSiYuanVersion = async () => "test-stub";
export const getWorkspace = async () => "/tmp/test-workspace";
export const getBlockAttrs = async () => ({});
export const setBlockAttrs = async () => ({});
export const getFileTree = async () => [];
export const getRecentDocs = async () => [];
export const getNotebook = async () => ({});
export const getDoc = async () => ({});
export const searchDocs = async () => [];
export const fullTextSearchBlock = async () => ({ blocks: [] });
export const fullTextSearchDoc = async () => [];
