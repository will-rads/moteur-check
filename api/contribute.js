// Forwards a user's checked bill to the Moteur Index public price index.
//
// This exists as a serverless function rather than a fetch from the browser for one
// reason: the partner key. Anything in the frontend bundle is public, and a leaked key
// lets anyone inject reports into the index's moderation queue under Moteur Check's
// name. The key stays here and never reaches the client.
//
// Nothing is stored. The bill passes through this function to moteurindex.com and is
// gone — the same promise the rest of the app makes.

import { allowRequest, fail, prepare, readBody } from "../lib/http.mjs";
import { RequestError } from "../lib/tariff.mjs";
import { buildReport, ContributeError, MOTEUR_INDEX_URL } from "../lib/contribute.mjs";

export default async function contribute(req, res) {
  const ctx = prepare(req, res);
  if (!ctx) return;
  const { send, ip } = ctx;
  try {
    if (!process.env.MOTEUR_INDEX_KEY) {
      throw new RequestError("Contributing is not configured on this deployment.", 503);
    }
    if (!(req.headers["content-type"] || "").startsWith("application/json")) {
      throw new RequestError("Send JSON.", 415);
    }

    const raw = await readBody(req, 8000, "Request too large.");
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new RequestError("The request could not be read.");
    }

    // The user's explicit choice, made in the UI. Checked here as well as there, because
    // a contribution nobody agreed to is the one failure this feature must not have.
    if (body?.consent !== true) {
      throw new RequestError("Tick the box to share these figures.", 400);
    }

    if (!allowRequest(`contribute:${ip}`)) {
      res.setHeader("Retry-After", "900");
      throw new RequestError("That's a lot of contributions. Please try again in 15 minutes.", 429);
    }

    let report;
    try {
      report = buildReport(body);
    } catch (error) {
      if (error instanceof ContributeError) throw new RequestError(error.message, error.status);
      throw error;
    }

    let response;
    let data;
    try {
      response = await fetch(MOTEUR_INDEX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Partner-Name": process.env.MOTEUR_INDEX_PARTNER || "moteur-check",
          "X-Partner-Key": process.env.MOTEUR_INDEX_KEY,
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify(report),
      });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      // Safe to log: the failure class only, never the bill or the key.
      console.error("moteur index fetch failed:", error?.name, error?.cause?.code || error?.message);
      throw new RequestError("Could not reach Moteur Index. Your check is unaffected — please try sharing again later.", 504);
    }

    if (response.status === 401) {
      console.error("moteur index rejected the partner key");
      throw new RequestError("Contributing is not configured correctly on this deployment.", 503);
    }
    if (response.status === 429) {
      throw new RequestError("Moteur Index is busy right now. Please try again later.", 429);
    }
    if (!response.ok) {
      // Field errors are the useful case: almost always a district the index could not
      // place. Surfaced rather than swallowed so the user can fix it.
      const detail = data?.errors ? Object.values(data.errors).join(" ") : data?.detail || data?.error;
      throw new RequestError(detail ? `Moteur Index could not accept this: ${detail}` : "Moteur Index could not accept this bill.", 400);
    }

    // 202 from the index: queued for a human, not published. Say exactly that — telling
    // someone their bill is "on the map" when a moderator has not seen it would be a
    // promise neither app can keep.
    return send(200, {
      status: "queued",
      reconciled: data?.reconciled ?? null,
      reconcileDepth: data?.reconcile_depth ?? null,
    });
  } catch (error) {
    return fail(send, error, "Sharing with Moteur Index failed. Your bill was not saved. Please try again.");
  }
}
