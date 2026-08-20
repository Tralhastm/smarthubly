/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text, Hr } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

type DailyPoint = { label: string; date: string; revenue: number; orders: number }
type Product = { name: string; qty: number; revenue: number }
type Payment = { method: string; count: number; revenue: number; pctRevenue: number }
type Customer = { name: string; orders: number; revenue: number }
type Insight = { type: string; title: string; text: string }

interface Props {
  tenantName?: string
  periodStart?: string
  periodEnd?: string
  totalOrders?: number
  delivered?: number
  cancelled?: number
  cancelRate?: number
  revenue?: number
  avgTicket?: number
  prevRevenue?: number
  prevDelivered?: number
  prevAvgTicket?: number
  prevCancelRate?: number
  revDelta?: number
  ordersDelta?: number
  cancelDelta?: number
  daily?: DailyPoint[]
  peakDay?: DailyPoint | null
  peakHour?: { hour: number; count: number } | null
  topProducts?: Product[]
  payments?: Payment[]
  newCustomers?: number
  returningCustomers?: number
  topCustomers?: Customer[]
  fiadoTotal?: number
  fiadoOverdue?: number
  outOfStock?: number
  healthScore?: number
  healthLabel?: string
  aiInsights?: Insight[]
  recommendations?: string[]
}

