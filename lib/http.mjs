import { RequestError } from "./tariff.mjs";

// ponytail: best-effort limits per warm function instance. Not a global spending cap.
const requests = new Map();
const WINDOW = 15 * 60 * 1000;
export function allowRequest(key, now = Date.now()) {
  for (const [id, value] of requests) if (now - value.start >= WINDOW) requests.delete(id);
  const entry = requests.get(key) || { start: now, count: 0 };
  if (entry.count >= 12) return false;
  entry.count++;
  requests.set(key, entry);
  return true;
}

export function prepare(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(405, { error: "Use POST." });
    return null;
  }
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
    send(403, { error: "Open Moteur Check in your browser to check a bill." });
    return null;
  }
  const ip = req.headers["x-vercel-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  return { send, ip };
}

// Counts received bytes; never trusts Content-Length alone.
export async function readBody(req, maxBytes, tooLarge) {
  if (Number(req.headers["content-length"]) > maxBytes) throw new RequestError(tooLarge, 413);
  if (req.body !== undefined) {
    const body = Buffer.isBuffer(req.body) ? req.body : typeof req.body === "string" ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body));
    if (body.length > maxBytes) throw new RequestError(tooLarge, 413);
    return body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw new RequestError(tooLarge, 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function fail(send, error, fallback) {
  // Never log bills, images, keys or upstream bodies.
  return send(error instanceof RequestError ? error.status : 502, { error: error instanceof RequestError ? error.message : fallback });
}

export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-2.5-flash")}:generateContent`;

export async function gemini(body, timeoutMs) {
  if (!process.env.GEMINI_API_KEY) throw new RequestError("Moteur Check is not configured yet (missing API key).", 503);
  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Safe to log: no user data, only the network failure class.
    console.error("gemini fetch failed:", error?.name, error?.cause?.code || error?.message);
    throw new RequestError(error?.name === "TimeoutError" ? "The AI took too long to answer. Please try again." : "Could not reach the AI service. Please try again.", 504);
  }
  if (response.status === 429) throw new RequestError("The AI quota is busy right now. Please try again in a minute.", 429);
  if (!response.ok) throw new RequestError("The AI service returned an error. Please try again.", 502);
  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || "").join("") || "";
  return { text, candidate, finishReason: candidate?.finishReason };
}
