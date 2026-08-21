# Log de Progresso - SmartHubly (21/08/2026)

## Ações Realizadas
1.  **IA Unificada Corrigida**:
    *   Identificada a falta do header `apikey` obrigatório pelo Supabase nas chamadas de IA do frontend.
    *   Atualizados os componentes `SofiaChat.tsx`, `StoreChatbot.tsx` e `CindyChat.tsx` para incluir `apikey: VITE_SUPABASE_PUBLISHABLE_KEY`.
    *   Corrigidos erros de sintaxe (try/catch duplicados) nas Edge Functions `ai-chat-unified`.
    *   Desabilitado `verify_jwt` no `config.toml` para a função unificada para permitir chamadas públicas (Sofia/Store) sem falhas de auth.
2.  **Infraestrutura & Deploy**:
    *   Realizado `npm run build` local para gerar assets atualizados.
    *   Código enviado para o GitHub (`main`) para disparar deploy automático.
    *   Tentativa de deploy manual via Cloudflare Pages Dashboard para garantir sincronização imediata.
3.  **Configurações Supabase**:
    *   Projeto ID: `qbcplbcdxoyqpmcehnvu`
    *   Função Unificada: `ai-chat-unified`

## Próximos Passos
1.  Confirmar a conclusão do deploy no Cloudflare Pages (verificar se o hash do `index.js` mudou).
2.  Testar Sofia na landing page (deve parar de dar "Failed to fetch").
3.  Testar Store Chat na loja Mobile Tec.
4.  Testar Cindy no Super Admin.
5.  Validar fragmentação de pedidos e dashboard de preços.
