const TARGET_WORDS = 300;
const PAGE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

export type CaptionSeg = { start: number; text: string };
export type TextChunk = { content: string; start_second: number; word_count: number };

export function episodeFromTitle(title: string): number | null {
  const numbered = String(title || "").match(/[-–]\s*0*(\d{1,4})\s*[-–]/);
  if (numbered) return Number(numbered[1]);
  const parte = String(title || "").match(/\(\s*PARTE\s*0*(\d{1,3})\s*\)/i);
  if (parte) return Number(parte[1]);
  return null;
}

function cookieHeader(res: Response) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

function extractJsonObject(source: string, from: number) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return "";
}

function parseJson3(raw: string): CaptionSeg[] {
  let data: { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }> };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  return (data.events || [])
    .map((event) => ({
      start: Number(event.tStartMs || 0) / 1000,
      text: (event.segs || [])
        .map((s) => s.utf8 || "")
        .join("")
        .replace(/\n/g, " ")
        .trim(),
    }))
    .filter((s) => s.text && !/^\[[^\]]+\]$/.test(s.text));
}

function pickSpanishTrack(
  tracks: Array<{ languageCode?: string; kind?: string; baseUrl?: string }>,
) {
  const scored = tracks
    .filter((t) => t.baseUrl)
    .map((t) => {
      const lang = String(t.languageCode || "").toLowerCase();
      let score = 0;
      if (lang === "es" || lang.startsWith("es-")) score += 5;
      if (t.kind === "asr") score += 1;
      if (lang === "en") score += 1;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.t || null;
}

async function fetchCaptionUrl(url: string, cookie: string) {
  const u = new URL(url);
  u.searchParams.set("fmt", "json3");
  const res = await fetch(u.toString(), {
    headers: {
      "User-Agent": PAGE_UA,
      Cookie: cookie,
      Referer: "https://www.youtube.com/",
      Origin: "https://www.youtube.com",
    },
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok || text.length < 40) return [];
  return parseJson3(text);
}

async function visionosPlayer(youtubeId: string, cookie: string, visitor: string) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": PAGE_UA,
      Cookie: cookie,
      "X-Goog-Visitor-Id": visitor,
      "X-YouTube-Client-Name": "101",
      "X-YouTube-Client-Version": "1.02",
      Origin: "https://www.youtube.com",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "VISIONOS",
          clientVersion: "1.02",
          deviceMake: "Apple",
          deviceModel: "RealityDevice17,1",
          osName: "visionOS",
          osVersion: "26.5.23O471",
          hl: "es",
          gl: "CO",
          visitorData: visitor,
        },
      },
      videoId: youtubeId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return null;
  return await res.json();
}

function tracksFromPlayer(data: Record<string, unknown> | null) {
  const captions = (data?.captions || {}) as {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{ languageCode?: string; kind?: string; baseUrl?: string }>;
    };
  };
  return captions.playerCaptionsTracklistRenderer?.captionTracks || [];
}

function smallestAudioUrl(data: Record<string, unknown> | null) {
  const streaming = (data?.streamingData || {}) as {
    adaptiveFormats?: Array<{ mimeType?: string; url?: string; contentLength?: string }>;
    formats?: Array<{ mimeType?: string; url?: string; contentLength?: string }>;
  };
  const formats = [...(streaming.adaptiveFormats || []), ...(streaming.formats || [])];
  const audio = formats
    .filter((f) => f.url && /audio\//i.test(String(f.mimeType || "")))
    .sort((a, b) => Number(a.contentLength || 1e15) - Number(b.contentLength || 1e15));
  const pick = audio[0];
  if (!pick?.url) return null;
  return { url: pick.url, bytes: Number(pick.contentLength || 0) };
}

async function hostedTranscript(youtubeId: string): Promise<{ title: string; segments: CaptionSeg[] } | null> {
  const res = await fetch("https://transcribeyoutube.com/api/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      lang: "es",
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json().catch(() => null);
  const rows = Array.isArray(data?.transcript) ? data.transcript : [];
  const segments = rows
    .map((row: { text?: string; start?: number }) => ({
      start: Number(row.start) || 0,
      text: String(row.text || "").replace(/\n/g, " ").trim(),
    }))
    .filter((s: CaptionSeg) => s.text && !/^\[[^\]]+\]$/.test(s.text));
  if (!segments.length) return null;
  return { title: String(data?.title || ""), segments };
}

export async function loadYoutubeTranscript(youtubeId: string): Promise<{
  title: string;
  segments: CaptionSeg[];
  source: "captions" | "whisper";
}> {
  try {
    const hosted = await hostedTranscript(youtubeId);
    if (hosted?.segments.length) return { ...hosted, source: "captions" };
  } catch {
    /* YouTube directo más abajo */
  }

  const page = await fetch(`https://www.youtube.com/watch?v=${youtubeId}&hl=es&bpctr=9999999999&has_verified=1`, {
    headers: {
      "User-Agent": PAGE_UA,
      "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(25000),
  });
  const html = await page.text();
  const cookie = cookieHeader(page);
  const visitor =
    html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1] ||
    html.match(/"visitorData":"([^"]+)"/)?.[1] ||
    "";

  let title = "";
  const pageIdx = html.indexOf("ytInitialPlayerResponse");
  if (pageIdx >= 0) {
    try {
      const parsed = JSON.parse(extractJsonObject(html, html.indexOf("{", pageIdx)));
      title = String(parsed?.videoDetails?.title || "");
      const track = pickSpanishTrack(tracksFromPlayer(parsed));
      if (track?.baseUrl) {
        const segments = await fetchCaptionUrl(track.baseUrl, cookie);
        if (segments.length) return { title, segments, source: "captions" };
      }
    } catch {
      /* player JSON from the page is often unsigned; visionos is the reliable path */
    }
  }

  const player = await visionosPlayer(youtubeId, cookie, visitor);
  title = title || String(player?.videoDetails?.title || "");
  const track = pickSpanishTrack(tracksFromPlayer(player));
  if (track?.baseUrl) {
    const segments = await fetchCaptionUrl(track.baseUrl, cookie);
    if (segments.length) return { title, segments, source: "captions" };
  }

  const viaInvidious = await invidiousCaptions(youtubeId);
  if (viaInvidious.length) return { title, segments: viaInvidious, source: "captions" };

  const groq = String(Deno.env.get("GROQ_API_KEY") || "").trim();
  const audio = smallestAudioUrl(player);
  if (groq && audio && audio.bytes > 0 && audio.bytes < 24 * 1024 * 1024) {
    const segments = await transcribeGroq(audio.url, groq);
    if (segments.length) return { title, segments, source: "whisper" };
  }

  throw new Error(
    "No pude leer subtítulos de ese video. Si YouTube no tiene subtítulos automáticos, súbelo cuando el servidor pueda transcribir el audio.",
  );
}

