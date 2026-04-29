import { env } from '$env/dynamic/private';

type Message = {
	role: 'system' | 'user';
	content: string;
};

type OpenRouterResponse = {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
	error?: {
		message?: string;
	};
};

export async function askOpenRouter(messages: Message[], options: { json?: boolean } = {}) {
	if (!env.OPENROUTER_API_KEY) {
		throw new Error('OPENROUTER_API_KEY is not set');
	}

	const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': env.PUBLIC_APP_URL ?? 'http://localhost:5173',
			'X-Title': 'Database Magic'
		},
		body: JSON.stringify({
			model: 'openai/gpt-5.5',
			messages,
			temperature: 0.1,
			...(options.json ? { response_format: { type: 'json_object' } } : {})
		})
	});

	const body = (await response.json()) as OpenRouterResponse;

	if (!response.ok) {
		throw new Error(body.error?.message ?? 'OpenRouter request failed');
	}

	const content = body.choices?.[0]?.message?.content?.trim();
	if (!content) throw new Error('OpenRouter returned an empty response');

	return content;
}
