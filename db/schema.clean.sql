


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";




COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."match_fragments"(
  "query_embedding" "text",
  "match_count" integer DEFAULT 5,
  "min_similarity" double precision DEFAULT 0
) RETURNS TABLE(
  "id" bigint,
  "content" "text",
  "position" integer,
  "start_second" integer,
  "word_count" integer,
  "video_id" bigint,
  "title" "text",
  "episode" integer,
  "youtube_id" "text",
  "similarity" double precision
)
    LANGUAGE "sql" STABLE
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






CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    new.updated_at := now();
    return new;
end;
$$;



SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bible_chunks" (
    "id" integer NOT NULL,
    "book_id" integer NOT NULL,
    "chapter" integer NOT NULL,
    "start_verse" bigint NOT NULL,
    "end_verse" bigint NOT NULL,
    "chunk_text" "text" NOT NULL,
    "embedding" "public"."halfvec"(3072),
    "parent_id" bigint
);




CREATE SEQUENCE IF NOT EXISTS "public"."bible_chunks_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;




ALTER SEQUENCE "public"."bible_chunks_id_seq" OWNED BY "public"."bible_chunks"."id";



CREATE TABLE IF NOT EXISTS "public"."bible_parents" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "chapter" integer NOT NULL,
    "start_verse" integer NOT NULL,
    "end_verse" integer NOT NULL,
    "parent_text" "text" NOT NULL
);




ALTER TABLE "public"."bible_parents" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."bible_parents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."books" (
    "id" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "modern_name" character varying(100) NOT NULL,
    "new_testament" smallint NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."error_log" (
    "id" bigint NOT NULL,
    "source" "text" NOT NULL,
    "step" "text",
    "severity" "text" DEFAULT 'error'::"text",
    "reference_id" "text",
    "context" "jsonb",
    "error_message" "text",
    "error_detail" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);




ALTER TABLE "public"."error_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."error_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."fragment" (
    "id" bigint NOT NULL,
    "video_id" bigint NOT NULL,
    "position" integer NOT NULL,
    "content" "text" NOT NULL,
    "embedding" "public"."halfvec"(3072) NOT NULL,
    "start_second" integer,
    "word_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




ALTER TABLE "public"."fragment" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."fragment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."verses" (
    "book_id" integer NOT NULL,
    "chapter" integer NOT NULL,
    "verse" integer NOT NULL,
    "text" "text" NOT NULL,
    "id" bigint NOT NULL
);




ALTER TABLE "public"."verses" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."verses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."video" (
    "id" bigint NOT NULL,
    "youtube_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "episode" integer,
    "duration_seconds" integer,
    "published_at" timestamp with time zone,
    "url" "text" GENERATED ALWAYS AS (('https://www.youtube.com/watch?v='::"text" || "youtube_id")) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




ALTER TABLE "public"."video" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."video_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."bible_chunks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bible_chunks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."bible_chunks"
    ADD CONSTRAINT "bible_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bible_parents"
    ADD CONSTRAINT "bible_parents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."error_log"
    ADD CONSTRAINT "error_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fragment"
    ADD CONSTRAINT "fragment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fragment"
    ADD CONSTRAINT "fragment_video_id_position_key" UNIQUE ("video_id", "position");



ALTER TABLE ONLY "public"."verses"
    ADD CONSTRAINT "verses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verses"
    ADD CONSTRAINT "verses_unique_ref" UNIQUE ("book_id", "chapter", "verse");



ALTER TABLE ONLY "public"."video"
    ADD CONSTRAINT "video_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video"
    ADD CONSTRAINT "video_youtube_id_key" UNIQUE ("youtube_id");



CREATE INDEX "bible_chunks_embedding_idx" ON "public"."bible_chunks" USING "hnsw" ("embedding" "public"."halfvec_cosine_ops");



CREATE INDEX "idx_error_log_source" ON "public"."error_log" USING "btree" ("source", "created_at" DESC);



CREATE INDEX "idx_fragment_embedding" ON "public"."fragment" USING "hnsw" ("embedding" "public"."halfvec_cosine_ops");



CREATE INDEX "idx_fragment_video_id" ON "public"."fragment" USING "btree" ("video_id");



CREATE OR REPLACE TRIGGER "trg_video_updated_at" BEFORE UPDATE ON "public"."video" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."bible_chunks"
    ADD CONSTRAINT "bible_chunks_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bible_chunks"
    ADD CONSTRAINT "bible_chunks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."bible_parents"("id");



ALTER TABLE ONLY "public"."bible_parents"
    ADD CONSTRAINT "bible_parents_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id");



ALTER TABLE ONLY "public"."fragment"
    ADD CONSTRAINT "fragment_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verses"
    ADD CONSTRAINT "verses_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id");



ALTER TABLE "public"."bible_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bible_parents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."books" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."error_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fragment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public read fragments" ON "public"."fragment" FOR SELECT USING (true);



CREATE POLICY "public read videos" ON "public"."video" FOR SELECT USING (true);



ALTER TABLE "public"."verses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video" ENABLE ROW LEVEL SECURITY;























































-- Added 2026-07-29 from Supabase sync (additive)
CREATE OR REPLACE FUNCTION public.match_bible_chunks(
  query_embedding public.halfvec,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id integer,
  book_id integer,
  chapter integer,
  start_verse bigint,
  end_verse integer,
  chunk_text text,
  parent_id integer,
  distance double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  select c.id, c.book_id, c.chapter, c.start_verse, c.end_verse,
         c.chunk_text, c.parent_id,
         (c.embedding <=> query_embedding) as distance
  from public.bible_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
