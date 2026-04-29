import { env } from '$env/dynamic/private';

export type OpenRouterToolCall = {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
};

export type OpenRouterMessage = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string | null;
	tool_call_id?: string;
	tool_calls?: OpenRouterToolCall[];
};

export type OpenRouterTool = {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
};

type OpenRouterResponse = {
	choices?: Array<{
		message?: {
			role?: 'assistant';
			content?: string | null;
			tool_calls?: OpenRouterToolCall[];
		};
	}>;
	error?: {
		message?: string;
	};
};

type OpenRouterOptions = {
	json?: boolean;
	tools?: OpenRouterTool[];
	toolChoice?: 'auto' | 'none';
};

export async function createOpenRouterChatCompletion(
	messages: OpenRouterMessage[],
	options: OpenRouterOptions = {}
) {
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
			...(options.json ? { response_format: { type: 'json_object' } } : {}),
			...(options.tools ? { tools: options.tools, tool_choice: options.toolChoice ?? 'auto' } : {})
		})
	});

	const body = (await response.json()) as OpenRouterResponse;

	if (!response.ok) {
		throw new Error(body.error?.message ?? 'OpenRouter request failed');
	}

	const message = body.choices?.[0]?.message;
	if (!message) throw new Error('OpenRouter returned an empty response');

	return message;
}

export async function askOpenRouter(
	messages: OpenRouterMessage[],
	options: Pick<OpenRouterOptions, 'json'> = {}
) {
	const message = await createOpenRouterChatCompletion(messages, options);
	const content = message.content?.trim();
	if (!content) throw new Error('OpenRouter returned an empty response');

	return content;
}
