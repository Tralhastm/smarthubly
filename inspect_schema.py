import os
import requests
import json

# Carregar do .env se possível
anon_key = ""
with open(".env", "r") as f:
    for line in f:
        if "VITE_SUPABASE_PUBLISHABLE_KEY" in line:
            anon_key = line.split("=")[1].strip().strip('"').strip("'")
            break

headers = {
    'apikey': anon_key,
    'Authorization': f'Bearer {anon_key}',
    'Content-Type': 'application/json'
}

tables = ['supplier_product_prices', 'order_fragments', 'suppliers', 'products']
for table in tables:
    print(f'\n--- Table: {table} ---')
    try:
        # Tentar OPTIONS para ver métodos permitidos
        res = requests.options(f'https://qbcplbcdxoyqpmcehnvu.supabase.co/rest/v1/{table}', headers=headers)
        
        # Tentar pegar uma linha para ver as colunas
        res = requests.get(f'https://qbcplbcdxoyqpmcehnvu.supabase.co/rest/v1/{table}?limit=1', headers=headers)
        if res.status_code == 200:
            data = res.json()
            if data:
                print(f"Columns: {list(data[0].keys())}")
            else:
                print("Table exists but is empty.")
        elif res.status_code == 404:
            print("Table does not exist.")
        else:
            print(f"Error: {res.status_code} - {res.text}")
    except Exception as e:
        print(f"Failed to inspect {table}: {e}")
