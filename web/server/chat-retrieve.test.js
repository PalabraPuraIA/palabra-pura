import test from "node:test";
import assert from "node:assert/strict";

import {
  filterBySimilarity,
  mergeHybridCandidates,
  adjacentRadiusFor,
  MIN_SIMILARITY,
} from "./chat-retrieve.js";

test("filters below similarity threshold", () => {
  const rows = [
    { id: 1, similarity: 0.72, content: "a" },
    { id: 2, similarity: 0.61, content: "b" },
    { id: 3, similarity: 0.68, content: "c" },
  ];
  const filtered = filterBySimilarity(rows, 0.65);
  assert.deepEqual(filtered.map((r) => r.id), [1, 3]);
});

test("falls back to top hits when nothing passes threshold", () => {
  const rows = [
    { id: 1, similarity: 0.6 },
    { id: 2, similarity: 0.55 },
    { id: 3, similarity: 0.5 },
    { id: 4, similarity: 0.4 },
  ];
  const filtered = filterBySimilarity(rows, MIN_SIMILARITY, 3);
  assert.deepEqual(filtered.map((r) => r.id), [1, 2, 3]);
});

test("boosts fragments that appear in both vector and FTS", () => {
  const vector = [
    { id: 10, video_id: 1, position: 2, similarity: 0.7 },
    { id: 11, video_id: 1, position: 5, similarity: 0.69 },
  ];
  const fts = [
    { id: 10, video_id: 1, position: 2, hits: 3 },
    { id: 99, video_id: 2, position: 1, hits: 4 },
  ];
  const merged = mergeHybridCandidates(vector, fts, 3);
  assert.equal(merged[0].id, 10);
  assert.equal(merged[0].hybrid, true);
  assert.ok(merged[0].rankScore > 0.7);
});

test("uses wider adjacent radius for short fragments", () => {
  assert.equal(adjacentRadiusFor({ word_count: 80, content: "Hola mundo." }), 2);
  assert.equal(adjacentRadiusFor({ word_count: 300, content: "Hola mundo." }), 1);
  assert.equal(adjacentRadiusFor({ word_count: 200, content: "porque eso es pecado." }), 2);
});
