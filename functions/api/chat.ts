export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  
  // URL real do Supabase
  const SUPABASE_URL = "https://qbcplbcdxoyqpmcehnvu.supabase.co/functions/v1/ai-chat-unified";
  
  // Pegar a rota do header ou query
  const url = new URL(request.url);
  let route = request.headers.get("x-route") || url.searchParams.get("route") || "/sofia-agent";
  
  // Se for uma ação da Cindy, ajustar o endpoint
  if (url.pathname.includes('/reply-ticket')) route = '/cindy-actions/reply-ticket';
  if (url.pathname.includes('/gen-post')) route = '/cindy-actions/gen-post';

  // Criar nova requisição para o Supabase
  const newRequest = new Request(SUPABASE_URL + route, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "follow",
  });

  try {
    const response = await fetch(newRequest);
    
    // Retornar a resposta com headers de CORS para o frontend local
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Access-Control-Allow-Origin", "*");
    newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    newResponse.headers.set("Access-Control-Allow-Headers", "*");
    
    return newResponse;
  } catch (error) {
    return new Response(JSON.stringify({ error: "Proxy Error", details: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
