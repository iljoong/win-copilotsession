/** Synthetic fixtures shared by the browser and desktop end-to-end suites. */
export const prompt =
  '\r\n  caf\u00e9 e\u0301 \ud83d\ude00\r\n' +
  'Long original prompt. '.repeat(100) +
  'findneedle';

export const exported = {
  responderUsername: 'GitHub Copilot',
  initialLocation: 'panel',
  requests: [
    {
      requestId: 'request-a',
      message: { text: prompt, parts: [] },
      timestamp: Date.UTC(2026, 10, 12),
      modelId: 'gpt-6.1-sol',
      copilotCredits: 0,
      response: [
        { value: '<img src=x onerror=alert(1)>' + '\ud83d\ude00'.repeat(1200) },
      ],
    },
    {
      requestId: 'request-b',
      message: 'Second prompt',
      modelId: 'claude-sonnet-5',
      response: [{ value: 'Second answer' }],
    },
    {
      requestId: 'request-c',
      message: 'Third prompt',
      modelId: 'gemini-4',
      response: [{ value: 'Third answer' }],
    },
  ],
};

export function span(id: string) {
  return (
    JSON.stringify({
      name: 'execute_tool demo',
      _spanContext: { spanId: id },
      startTime: Date.now() - 10,
      endTime: Date.now(),
      attributes: {
        'gen_ai.conversation.id': 'live-session',
        'gen_ai.operation.name': 'execute_tool',
      },
    }) + '\n'
  );
}
