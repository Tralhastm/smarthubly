type SofiaMessage = { role?: string; content?: unknown };

/**
 * Respostas anteriores da IA não são fonte de verdade e podem conter erros.
 * Mantemos apenas perguntas do usuário para preservar contexto sem reciclar
 * instruções inventadas ou respostas antigas.
 */
export function getSofiaTrustedMessages(messages: SofiaMessage[], fallbackQuestion: string): Array<{ role: "user"; content: string }> {
  const userMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user")
    .map((message) => String(message.content || "").trim())
    .filter(Boolean)
    // Só a pergunta anterior pode ser necessária para resolver “tem certeza?”;
    // perguntas mais antigas fazem o modelo responder novamente assuntos encerrados.
    .slice(-2)
    .map((content) => ({ role: "user" as const, content: content.slice(0, 4000) }));

  if (userMessages.length) return userMessages;
  return [{ role: "user", content: String(fallbackQuestion || "").slice(0, 4000) }];
}
