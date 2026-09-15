import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
Deno.serve(async (req)=>{
  try {
    const body = await req.json();
    const { video_id, position, content, start_second, word_count } = body;
    // Validación de campos obligatorios
    if (video_id == null || position == null || !content) {
      return new Response(JSON.stringify({
        error: "Faltan campos: video_id, position o content"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // 1. Generar el embedding con Gemini (3072 dims)
    const geminiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: {
          parts: [
            {
              text: content
            }
          ]
        },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 3072
      })
    });
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error("Error de Gemini: " + errText);
    }
    const geminiData = await geminiRes.json();
    const embedding = geminiData.embedding?.values;
    if (!embedding || embedding.length !== 3072) {
      throw new Error("Embedding inválido, dimensiones: " + (embedding?.length ?? "null"));
    }
    // 2. Insertar la row completa (con el vector ya incluido)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.from("fragment").insert({
      video_id,
      position,
      content,
      start_second: start_second ?? null,
      word_count: word_count ?? null,
      embedding: JSON.stringify(embedding)
    }).select("id").single();
    if (error) throw new Error("Error al insertar: " + error.message);
    return new Response(JSON.stringify({
      success: true,
      fragment_id: data.id
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: String(e)
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});