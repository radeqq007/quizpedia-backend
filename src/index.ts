export interface Env {
	GROQ_API_KEY: string;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

		const { articleContent, articleTitle } = await request.json<{
      articleContent: string;
      articleTitle: string;
    }>();

		if (!articleContent || !articleTitle) {
      return new Response(
        JSON.stringify({ error: "Missing articleContent or articleTitle" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

		const prompt = `You are a quiz generator. Given a Wikipedia article, return ONLY valid JSON with no markdown, no explanation.

The JSON must follow this exact shape:
{
  "summary": "A 2-3 sentence plain English summary of the article.",
  "questions": [
    {
      "question": "Question text?",
      "options": ["A", "B", "C", "D"],
      "answer": "A"
    }
  ]
}

Rules:
- Exactly 10 questions
- Each question has exactly 4 options
- "answer" must be the exact text of the correct option (not A/B/C/D index)
- No markdown fences, no extra keys

Article title: ${articleTitle}
Article content (truncated to ~6000 chars):
${articleContent.slice(0, 6000)}
    `;

		const groqRes = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
      }),
    });

		if (!groqRes.ok) {
      const err = await groqRes.text();
      return new Response(JSON.stringify({ error: err }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const groqData = await groqRes.json<any>();
    const cleaned = groqData.choices[0].message.content.trim();

		let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ error: "Model returned invalid JSON", cleaned }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
	}
}