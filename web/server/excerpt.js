/**
 * Selección de evidencia literal. El modelo elige números de oraciones;
 * el servidor extrae texto original y nunca acepta una cita reescrita.
 */

const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function transcriptSentences(content) {
  const raw = normalize(content);
  if (!raw) return [];
  const parts = raw
    .split(/(?<=[.!?…])\s+(?=[¿¡A-ZÁÉÍÓÚÜÑ0-9"'])/)
    .map(normalize)
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

export function formatFragmentsForModel(fragments, maxCharsPerFragment = 2400) {
  return fragments
    .map((fragment, fragmentIndex) => {
      const sentences = transcriptSentences(fragment.content);
      let used = 0;
      const numbered = [];
      for (let i = 0; i < sentences.length; i += 1) {
        const line = `[F${fragmentIndex + 1} S${i + 1}] ${sentences[i]}`;
        if (used + line.length > maxCharsPerFragment && numbered.length) break;
        numbered.push(line);
        used += line.length;
      }
      return [
        `Fragmento F${fragmentIndex + 1} — video "${fragment.title}", episodio ${fragment.episode ?? "?"}, minuto ${fragment.start_second ?? 0}:`,
        ...numbered,
      ].join("\n");
    })
    .join("\n\n");
}

const normalizedTerms = (question) =>
  [...new Set(
    String(question ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4),
  )];

function deterministicSelection(fragments, question) {
  const terms = normalizedTerms(question);
  let best = null;

  fragments.forEach((fragment, fragmentIndex) => {
    const sentences = transcriptSentences(fragment.content);
    sentences.forEach((sentence, sentenceIndex) => {
      const text = sentence.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const hits = terms.reduce((sum, term) => sum + (text.includes(term.slice(0, 7)) ? 1 : 0), 0);
      if (!best || hits > best.hits) best = { fragmentIndex, sentenceIndex, hits };
    });
  });

  if (!best) return null;
  const sentences = transcriptSentences(fragments[best.fragmentIndex]?.content);
  const wanted = best.hits >= 3 ? 5 : best.hits >= 2 ? 3 : 2;
  const start = Math.max(0, best.sentenceIndex - 1);
  const end = Math.min(sentences.length - 1, start + wanted - 1);
  return {
    fragment: best.fragmentIndex + 1,
    start_sentence: start + 1,
    end_sentence: end + 1,
    strategy: "term-density",
  };
}

export function selectLiteralExcerpt(fragments, question, evidence) {
  if (!Array.isArray(fragments) || !fragments.length) return {};

  const fallback = deterministicSelection(fragments, question);
  const requested = evidence && typeof evidence === "object"
    ? {
        fragment: Number(evidence.fragment),
        start_sentence: Number(evidence.start_sentence),
        end_sentence: Number(evidence.end_sentence),
        strategy: "llm-sentence-range",
      }
    : null;

  let selection = requested;
  const selectedFragment = fragments[(selection?.fragment || 0) - 1];
  const selectedSentences = transcriptSentences(selectedFragment?.content);
  const invalid =
    !selectedFragment ||
    !Number.isInteger(selection?.start_sentence) ||
    !Number.isInteger(selection?.end_sentence) ||
    selection.start_sentence < 1 ||
    selection.end_sentence < selection.start_sentence ||
    selection.end_sentence > selectedSentences.length ||
    selection.end_sentence - selection.start_sentence > 8;

  if (invalid) selection = fallback;
  if (!selection) return {};

  const fragment = fragments[selection.fragment - 1];
  const sentences = transcriptSentences(fragment?.content);
  const start = selection.start_sentence - 1;
  const end = Math.min(selection.end_sentence, start + 9);
  let excerpt = normalize(sentences.slice(start, end).join(" "));

  // Límite de visualización/almacenamiento, cortando solo al final de oración.
  if (excerpt.length > 1800) {
    const cut = excerpt.slice(0, 1800);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    excerpt = `${(stop > 700 ? cut.slice(0, stop + 1) : cut).trim()}…`;
  }

  if (!excerpt) return {};
  const original = normalize(fragment.content);
  const check = excerpt.replace(/…$/, "");
  if (!original.includes(check)) return {};

  return {
    excerpt,
    fragment,
    retrieval: {
      fragment_id: fragment.id ?? null,
      position: fragment.position ?? null,
      score: fragment.score ?? null,
      sentence_start: selection.start_sentence,
      sentence_end: selection.end_sentence,
      strategy: selection.strategy,
    },
  };
}
