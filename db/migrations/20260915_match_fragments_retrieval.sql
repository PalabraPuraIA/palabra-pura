-- Mejora match_fragments para recuperación semántica:
-- - Devuelve id y word_count (necesario para expandir vecinos).
-- - Excluye embeddings nulos o en cero.
-- - Permite filtrar por similitud mínima (default 0 = sin filtro duro en SQL).

DROP FUNCTION IF EXISTS public.match_fragments(text, integer);
DROP FUNCTION IF EXISTS public.match_fragments(text, integer, double precision);

CREATE OR REPLACE FUNCTION public.match_fragments(
  query_embedding text,
  match_count integer DEFAULT 5,
  min_similarity double precision DEFAULT 0
)
RETURNS TABLE(
  id bigint,
  content text,
  "position" integer,
  start_second integer,
  word_count integer,
  video_id bigint,
  title text,
  episode integer,
  youtube_id text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT *
    FROM (
      SELECT
        f.id,
        f.content,
        f."position",
        f.start_second,
        f.word_count,
        v.id AS video_id,
        v.title,
        v.episode,
        v.youtube_id,
        1 - (f.embedding <=> query_embedding::halfvec(3072)) AS similarity
      FROM fragment f
      JOIN video v ON v.id = f.video_id
      WHERE f.embedding IS NOT NULL
        AND l2_norm(f.embedding) > 0
      ORDER BY f.embedding <=> query_embedding::halfvec(3072)
      LIMIT GREATEST(match_count * 4, match_count)
    ) ranked
   WHERE ranked.similarity >= min_similarity
   ORDER BY ranked.similarity DESC
   LIMIT match_count;
$$;
