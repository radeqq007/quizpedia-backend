export interface Env {
	GROQ_API_KEY: string;
	RATE_LIMITER: RateLimit;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const callGroq = async (env: Env, prompt: string): Promise<string> => {
	const res = await fetch(GROQ_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.GROQ_API_KEY}`,
		},
		body: JSON.stringify({
			model: MODEL,
			meessages: [{ role: "user", content: prompt }],
			temperature: 0.5,
		})
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(err);
	}

	const data = await res.json<any>();
	return data.choices[0].message.content.trim();
}

const jsonResponse = (body: unknown, status = 200): Response => {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...corsHeaders },
	});
}


export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		const ip = request.headers.get("cf-connecting-ip") ?? "unkown";
		const { success } = await env.RATE_LIMITER.limit({ key: ip });
		if (!success) {
			return jsonResponse({ error: "Rate limit exceeded. Try again later."}, 429);
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
			return jsonResponse({ error: "Missing articleContent or articleTitle" }, 400);
		}

		const prompt = `You are a quiz generator. Given a Wikipedia article, return ONLY valid JSON with no markdown, no explanation.
The language of the summary and questions must match the language of the article.
The answers should be short and concise, not longer than 4 words.

The JSON must follow this exact shape:
{
  "summary": "A 2-3 sentence plain summary of the article.",
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

Article title: ${articleTitle}
Article content (truncated to ~5500 chars):
${articleContent.slice(0, 5500)}
`;

		let parsed: unknown;
		try {
			const raw = await callGroq(env, prompt);
			parsed = JSON.parse(raw);
		} catch (err: any) {
			return jsonResponse({ error: "Model returned invalid JSON", detail: err.message }, 502);
		}

		return jsonResponse(parsed);
	},
};
