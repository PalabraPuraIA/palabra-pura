import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const GEMINI_KEYS = [
  Deno.env.get("GEMINI_API_KEY"),
  Deno.env.get("GEMINI_API_KEY_2"),
  Deno.env.get("GEMINI_API_KEY_3"),
  ...(String(Deno.env.get("GEMINI_API_KEYS") || "").split(",")),
].map((k) => String(k || "").trim()).filter(Boolean);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FACT_CATEGORIES = new Set([
  "horario",
  "persona",
  "terminologia",
  "lugar",
  "contacto",
  "redes",
  "evento",
  "general",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function parseAliases(raw: unknown) {
  const list = Array.isArray(raw)
    ? raw.map((a) => String(a || "").trim())
    : String(raw || "").split(/[,;\n]/).map((a) => a.trim());
  return [...new Set(list.filter((a) => a.length >= 2))].slice(0, 24);
}

function youtubeId(raw: string) {
  const text = String(raw || "").trim();
  const m = text.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|^[a-zA-Z0-9_-]{11}$)([a-zA-Z0-9_-]{11})/,
  );
  if (m?.[1]) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
  } catch {
    /* ignore */
  }
  return "";
}

function chunkText(text: string, target = 350) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += target) {
    const part = words.slice(i, i + target).join(" ").trim();
    if (part.length >= 20) chunks.push(part);
  }
  return chunks.slice(0, 80);
}

async function embedDocument(text: string) {
  if (!GEMINI_KEYS.length) throw new Error("Falta GEMINI_API_KEY para indexar el texto");
  let last = "unknown";
  for (const key of GEMINI_KEYS) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8000) }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 3072,
        }),
      },
    );
    if (!res.ok) {
      last = await res.text();
      continue;
    }
    const data = await res.json();
    const values = data?.embedding?.values;
    if (!values || values.length !== 3072) {
      last = `dims ${values?.length ?? 0}`;
      continue;
    }
    return `[${values.join(",")}]`;
  }
  throw new Error("Gemini embedding: " + last.slice(0, 220));
}

async function youtubeTitle(id: string, fallback = "") {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
    );
    if (!res.ok) return fallback || id;
    const data = await res.json();
    return String(data.title || fallback || id).slice(0, 240);
  } catch {
    return fallback || id;
  }
}

async function listAll() {
  const [facts, documents, videos, offers, jobs] = await Promise.all([
    supabase.from("ministry_fact").select("id,category,title,content,aliases,status,created_at,updated_at").order("updated_at", { ascending: false }).limit(400),
    supabase.from("knowledge_document").select("id,title,category,source_name,status,chunk_count,content,created_at,updated_at").order("updated_at", { ascending: false }).limit(200),
    supabase.from("video").select("id,youtube_id,title,episode,updated_at,created_at").order("episode", { ascending: false }).limit(400),
    supabase.from("content_offer").select("youtube_id,access_mode,offer_url,offer_label,title"),
    supabase.from("ingest_job").select("id,source_type,source_url,title,youtube_id,status,progress,error,fragments_created,created_at,updated_at").order("created_at", { ascending: false }).limit(80),
  ]);

  const offerMap = new Map((offers.data || []).map((o) => [o.youtube_id, o]));
  const videoRows = videos.data || [];
  const counts = await supabase.rpc("video_fragment_counts");
  const fragCounts = new Map(
    (counts.data || []).map((row: { video_id: number; fragments: number }) => [Number(row.video_id), row.fragments]),
  );

  const catalog = videoRows.map((v) => {
    const offer = offerMap.get(v.youtube_id);
    return {
      ...v,
      fragments: fragCounts.get(Number(v.id)) ?? 0,
      access_mode: offer?.access_mode || "free",
      offer_url: offer?.offer_url || "",
      offer_label: offer?.offer_label || "",
    };
  });

  return {
    ok: true,
    facts: facts.data || [],
    documents: (documents.data || []).map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      source_name: d.source_name,
      status: d.status,
      chunks: d.chunk_count || 0,
      preview: String(d.content || "").slice(0, 180),
      created_at: d.created_at,
      updated_at: d.updated_at,
    })),
    videos: catalog,
    jobs: jobs.data || [],
    stats: {
      facts: (facts.data || []).filter((f) => f.status === "active").length,
      documents: (documents.data || []).filter((d) => d.status === "active").length,
      videos: catalog.length,
      paid: catalog.filter((v) => v.access_mode === "paid").length,
      queued: (jobs.data || []).filter((j) => j.status === "queued" || j.status === "running").length,
    },
    errors: [facts.error, documents.error, videos.error, offers.error, jobs.error]
      .filter(Boolean)
      .map((e) => e?.message),
  };
}