async function invidiousCaptions(youtubeId: string): Promise<CaptionSeg[]> {
  const hosts = ["https://inv.nadeko.net", "https://yewtu.be", "https://invidious.nerdvpn.de"];
  for (const host of hosts) {
    try {
      const listRes = await fetch(`${host}/api/v1/captions/${youtubeId}`, {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json" },
      });
      if (!listRes.ok) continue;
      const list = await listRes.json();
      const captions = Array.isArray(list) ? list : list?.captions || [];
      const pick =
        captions.find((c: { language_code?: string; label?: string }) => /^es/i.test(String(c.language_code || c.label || ""))) ||
        captions[0];
      const lang = pick?.language_code || "es";
      const capRes = await fetch(`${host}/api/v1/captions/${youtubeId}?lang=${encodeURIComponent(lang)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!capRes.ok) continue;
      const body = await capRes.text();
      const segments = parseVttLike(body);
      if (segments.length) return segments;
    } catch {
      /* next host */
    }
  }
  return [];
}

function parseVttLike(raw: string): CaptionSeg[] {
  const jsonTry = parseJson3(raw);
  if (jsonTry.length) return jsonTry;
  const lines = String(raw).replace(/\r/g, "").split("\n");
  const out: CaptionSeg[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->/);
    if (!m) continue;
    const parts = m[1].replace(",", ".").split(":");
    const start = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
    const textParts: string[] = [];
    i += 1;
    while (i < lines.length && lines[i].trim()) {
      textParts.push(lines[i].replace(/<[^>]+>/g, ""));
      i += 1;
    }
    const text = textParts.join(" ").replace(/\s+/g, " ").trim();
    if (text && !/^\[[^\]]+\]$/.test(text)) out.push({ start, text });
  }
  return out;
}

async function transcribeGroq(audioUrl: string, key: string): Promise<CaptionSeg[]> {
  const audio = await fetch(audioUrl, {
    headers: { "User-Agent": PAGE_UA, Referer: "https://www.youtube.com/" },
    signal: AbortSignal.timeout(60000),
  });
  if (!audio.ok) throw new Error(`No pude bajar el audio (${audio.status})`);
  const buf = new Uint8Array(await audio.arrayBuffer());
  if (buf.byteLength > 24 * 1024 * 1024) {
    throw new Error("El audio es demasiado grande para transcribirlo aquí");
  }
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/mp4" }), "audio.m4a");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "es");
  form.append("response_format", "verbose_json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 220)}`);
  const data = await res.json();
  const segments = (data.segments || [])
    .map((s: { start?: number; text?: string }) => ({
      start: Number(s.start) || 0,
      text: String(s.text || "").trim(),
    }))
    .filter((s: CaptionSeg) => s.text);
  if (!segments.length && data.text) segments.push({ start: 0, text: String(data.text).trim() });
  return segments;
}

export function chunkSegments(segments: CaptionSeg[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  let buf: string[] = [];
  let words = 0;
  let start = 0;
  const flush = () => {
    if (!buf.length) return;
    const content = buf.join(" ").replace(/\s+/g, " ").trim();
    if (!content) return;
    chunks.push({
      content,
      start_second: Math.max(0, Math.floor(start)),
      word_count: content.split(/\s+/).filter(Boolean).length,
    });
    buf = [];
    words = 0;
  };
  for (const seg of segments) {
    const n = seg.text.split(/\s+/).filter(Boolean).length;
    if (!buf.length) start = seg.start;
    if (words && words + n > TARGET_WORDS) flush();
    if (!buf.length) start = seg.start;
    buf.push(seg.text);
    words += n;
  }
  flush();
  return chunks;
}
