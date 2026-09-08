import test from "node:test";
import assert from "node:assert/strict";
import { createPretranslateQueue } from "../src/reader/bilingual/runtime/pretranslate.ts";

function makeSeg(key, sectionIndex, node) {
  return {
    locatorKey: key,
    text: key,
    sectionIndex,
    indexInSection: 0,
    node,
    prev: "",
  };
}

function makeMockSegmenter(docsBySection) {
  return {
    segmentsOf(doc, sectionIndex) {
      const segs = doc?.__segs ?? [];
      return segs.map((s) => ({ ...s, sectionIndex }));
    },
    segmentsOfDocs(docs, firstSectionIndex = 0) {
      return docs.flatMap((d, i) => this.segmentsOf(d, firstSectionIndex + i));
    },
    invalidate() {},
  };
}

test("full 模式通过 getLiveSegment 把临时 Document 段映射到当前视图节点", async () => {
  const tempNode = { isConnected: false, name: "temp-doc-node" };
  const liveNode = { isConnected: true, name: "live-view-node" };

  const injectedNodes = [];
  const queue = createPretranslateQueue({
    bookId: "b1",
    segmenter: makeMockSegmenter(),
    visibility: {
      currentWindow: () => ({ fromSection: 0, toSection: 2, basis: "section" }),
      withinInjectGate: (idx) => idx <= 2,
    },
    injector: {
      injectBatch: async (batch) => {
        injectedNodes.push(...batch.segments.map((s) => s.node));
        return { injected: batch.segments.length, empty: 0, failed: 0 };
      },
      hasInjected: () => false,
      retryableKeys: () => [],
      isBlocked: () => false,
      stats: () => ({ injected: 0, failed: 0 }),
    },
    getContents: () => [],
    getSections: () => [
      {
        index: 0,
        createDocument: () => ({ __segs: [makeSeg("s1", 0, tempNode)] }),
      },
    ],
    getCurrentSection: () => 0,
    translate: async (texts) => texts.map(() => "译文"),
    getLiveSegment: (key, sectionIndex) => {
      if (key === "s1" && sectionIndex === 0) return makeSeg("s1", 0, liveNode);
      return undefined;
    },
  });

  await queue.start({
    bookId: "b1",
    mode: "full",
    lanes: 1,
    blocksPerLane: 5,
    aheadSections: 2,
  });

  assert.equal(injectedNodes.length, 1, "应注入 1 段");
  assert.equal(
    injectedNodes[0].name,
    "live-view-node",
    "必须注入 getLiveSegment 返回的当前视图节点，而不是 createDocument 临时节点",
  );
  assert.equal(queue.state().injected, 1);
  assert.equal(queue.state().failed, 0);
});

test("无 getLiveSegment 时 full 模式仍只缓存不崩溃", async () => {
  const tempNode = { isConnected: false, name: "temp-doc-node" };
  const injectedNodes = [];
  const queue = createPretranslateQueue({
    bookId: "b2",
    segmenter: makeMockSegmenter(),
    visibility: {
      currentWindow: () => ({ fromSection: 0, toSection: 2, basis: "section" }),
      withinInjectGate: (idx) => idx <= 2,
    },
    injector: {
      injectBatch: async (batch) => {
        injectedNodes.push(...batch.segments.map((s) => s.node));
        return { injected: batch.segments.length, empty: 0, failed: 0 };
      },
      hasInjected: () => false,
      retryableKeys: () => [],
      isBlocked: () => false,
      stats: () => ({ injected: 0, failed: 0 }),
    },
    getContents: () => [],
    getSections: () => [
      {
        index: 0,
        createDocument: () => ({ __segs: [makeSeg("s1", 0, tempNode)] }),
      },
    ],
    getCurrentSection: () => 0,
    translate: async (texts) => texts.map(() => "译文"),
    // 无 getLiveSegment
  });

  await queue.start({
    bookId: "b2",
    mode: "full",
    lanes: 1,
    blocksPerLane: 5,
    aheadSections: 2,
  });

  assert.equal(injectedNodes.length, 0, "无 live 映射时不应注入");
  assert.equal(queue.state().injected, 0);
  assert.equal(queue.state().cachedOnly, 1, "应计为仅缓存");
});
