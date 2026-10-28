/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/integrations/supabase/client';

type SofiaMessage = { role: 'user' | 'assistant' | 'system'; content: string };
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function requestSofiaReply(messages: SofiaMessage[], options: { tenantId?: string; context?: string; role?: string; surface?: string; orderId?: string; chatId?: string; sessionToken?: string } = {}) {
  const response = await fetch(`${SUPA_URL}/functions/v1/ai-chat-unified/sofia-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE, Authorization: `Bearer ${PUBLISHABLE}`, 'x-client-info': 'smarthubly-sofia-context' },
    body: JSON.stringify({ messages, role: options.role || 'merchant', tenantId: options.tenantId, context: options.context || '', surface: options.surface || 'sofia_chat', orderId: options.orderId, chatId: options.chatId, sessionToken: options.sessionToken }),
  });
  if (!response.ok || !response.body) throw new Error('Sofia indisponível');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') { done = true; break; }
      try { answer += JSON.parse(payload).choices?.[0]?.delta?.content || ''; } catch { /* chunk incompleto */ }
    }
  }
  return answer.trim();
}

export async function logSofiaEvent(input: { tenantId?: string; surface: string; subject: string; question?: string; answer?: string; reason?: string; metadata?: Record<string, unknown> }) {
  await (supabase as any).rpc('log_sofia_learning_event', {
    _tenant_id: input.tenantId || null,
    _surface: input.surface,
    _event_type: 'conversation_context',
    _subject: input.subject,
    _reason: input.reason || 'Contexto usado para responder uma conversa em tempo real.',
    _source_ref: 'ai-chat-unified/sofia-agent',
    _question: input.question || null,
    _answer_summary: input.answer || null,
    _metadata: input.metadata || {},
  });
}
