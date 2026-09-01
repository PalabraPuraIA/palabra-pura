


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


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."match_bible_chunks"("query_embedding" "public"."halfvec", "match_count" integer DEFAULT 5) RETURNS TABLE("id" integer, "book_id" integer, "chapter" integer, "start_verse" bigint, "end_verse" integer, "chunk_text" "text", "parent_id" integer, "distance" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select c.id, c.book_id, c.chapter, c.start_verse, c.end_verse,
         c.chunk_text, c.parent_id,
         (c.embedding <=> query_embedding) as distance
  from public.bible_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_bible_chunks"("query_embedding" "public"."halfvec", "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_fragments"("query_embedding" "text", "match_count" integer DEFAULT 5) RETURNS TABLE("content" "text", "position" integer, "start_second" integer, "video_id" bigint, "title" "text", "episode" integer, "youtube_id" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  select
    f.content,
    f."position",
    f.start_second,
    v.id  as video_id,
    v.title,
    v.episode,
    v.youtube_id,
    1 - (f.embedding <=> query_embedding::halfvec(3072)) as similarity
  from fragment f
  join video v on v.id = f.video_id
  order by f.embedding <=> query_embedding::halfvec(3072)
  limit match_count;
$$;


ALTER FUNCTION "public"."match_fragments"("query_embedding" "text", "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    new.updated_at := now();
    return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

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


ALTER TABLE "public"."bible_chunks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."bible_chunks_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."bible_chunks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."bible_chunks_id_seq" OWNED BY "public"."bible_chunks"."id";



CREATE TABLE IF NOT EXISTS "public"."bible_parents" (
    "id" bigint NOT NULL,
    "book_id" integer NOT NULL,
    "chapter" integer NOT NULL,
    "start_verse" integer NOT NULL,
    "end_verse" integer NOT NULL,
    "parent_text" "text" NOT NULL
);


ALTER TABLE "public"."bible_parents" OWNER TO "postgres";


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


ALTER TABLE "public"."books" OWNER TO "postgres";


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


ALTER TABLE "public"."error_log" OWNER TO "postgres";


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


ALTER TABLE "public"."fragment" OWNER TO "postgres";


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


ALTER TABLE "public"."verses" OWNER TO "postgres";


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


ALTER TABLE "public"."video" OWNER TO "postgres";


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


CREATE POLICY "lectura publica books" ON "public"."books" FOR SELECT USING (true);



CREATE POLICY "public read fragments" ON "public"."fragment" FOR SELECT USING (true);



CREATE POLICY "public read videos" ON "public"."video" FOR SELECT USING (true);



ALTER TABLE "public"."verses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bible_chunks" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bible_chunks" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bible_chunks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bible_parents" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bible_parents" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bible_parents" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."books" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."books" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."books" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."error_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."error_log" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."error_log" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."error_log_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fragment" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fragment" TO "authenticated";
GRANT ALL ON TABLE "public"."fragment" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."fragment_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."verses" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."verses" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."verses" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."video" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."video" TO "authenticated";
GRANT ALL ON TABLE "public"."video" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."video_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";







