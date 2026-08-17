// Aba "Fiscal" — configurações de emissão de NFC-e.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Receipt, Info, ExternalLink } from "lucide-react";
import { useFiscalSettings, useUpsertFiscalSettings, type FiscalSettings, type FiscalProvider, type FiscalEnvironment } from "@/hooks/useFiscal";
import TenantFiscalContingencia from "./TenantFiscalContingencia";

export default function TenantAdminFiscal({ tenantId }: { tenantId: string }) {
  const { data: settings, isLoading } = useFiscalSettings(tenantId);
  const upsert = useUpsertFiscalSettings();
  const [f, setF] = useState<Partial<FiscalSettings>>({});

  useEffect(() => {
    if (settings) setF(settings);
  }, [settings]);

  const set = <K extends keyof FiscalSettings>(k: K, v: FiscalSettings[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const provider = (f.provider || "focusnfe") as FiscalProvider;

  const save = () => {
    upsert.mutate({ ...f, tenant_id: tenantId, provider, environment: (f.environment || "sandbox") as FiscalEnvironment } as any);
  };

  if (isLoading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5" /> Emissão Fiscal (NFC-e)
          </CardTitle>
          <CardDescription>
            Configure um gateway fiscal para emitir notas eletrônicas de consumidor automaticamente em cada venda do PDV.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div>
              <div className="font-semibold">Emissão fiscal ativa</div>
              <div className="text-xs text-muted-foreground">Quando ligado, vendas do PDV podem emitir NFC-e.</div>
            </div>
            <Switch checked={!!f.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Provedor</Label>
              <Select value={provider} onValueChange={(v) => set("provider", v as FiscalProvider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="focusnfe">Focus NFe (recomendado)</SelectItem>
                  <SelectItem value="nfeio">NFE.io</SelectItem>
                  <SelectItem value="webmania">WebmaniaBR</SelectItem>
                  <SelectItem value="plugnotas">PlugNotas (em breve)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ambiente</Label>
              <Select value={f.environment || "sandbox"} onValueChange={(v) => set("environment", v as FiscalEnvironment)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Homologação (teste)</SelectItem>
                  <SelectItem value="production">Produção (vale fiscal)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {provider === "focusnfe" && (
            <Alert>
              <Info className="w-4 h-4" />
              <AlertTitle>Como obter o token Focus NFe</AlertTitle>
              <AlertDescription className="space-y-1 text-sm">
                <div>1. Acesse <a href="https://app.focusnfe.com.br/login" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">app.focusnfe.com.br <ExternalLink className="w-3 h-3" /></a></div>
                <div>2. Menu <b>Tokens</b> → copie o token de <b>Homologação</b> (testes) ou <b>Produção</b>.</div>
                <div>3. Cole no campo "Token Focus NFe" abaixo. É só esse 1 campo.</div>
                <div className="text-xs opacity-70 pt-1">Custo produção: R$ 0,09/NFC-e. Homologação ilimitado.</div>
              </AlertDescription>
            </Alert>
          )}

          {provider === "focusnfe" && (
            <div>
              <Label>Token Focus NFe</Label>
              <Input
                type="password"
                value={f.access_token || ""}
                onChange={(e) => set("access_token", e.target.value)}
                placeholder="Cole aqui o token da Focus NFe"
              />
            </div>
          )}

          {provider === "webmania" && (
            <Alert>
              <Info className="w-4 h-4" />
              <AlertTitle>Como obter as chaves WebmaniaBR</AlertTitle>
              <AlertDescription className="space-y-1 text-sm">
                <div>1. Crie conta em <a href="https://webmaniabr.com/painel/cadastro/" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">webmaniabr.com <ExternalLink className="w-3 h-3" /></a></div>
                <div>2. No painel: <b>NFe → Configurações → API REST</b></div>
                <div>3. Copie as 4 chaves abaixo</div>
              </AlertDescription>
            </Alert>
          )}

          {provider === "webmania" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Consumer Key</Label>
                <Input type="password" value={f.consumer_key || ""} onChange={(e) => set("consumer_key", e.target.value)} placeholder="ck_..." />
              </div>
              <div>
                <Label>Consumer Secret</Label>
                <Input type="password" value={f.consumer_secret || ""} onChange={(e) => set("consumer_secret", e.target.value)} placeholder="cs_..." />
              </div>
              <div>
                <Label>Access Token</Label>
                <Input type="password" value={f.access_token || ""} onChange={(e) => set("access_token", e.target.value)} placeholder="at_..." />
              </div>
              <div>
                <Label>Access Token Secret</Label>
                <Input type="password" value={f.access_token_secret || ""} onChange={(e) => set("access_token_secret", e.target.value)} placeholder="ats_..." />
              </div>
            </div>
          )}

          {provider === "nfeio" && (
            <Alert>
              <Info className="w-4 h-4" />
              <AlertTitle>Como configurar NFE.io</AlertTitle>
              <AlertDescription className="space-y-1 text-sm">
                <div>1. No painel <a href="https://app.nfe.io" target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">app.nfe.io <ExternalLink className="w-3 h-3" /></a> selecione <b>"Emissão de Nota Fiscal de Consumidor"</b>.</div>
                <div>2. Cadastre sua empresa (CNPJ) — anote o <b>Company ID</b> (UUID que aparece na URL ou em "Empresas").</div>
                <div>3. Em <b>API → Chaves de API</b> gere uma <b>API Key</b>.</div>
                <div>4. Cole os dois campos abaixo.</div>
              </AlertDescription>
            </Alert>
          )}

          {provider === "nfeio" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>API Key NFE.io</Label>
                <Input
                  type="password"
                  value={f.access_token || ""}
                  onChange={(e) => set("access_token", e.target.value)}
                  placeholder="Sua API Key"
                />
              </div>
              <div>
                <Label>Company ID (UUID)</Label>
                <Input
                  value={f.nfeio_company_id || ""}
                  onChange={(e) => set("nfeio_company_id", e.target.value)}
                  placeholder="ex: 8b8c8d8e-..."
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa (emitente)</CardTitle>
          <CardDescription>Esses dados sobem na nota — devem bater com o cadastro do CNPJ na Receita.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>CNPJ</Label><Input value={f.cnpj || ""} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0000-00" /></div>
          <div><Label>Razão Social</Label><Input value={f.razao_social || ""} onChange={(e) => set("razao_social", e.target.value)} /></div>
          <div><Label>Nome Fantasia</Label><Input value={f.nome_fantasia || ""} onChange={(e) => set("nome_fantasia", e.target.value)} /></div>
          <div><Label>Inscrição Estadual</Label><Input value={f.inscricao_estadual || ""} onChange={(e) => set("inscricao_estadual", e.target.value)} /></div>
          <div>
            <Label>Regime Tributário</Label>
            <Select value={f.regime_tributario || "simples_nacional"} onValueChange={(v) => set("regime_tributario", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="simples_nacional">Simples Nacional</SelectItem>
                <SelectItem value="simples_excesso">Simples Nacional — excesso de receita</SelectItem>
                <SelectItem value="regime_normal">Regime Normal (Lucro Presumido/Real)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>CNAE principal</Label><Input value={f.cnae || ""} onChange={(e) => set("cnae", e.target.value)} placeholder="5611201" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endereço fiscal</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><Label>Logradouro</Label><Input value={f.endereco_logradouro || ""} onChange={(e) => set("endereco_logradouro", e.target.value)} /></div>
          <div><Label>Número</Label><Input value={f.endereco_numero || ""} onChange={(e) => set("endereco_numero", e.target.value)} /></div>
          <div><Label>Complemento</Label><Input value={f.endereco_complemento || ""} onChange={(e) => set("endereco_complemento", e.target.value)} /></div>
          <div><Label>Bairro</Label><Input value={f.endereco_bairro || ""} onChange={(e) => set("endereco_bairro", e.target.value)} /></div>
          <div><Label>CEP</Label><Input value={f.endereco_cep || ""} onChange={(e) => set("endereco_cep", e.target.value)} /></div>
          <div><Label>Cidade</Label><Input value={f.endereco_cidade || ""} onChange={(e) => set("endereco_cidade", e.target.value)} /></div>
          <div><Label>UF</Label><Input value={f.endereco_uf || ""} maxLength={2} onChange={(e) => set("endereco_uf", e.target.value.toUpperCase())} /></div>
          <div><Label>Código IBGE Município</Label><Input value={f.endereco_codigo_municipio || ""} onChange={(e) => set("endereco_codigo_municipio", e.target.value)} placeholder="3550308" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defaults fiscais por produto</CardTitle>
          <CardDescription>Usado quando o produto não tem dados fiscais próprios.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>NCM padrão</Label><Input value={f.ncm_padrao || ""} onChange={(e) => set("ncm_padrao", e.target.value)} placeholder="22030000" /></div>
          <div><Label>CFOP padrão</Label><Input value={f.cfop_padrao || ""} onChange={(e) => set("cfop_padrao", e.target.value)} placeholder="5102" /></div>
          <div><Label>CEST padrão</Label><Input value={f.cest_padrao || ""} onChange={(e) => set("cest_padrao", e.target.value)} placeholder="opcional" /></div>
          <div><Label>Origem (0–8)</Label><Input value={f.origem_padrao || "0"} onChange={(e) => set("origem_padrao", e.target.value)} /></div>
          <div><Label>CSOSN (Simples)</Label><Input value={f.csosn_padrao || "102"} onChange={(e) => set("csosn_padrao", e.target.value)} /></div>
          <div><Label>CST (Reg. Normal)</Label><Input value={f.cst_padrao || ""} onChange={(e) => set("cst_padrao", e.target.value)} /></div>
          <div><Label>Unidade padrão</Label><Input value={f.unidade_padrao || "UN"} onChange={(e) => set("unidade_padrao", e.target.value)} /></div>
          <div><Label>Série NFC-e</Label><Input type="number" value={f.serie_nfce ?? 1} onChange={(e) => set("serie_nfce", Number(e.target.value))} /></div>
          <div><Label>Próximo nº NFC-e</Label><Input type="number" value={f.proximo_numero_nfce ?? 1} onChange={(e) => set("proximo_numero_nfce", Number(e.target.value))} /></div>
          <div><Label>CSC ID</Label><Input value={f.csc_id || ""} onChange={(e) => set("csc_id", e.target.value)} placeholder="ex: 000001" /></div>
          <div className="md:col-span-2"><Label>CSC Token</Label><Input type="password" value={f.csc_token || ""} onChange={(e) => set("csc_token", e.target.value)} placeholder="Código de Segurança do Contribuinte" /></div>
        </CardContent>
      </Card>

      <TenantFiscalContingencia tenantId={tenantId} />

      <div className="flex justify-end gap-2 pb-8">
        <Button onClick={save} disabled={upsert.isPending} size="lg">
          {upsert.isPending ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>
    </div>
  );
}
