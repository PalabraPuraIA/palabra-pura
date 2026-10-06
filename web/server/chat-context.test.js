import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeFollowUp,
  retrievalQuestion,
  historyBlock,
  normalizeHistory,
} from "./chat-context.js";
import { findReferences } from "./chat-search.js";

test("parses spoken libro de Mateo en el capítulo", () => {
  const refs = findReferences(
    "vamos al libro de Mateo en el capítulo 6, en el versículo 33, dice buscar primeramente",
  );
  assert.deepEqual(refs, ["Mateo 6:33"]);
});

test("follow-up short questions use prior user turn for retrieval", () => {
  assert.equal(looksLikeFollowUp("y eso es pecado?"), true);
  const q = retrievalQuestion("y por qué?", [
    { role: "user", content: "la deuda financieramente es buena?" },
    { role: "assistant", content: "Es una carga..." },
  ]);
  assert.match(q, /deuda/);
  assert.match(q, /por qué/);
});

test("history block is short and labeled", () => {
  const block = historyBlock([
    { role: "user", content: "hola" },
    { role: "assistant", content: "hola" },
  ]);
  assert.match(block, /Usuario: hola/);
  assert.match(block, /Blaze: hola/);
  assert.deepEqual(normalizeHistory([{ role: "bot", content: "x" }]), [
    { role: "assistant", content: "x" },
  ]);
});
