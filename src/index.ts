export interface Env {
	GROQ_API_KEY: string;
	RATE_LIMITER: RateLimit;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		const ip = request.headers.get("cf-connecting-ip") ?? "unkown";
		const { success } = await env.RATE_LIMITER.limit({ key: ip });

		if (!success) {
			return new Response(
				JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
				{
					status: 429,
					headers: { "Content-Type": "application/json", ...corsHeaders },
				},
			);
		}

		if (request.method !== "POST") {
			return new Response("Method not allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}

		const { articleContent, articleTitle } = await request.json<{
			articleContent: string;
			articleTitle: string;
		}>();

		if (!articleContent || !articleTitle) {
			return new Response(
				JSON.stringify({ error: "Missing articleContent or articleTitle" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json", ...corsHeaders },
				},
			);
		}

		const prompt = `You are a quiz generator. Given a Wikipedia article, return ONLY valid JSON with no markdown, no explanation.
The language of the summary and questions MUST match the language of the article.
If the article is too short or has too little information to generate a quiz include "This topic might not generate a great quiz, try another one." in the summary.
The answers should be short and concise, not longer than 4 words.

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
- The language of the summary and questions matches the language of the article
- Short and concise answers

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
				model: "meta-llama/llama-4-scout-17b-16e-instruct",
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
				{
					status: 502,
					headers: { "Content-Type": "application/json", ...corsHeaders },
				},
			);
		}

		return new Response(JSON.stringify(parsed), {
			headers: { "Content-Type": "application/json", ...corsHeaders },
		});
	},
};