const fmtBRL = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('pt-BR') } catch { return d } }
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${(v || 0).toFixed(1)}%`
const payLabel = (k: string) => ({ pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', cartão: 'Cartão', credit_card: 'Cartão crédito', debit_card: 'Cartão débito', fiado: 'Fiado', outro: 'Outro' } as Record<string, string>)[k] || k

const healthColor = (score: number) => score >= 75 ? '#16a34a' : score >= 55 ? '#3b82f6' : score >= 35 ? '#f59e0b' : '#dc2626'
const insightColor = (t: string) => t === 'success' ? '#16a34a' : t === 'warning' ? '#f59e0b' : t === 'danger' ? '#dc2626' : '#3b82f6'

const Email = (p: Props) => {
  const {
    tenantName = 'Lojista', periodStart = '', periodEnd = '',
    totalOrders = 0, delivered = 0, cancelled = 0, cancelRate = 0,
    revenue = 0, avgTicket = 0,
    prevRevenue = 0, prevDelivered = 0, prevAvgTicket = 0, prevCancelRate = 0,
    revDelta = 0, ordersDelta = 0, cancelDelta = 0,
    daily = [], peakDay, peakHour,
    topProducts = [], payments = [],
    newCustomers = 0, returningCustomers = 0, topCustomers = [],
    fiadoTotal = 0, fiadoOverdue = 0, outOfStock = 0,
    healthScore = 50, healthLabel = 'Bom',
    aiInsights = [], recommendations = [],
  } = p
  const maxRev = Math.max(...(daily || []).map(d => d.revenue), 1)
  const hc = healthColor(healthScore)

  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{healthLabel} • {fmtBRL(revenue)} ({fmtPct(revDelta)}) • {delivered} pedidos</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* HEADER */}
          <Section style={header}>
            <Heading style={h1}>Relatório semanal</Heading>
            <Text style={greeting}>{tenantName} • {fmtDate(periodStart)} → {fmtDate(periodEnd)}</Text>
          </Section>

          {/* SAÚDE DO NEGÓCIO */}
          <Section style={{ ...card, borderTop: 'none', borderRadius: 0 }}>
            <table width="100%" cellPadding={0} cellSpacing={0}><tbody><tr>
              <td style={{ width: '90px', verticalAlign: 'middle' }}>
                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: hc, color: '#fff', textAlign: 'center', lineHeight: '80px', fontSize: '26px', fontWeight: 800 }}>
                  {healthScore}
                </div>
              </td>
              <td style={{ verticalAlign: 'middle', paddingLeft: '14px' }}>
                <Text style={{ ...subhead, margin: 0, color: hc }}>Saúde do negócio: {healthLabel}</Text>
                <Text style={{ ...text, margin: '4px 0 0' }}>
                  {revDelta >= 10 ? `Você está bem porque o faturamento cresceu ${fmtPct(revDelta)} vs a semana anterior` :
                    revDelta >= 0 ? `Faturamento estável (${fmtPct(revDelta)}) — operação saudável` :
                    revDelta >= -10 ? `Pequena queda (${fmtPct(revDelta)}) — atenção, mas dentro do normal` :
                    `Queda significativa (${fmtPct(revDelta)}) — leia as recomendações abaixo`}
                  {cancelRate > 15 ? `. Cancelamentos altos (${cancelRate.toFixed(1)}%) puxaram o score pra baixo.` :
                    cancelRate < 5 ? `. Excelente: só ${cancelRate.toFixed(1)}% de cancelamento.` : ''}
                </Text>
              </td>
            </tr></tbody></table>
          </Section>

          {/* KPIs com delta */}
          <Section style={cardMid}>
            <Text style={subhead}>Indicadores vs semana anterior</Text>
            <table width="100%" cellPadding={0} cellSpacing={0}><tbody>
              <Kpi label="Faturamento" value={fmtBRL(revenue)} delta={revDelta} prev={fmtBRL(prevRevenue)} />
              <Kpi label="Pedidos entregues" value={String(delivered)} delta={ordersDelta} prev={String(prevDelivered)} />
              <Kpi label="Ticket médio" value={fmtBRL(avgTicket)} delta={prevAvgTicket > 0 ? ((avgTicket - prevAvgTicket) / prevAvgTicket) * 100 : 0} prev={fmtBRL(prevAvgTicket)} />
              <Kpi label="Cancelamento" value={`${cancelRate.toFixed(1)}%`} delta={cancelDelta} prev={`${prevCancelRate.toFixed(1)}%`} inverted />
            </tbody></table>
            <Text style={mini}>{totalOrders} pedidos no total na semana ({cancelled} cancelados)</Text>
          </Section>

          {/* GRÁFICO DIÁRIO */}
          {daily.length > 0 && (
            <Section style={cardMid}>
              <Text style={subhead}>Faturamento por dia</Text>
              <table width="100%" cellPadding={0} cellSpacing={0}><tbody><tr>
                {daily.map((d, i) => {
                  const h = Math.max(Math.round((d.revenue / maxRev) * 110), d.revenue > 0 ? 8 : 2)
                  return (
                    <td key={i} style={{ verticalAlign: 'bottom', textAlign: 'center', padding: '0 2px' }}>
                      <div style={{ fontSize: '9px', color: '#6b7280', marginBottom: '4px', height: '12px' }}>
                        {d.revenue > 0 ? (d.revenue >= 1000 ? `${(d.revenue / 1000).toFixed(1)}k` : `${d.revenue.toFixed(0)}`) : ''}
                      </div>
                      <div style={{ background: d.revenue > 0 ? '#3b82f6' : '#e5e7eb', height: `${h}px`, borderRadius: '4px 4px 0 0' }} />
                      <div style={{ fontSize: '10px', color: '#111827', marginTop: '4px', fontWeight: 600 }}>{d.label}</div>
                      <div style={{ fontSize: '9px', color: '#9ca3af' }}>{d.date}</div>
                    </td>
                  )
                })}
              </tr></tbody></table>
              {peakDay && (
                <Text style={mini}>
                  Melhor dia: <b>{peakDay.label} {peakDay.date}</b> com {fmtBRL(peakDay.revenue)} ({peakDay.orders} pedidos).
                  {peakHour ? ` Pico de pedidos por volta das ${peakHour.hour}h.` : ''}
                </Text>
              )}
            </Section>
          )}

          {/* TOP PRODUTOS */}
          {topProducts.length > 0 && (
            <Section style={cardMid}>
              <Text style={subhead}>🏆 Top produtos</Text>
              {topProducts.map((p, i) => (
                <table key={i} width="100%" cellPadding={0} cellSpacing={0} style={{ marginBottom: '6px' }}><tbody><tr>
                  <td style={{ width: '24px', color: '#6b7280', fontSize: '13px' }}>{i + 1}.</td>
                  <td style={{ color: '#111827', fontSize: '13px' }}>{p.name}</td>
                  <td style={{ textAlign: 'right', color: '#3b82f6', fontSize: '13px', fontWeight: 700 }}>{fmtBRL(p.revenue)}</td>
                  <td style={{ textAlign: 'right', color: '#9ca3af', fontSize: '11px', width: '40px' }}>{p.qty}un</td>
                </tr></tbody></table>
              ))}
            </Section>
          )}

          {/* PAGAMENTOS */}
          {payments.length > 0 && (
            <Section style={cardMid}>
              <Text style={subhead}>💳 Formas de pagamento</Text>
              {payments.map((pm, i) => (
                <div key={i} style={{ marginBottom: '8px' }}>
                  <table width="100%" cellPadding={0} cellSpacing={0}><tbody><tr>
                    <td style={{ fontSize: '12px', color: '#374151' }}>{payLabel(pm.method)} ({pm.count})</td>
                    <td style={{ textAlign: 'right', fontSize: '12px', color: '#111827', fontWeight: 600 }}>{fmtBRL(pm.revenue)} • {pm.pctRevenue.toFixed(0)}%</td>
                  </tr></tbody></table>
                  <div style={{ height: '6px', background: '#f3f4f6', borderRadius: '3px', marginTop: '3px' }}>
                    <div style={{ width: `${pm.pctRevenue}%`, height: '6px', background: '#3b82f6', borderRadius: '3px' }} />
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* CLIENTES */}
          <Section style={cardMid}>
            <Text style={subhead}>👥 Clientes</Text>
            <table width="100%" cellPadding={0} cellSpacing={0}><tbody><tr>
              <td style={miniCard}>
                <Text style={miniLabel}>Novos</Text>
                <Text style={{ ...miniValue, color: '#3b82f6' }}>{newCustomers}</Text>
              </td>
              <td style={miniCard}>
                <Text style={miniLabel}>Recorrentes</Text>
                <Text style={{ ...miniValue, color: '#16a34a' }}>{returningCustomers}</Text>
              </td>
              <td style={miniCard}>
                <Text style={miniLabel}>Retenção</Text>
                <Text style={miniValue}>{(newCustomers + returningCustomers) > 0 ? ((returningCustomers / (newCustomers + returningCustomers)) * 100).toFixed(0) : 0}%</Text>
              </td>
            </tr></tbody></table>
            {topCustomers.length > 0 && (
              <>
                <Text style={{ ...mini, marginTop: '12px', fontWeight: 600 }}>Top 3 clientes da semana:</Text>
                {topCustomers.map((c, i) => (
                  <Text key={i} style={mini}>{i + 1}. {c.name} — {c.orders} pedido(s) • {fmtBRL(c.revenue)}</Text>
                ))}
              </>
            )}
          </Section>

          {/* ALERTAS OPERACIONAIS */}
          {(fiadoTotal > 0 || outOfStock > 0) && (
            <Section style={cardMid}>
              <Text style={subhead}>⚠️ Pontos de atenção</Text>
              {fiadoTotal > 0 && (
                <Text style={text}>
                  <b>Fiado em aberto:</b> {fmtBRL(fiadoTotal)}
                  {fiadoOverdue > 0 && <> — <span style={{ color: '#dc2626', fontWeight: 700 }}>{fmtBRL(fiadoOverdue)} VENCIDO</span></>}
                </Text>
              )}
              {outOfStock > 0 && (
                <Text style={text}><b>Produtos sem estoque:</b> {outOfStock} item(ns) zerados — você pode estar perdendo venda.</Text>
              )}
            </Section>
          )}

          {/* INSIGHTS DA IA */}
          {aiInsights.length > 0 && (
            <Section style={cardMid}>
              <Text style={subhead}>🤖 Análise da IA</Text>
              {aiInsights.map((it, i) => (
                <div key={i} style={{ borderLeft: `3px solid ${insightColor(it.type)}`, padding: '6px 10px', marginBottom: '8px', background: '#fafafa' }}>
                  <Text style={{ ...text, margin: 0, fontWeight: 700, color: '#111827' }}>{it.title}</Text>
                  <Text style={{ ...text, margin: '2px 0 0', fontSize: '13px' }}>{it.text}</Text>
                </div>
              ))}
            </Section>
          )}

          {/* RECOMENDAÇÕES */}
          {recommendations.length > 0 && (
            <Section style={cardMid}>
              <Text style={subhead}>🎯 O que fazer essa semana</Text>
              {recommendations.map((r, i) => (
                <Text key={i} style={text}>• {r}</Text>
              ))}
            </Section>
          )}

          <Section style={cardBottom}>
            <Text style={footnote}>Acesse o painel da loja para ver gráficos detalhados, financeiro completo e exportar relatórios em PDF.</Text>
          </Section>
          <Text style={footer}>Enviado automaticamente toda segunda-feira às 8h</Text>
        </Container>
      </Body>
    </Html>
  )
}

const Kpi = ({ label, value, delta, prev, inverted }: { label: string; value: string; delta: number; prev: string; inverted?: boolean }) => {
  const positive = inverted ? delta <= 0 : delta >= 0
  const color = positive ? '#16a34a' : '#dc2626'
  const arrow = delta >= 0 ? '▲' : '▼'
  return (
    <tr>
      <td style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
        <Text style={{ ...mini, margin: 0 }}>{label}</Text>
        <Text style={{ ...text, margin: '2px 0 0', fontSize: '16px', fontWeight: 700, color: '#111827' }}>{value}</Text>
      </td>
      <td style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6', textAlign: 'right' as const }}>
        <Text style={{ ...mini, margin: 0, color, fontWeight: 700 }}>{arrow} {fmtPct(delta)}</Text>
        <Text style={{ ...mini, margin: '2px 0 0' }}>antes: {prev}</Text>
      </td>
    </tr>
  )
}

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `📊 Semana de ${d?.tenantName ?? 'sua loja'}: ${d?.healthLabel || 'relatório'} • ${typeof d?.revenue === 'number' ? d.revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''}`,
  displayName: 'Relatório semanal',
  previewData: {
    tenantName: 'Lanchar',
    periodStart: new Date(Date.now() - 7 * 86400000).toISOString(),
    periodEnd: new Date().toISOString(),
    totalOrders: 47, delivered: 41, cancelled: 6, cancelRate: 12.8,
    revenue: 4280.50, avgTicket: 104.40,
    prevRevenue: 3650, prevDelivered: 35, prevAvgTicket: 104.28, prevCancelRate: 14.2,
    revDelta: 17.3, ordersDelta: 17.1, cancelDelta: -1.4,
    daily: [
      { label: 'seg', date: '06/05', revenue: 420, orders: 5 },
      { label: 'ter', date: '07/05', revenue: 380, orders: 4 },
      { label: 'qua', date: '08/05', revenue: 510, orders: 6 },
      { label: 'qui', date: '09/05', revenue: 620, orders: 7 },
      { label: 'sex', date: '10/05', revenue: 980, orders: 9 },
      { label: 'sáb', date: '11/05', revenue: 870, orders: 7 },
      { label: 'dom', date: '12/05', revenue: 500, orders: 3 },
    ],
    peakDay: { label: 'sex', date: '10/05', revenue: 980, orders: 9 },
    peakHour: { hour: 20, count: 11 },
    topProducts: [
      { name: 'X-Tudo', qty: 28, revenue: 980 },
      { name: 'X-Bacon', qty: 22, revenue: 770 },
      { name: 'Batata G', qty: 35, revenue: 525 },
    ],
    payments: [
      { method: 'pix', count: 24, revenue: 2400, pctRevenue: 56 },
      { method: 'dinheiro', count: 12, revenue: 1280, pctRevenue: 30 },
      { method: 'fiado', count: 5, revenue: 600, pctRevenue: 14 },
    ],
    newCustomers: 12, returningCustomers: 18,
    topCustomers: [
      { name: 'João Silva', orders: 4, revenue: 380 },
      { name: 'Maria Souza', orders: 3, revenue: 290 },
      { name: 'Carlos Lima', orders: 3, revenue: 240 },
    ],
    fiadoTotal: 850, fiadoOverdue: 120, outOfStock: 6,
    healthScore: 78, healthLabel: 'Excelente',
    aiInsights: [
      { type: 'success', title: '🚀 Sexta foi seu dia mais forte', text: 'R$ 980 em sexta, 60% acima da média. Repita a estratégia (promoção, post, horário) na próxima sexta.' },
      { type: 'warning', title: '⚠️ 6 produtos sem estoque', text: 'Reponha urgente — pode estar perdendo cerca de R$ 200/semana em vendas que não fecharam.' },
    ],
    recommendations: [
      'Crescimento forte de +17% — replique o que funcionou na sexta (10/05).',
      'Pico concentrado às 20h. Reforce equipe nesse horário.',
      'R$ 120 em fiado VENCIDO. Mande lembrete pelos botões na aba Fiado.',
    ],
  } satisfies Props,
} satisfies TemplateEntry

const main = { backgroundColor: '#f9fafb', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif', margin: 0, padding: '24px 0' }
const container = { maxWidth: '620px', margin: '0 auto', padding: '0 16px' }
const header = { background: 'linear-gradient(135deg, #3b82f6, #1e40af)', padding: '24px', borderRadius: '12px 12px 0 0', color: '#ffffff' }
const h1 = { margin: 0, fontSize: '22px', color: '#ffffff', fontWeight: 700 }
const greeting = { margin: '8px 0 0', color: '#dbeafe', fontSize: '13px' }
const card = { border: '1px solid #e5e7eb', borderTop: 'none', background: '#ffffff', padding: '20px' }
const cardMid = { ...card, borderRadius: 0 }
const cardBottom = { ...card, borderRadius: '0 0 12px 12px' }
const text = { color: '#374151', fontSize: '14px', lineHeight: '1.6', margin: '0 0 8px' }
const subhead = { color: '#111827', fontSize: '15px', fontWeight: 700, margin: '0 0 12px' }
const mini = { color: '#6b7280', fontSize: '12px', margin: '4px 0 0' }
const miniCard = { padding: '12px 6px', textAlign: 'center' as const, border: '1px solid #f3f4f6', borderRadius: '8px' }
const miniLabel = { color: '#6b7280', fontSize: '11px', margin: 0, textTransform: 'uppercase' as const }
const miniValue = { color: '#111827', fontSize: '20px', fontWeight: 700, margin: '4px 0 0' }
const footnote = { color: '#6b7280', fontSize: '12px', lineHeight: '1.6', margin: 0 }
const footer = { color: '#9ca3af', fontSize: '11px', textAlign: 'center' as const, marginTop: '16px' }
