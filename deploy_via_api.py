import os
import requests
import json
import base64

def deploy_function(slug, project_ref, token, entrypoint_path):
    print(f"Deploying {slug}...")
    url = f"https://api.supabase.com/v1/projects/{project_ref}/functions"
    
    # Primeiro verifica se a função existe
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Lê o conteúdo do arquivo
    with open(entrypoint_path, 'r') as f:
        content = f.read()
    
    # O Supabase Management API para deploy de funções via multipart/form-data
    # conforme documentação interna/histórico de sucesso
    
    # Vamos tentar o endpoint de deploy direto se existir ou criar/atualizar
    # O CLI usa um bundle. Aqui vamos tentar enviar o arquivo index.ts puro 
    # se as dependências forem URLs (Deno style).
    
    files = {
        'slug': (None, slug),
        'name': (None, slug),
        'verify_jwt': (None, 'false'),
        'import_map': (None, 'false'),
        'entrypoint_path': (None, 'index.ts'),
        'file': ('index.ts', content, 'text/plain')
    }
    
    # Tenta POST para criar ou PATCH para atualizar
    # Mas o endpoint documentado em alguns lugares é /functions/{slug}
    
    deploy_url = f"https://api.supabase.com/v1/projects/{project_ref}/functions/{slug}"
    
    # Tenta atualizar primeiro
    res = requests.patch(deploy_url, headers={"Authorization": f"Bearer {token}"}, files=files)
    
    if res.status_code == 404:
        # Se não existe, cria
        print(f"{slug} not found, creating...")
        create_url = f"https://api.supabase.com/v1/projects/{project_ref}/functions"
        res = requests.post(create_url, headers={"Authorization": f"Bearer {token}"}, files=files)
    
    print(f"Result for {slug}: {res.status_code}")
    try:
        print(res.json())
    except:
        print(res.text)

if __name__ == "__main__":
    TOKEN = "sbp_fbb1f4879b22f2fa59eb35cdd514b8251a3a18bc"
    REF = "qbcplbcdxoyqpmcehnvu"
    
    # Sofia Agent
    deploy_function("sofia-agent", REF, TOKEN, "supabase/functions/sofia-agent/index.ts")
    # Clara Agent
    deploy_function("clara-agent", REF, TOKEN, "supabase/functions/clara-agent/index.ts")
    # Cindy Agent
    deploy_function("cindy-agent", REF, TOKEN, "supabase/functions/cindy-agent/index.ts")
    # Store Agent
    deploy_function("store-agent", REF, TOKEN, "supabase/functions/store-agent/index.ts")