async function saveFact(body: Record<string, unknown>) {
  const category = String(body.category || "general").trim().toLowerCase();
  const title = String(body.title || "").trim();
  const content = String(body.content || "").trim();
  const aliases = parseAliases(body.aliases);
  const status = body.status === "archived" ? "archived" : "active";
  if (!FACT_CATEGORIES.has(category)) return json({ ok: false, error: "categoría inválida" }, 400);
  if (title.length < 2 || content.length < 2) return json({ ok: false, error: "título y contenido requeridos" }, 400);

  let embedding: string | null = null;
  try {
    embedding = await embedDocument(`${title}. ${content}. ${aliases.join(", ")}`);
  } catch (err) {
    console.warn("fact embed", err);
  }

  const id = Number(body.id || 0);
  const row = { category, title, content, aliases, status, embedding };
  const q = id
    ? await supabase.from("ministry_fact").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()
    : await supabase.from("ministry_fact").insert(row).select("*").single();
  if (q.error) return json({ ok: false, error: q.error.message }, 500);
  return json({ ok: true, fact: q.data });
}

async function saveDocument(body: Record<string, unknown>) {
  const title = String(body.title || "").trim();
  const content = String(body.content || "").trim();
  const category = String(body.category || "general").trim().slice(0, 40);
  const sourceName = String(body.source_name || "").trim().slice(0, 160) || null;
  if (title.length < 2 || content.length < 20) {
    return json({ ok: false, error: "título y texto (mínimo 20 caracteres) requeridos" }, 400);
  }
  const chunks = chunkText(content);
  if (!chunks.length) return json({ ok: false, error: "el texto es demasiado corto para indexar" }, 400);

  const inserted = await supabase
    .from("knowledge_document")
    .insert({ title, content, category, source_name: sourceName, chunk_count: chunks.length })
    .select("*")
    .single();
  if (inserted.error) return json({ ok: false, error: inserted.error.message }, 500);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedDocument(`${title}. ${chunks[i]}`);
    const chunk = await supabase.from("knowledge_doc_chunk").insert({
      document_id: inserted.data.id,
      chunk_pos: i,
      content: chunks[i],
      embedding,
    });
    if (chunk.error) return json({ ok: false, error: chunk.error.message }, 500);
  }
  return json({ ok: true, document: inserted.data, chunks: chunks.length });
}

async function queueVideo(body: Record<string, unknown>) {
  const id = youtubeId(String(body.url || body.youtube_id || ""));
  if (!id) return json({ ok: false, error: "link de YouTube inválido" }, 400);
  const title = String(body.title || "").trim() || await youtubeTitle(id);
  const upsert = await supabase
    .from("video")
    .upsert({ youtube_id: id, title, updated_at: new Date().toISOString() }, { onConflict: "youtube_id" })
    .select("id,youtube_id,title")
    .single();
  if (upsert.error) return json({ ok: false, error: upsert.error.message }, 500);

  const job = await supabase
    .from("ingest_job")
    .insert({
      source_type: "youtube",
      source_url: `https://www.youtube.com/watch?v=${id}`,
      title,
      youtube_id: id,
      video_id: upsert.data.id,
      status: "queued",
      progress: "En cola para transcribir. El script del servidor lo tomará después.",
    })
    .select("*")
    .single();
  if (job.error) return json({ ok: false, error: job.error.message }, 500);
  return json({ ok: true, video: upsert.data, job: job.data });
}

async function setVideoAccess(body: Record<string, unknown>) {
  const id = youtubeId(String(body.youtube_id || body.url || ""));
  if (!id) return json({ ok: false, error: "youtube_id requerido" }, 400);
  const access = body.access_mode === "paid" ? "paid" : "free";
  const offer_url = String(body.offer_url || "").trim().slice(0, 400) || null;
  const offer_label = String(body.offer_label || "").trim().slice(0, 80) || (access === "paid" ? "Comprar esta enseñanza" : null);
  const title = String(body.title || "").trim() || null;
  const videoId = Number(body.video_id || 0) || null;
  const row = {
    youtube_id: id,
    video_id: videoId,
    title,
    access_mode: access,
    offer_url,
    offer_label,
    updated_at: new Date().toISOString(),
  };
  const saved = await supabase.from("content_offer").upsert(row, { onConflict: "youtube_id" }).select("*").single();
  if (saved.error) return json({ ok: false, error: saved.error.message }, 500);
  return json({ ok: true, offer: saved.data });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") return json(await listAll());
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || body.op || "").trim();
    if (action === "list" || !action) return json(await listAll());
    if (action === "saveFact") return await saveFact(body);
    if (action === "deleteFact") {
      const id = Number(body.id);
      const { error } = await supabase.from("ministry_fact").delete().eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === "archiveFact") {
      const id = Number(body.id);
      const status = body.status === "archived" ? "archived" : "active";
      const { error } = await supabase.from("ministry_fact").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === "saveDocument") return await saveDocument(body);
    if (action === "deleteDocument") {
      const id = Number(body.id);
      const { error } = await supabase.from("knowledge_document").delete().eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === "queueVideo") return await queueVideo(body);
    if (action === "setVideoAccess") return await setVideoAccess(body);
    return json({ ok: false, error: "acción desconocida" }, 400);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
