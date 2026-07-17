// Vercel serverless function (Node runtime by default).
// This exists for one reason: the Anthropic API cannot be called directly
// from a browser with a real API key. Doing so would either be blocked
// (Anthropic's API does not serve CORS to arbitrary origins) or, if it did
// work, would expose your ANTHROPIC_API_KEY to anyone who opens devtools —
// literally your billing credential, public. This endpoint is the fix:
// the browser calls THIS route, this route (running on Vercel's servers,
// key never sent to the browser) calls Anthropic, and forwards the result.
//
// Requires an ANTHROPIC_API_KEY environment variable set in the Vercel
// project (Project Settings -> Environment Variables). Get a key from
// https://console.anthropic.com/settings/keys — this is a separate,
// pay-as-you-go API key, NOT your claude.ai login. See README for cost notes.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { instructions, rawText } = req.body || {};
  if (!instructions || !rawText) {
    res.status(400).json({ error: "Missing instructions or rawText in request body" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not configured on the server. Set it in Vercel Project Settings -> Environment Variables and redeploy.",
    });
    return;
  }

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          { role: "user", content: `${instructions}\n\nRaw schedule text:\n${rawText}` },
        ],
      }),
    });

    const data = await anthropicResponse.json();
    res.status(anthropicResponse.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
}
