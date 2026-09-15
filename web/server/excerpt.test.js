import test from "node:test";
import assert from "node:assert/strict";

import {
  formatFragmentsForModel,
  selectLiteralExcerpt,
  transcriptSentences,
} from "./excerpt.js";

const fragments = [
  {
    id: 10,
    position: 4,
    score: 0.8,
    title: "La oración",
    content:
      "Primero hablamos de otro asunto. La oración es una conversación sincera con Dios. Podemos acercarnos con confianza porque estamos en Cristo. No depende de palabras complicadas. Después cambia el tema.",
  },
];

test("numbers only original transcript sentences", () => {
  const formatted = formatFragmentsForModel(fragments);
  assert.match(formatted, /\[F1 S2\] La oración/);
  assert.equal(transcriptSentences(fragments[0].content).length, 5);
});

test("extracts the exact LLM-selected sentence range", () => {
  const result = selectLiteralExcerpt(fragments, "¿Cómo puedo orar?", {
    fragment: 1,
    start_sentence: 2,
    end_sentence: 4,
  });
  assert.equal(
    result.excerpt,
    "La oración es una conversación sincera con Dios. Podemos acercarnos con confianza porque estamos en Cristo. No depende de palabras complicadas.",
  );
  assert.ok(fragments[0].content.includes(result.excerpt));
  assert.equal(result.retrieval.strategy, "llm-sentence-range");
});

test("falls back to a literal term-density window for invalid evidence", () => {
  const result = selectLiteralExcerpt(fragments, "confianza al orar", {
    fragment: 99,
    start_sentence: 0,
    end_sentence: 90,
  });
  assert.ok(result.excerpt);
  assert.ok(fragments[0].content.includes(result.excerpt.replace(/…$/, "")));
  assert.equal(result.retrieval.strategy, "term-density");
});
