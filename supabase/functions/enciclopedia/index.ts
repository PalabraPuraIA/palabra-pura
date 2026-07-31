import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Stable entry + JSON status for Enciclopedia de Palabra Pura.
 *
 * Prefer the Storage HTML pages (real HTML, no Edge sandbox):
 *  - /storage/v1/object/public/enciclopedia/index.html
 *  - /storage/v1/object/public/enciclopedia/dashboard.html
 *
 * This function:
 *  - ?format=json → current tunnel base (used by those pages)
 *  - otherwise → 302 to the matching Storage page
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const STORAGE_CHAT = "https://erickcherry.github.io/palabra-pura-stack/";
const STORAGE_DASH = "https://erickcherry.github.io/palabra-pura-stack/dashboard.html";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "public_base_url")
      .maybeSingle();
    if (error) throw new Error(error.message);

    const base = String(data?.value || "").trim().replace(/\/+$/, "");
    const incoming = new URL(req.url);
    const parts = incoming.pathname.split("/").filter(Boolean);
    const restParts = parts[0] === "enciclopedia" ? parts.slice(1) : parts;
    let rest = restParts.join("/");
    if (rest === "dashboard") rest = "dashboard/";
    const isDashboard = rest.startsWith("dashboard");

    if (incoming.searchParams.get("format") === "json") {
      return json({
        ok: Boolean(base),
        baseUrl: base ? `${base}/` : null,
        chatUrl: base ? `${base}/` : null,
        dashboardUrl: base ? `${base}/dashboard/` : null,
        stableChatUrl: STORAGE_CHAT,
        stableDashboardUrl: STORAGE_DASH,
        mode: "storage-iframe",
      });
    }

    const location = isDashboard ? STORAGE_DASH : STORAGE_CHAT;
    return new Response(null, {
      status: 302,
      headers: {
        ...cors,
        Location: location,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
