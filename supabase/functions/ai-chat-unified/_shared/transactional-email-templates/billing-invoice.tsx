/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface BillingInvoiceProps {
  tenantName?: string
  amount?: number
  periodStart?: string
  periodEnd?: string
  dueDate?: string
  ordersCount?: number
  isOverdue?: boolean
  isTest?: boolean
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString('pt-BR')
  } catch {
    return d
  }
}

const BillingInvoiceEmail = ({
  tenantName = 'Lojista',
  amount = 0,
  periodStart = new Date().toISOString(),
  periodEnd = new Date().toISOString(),
  dueDate = new Date().toISOString(),
  ordersCount = 0,
  isOverdue = false,
  isTest = false,
}: BillingInvoiceProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>
      {isOverdue ? 'Cobrança em atraso' : 'Nova cobrança disponível'} — {tenantName}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={h1}>
            {isOverdue ? 'Cobrança em atraso' : 'Nova cobrança'}
          </Heading>
          <Text style={greeting}>Olá, {tenantName}!</Text>
        </Section>

        <Section style={card}>
          <Text style={text}>
            {isOverdue
              ? 'Identificamos que sua cobrança está em atraso. Por favor, regularize o quanto antes para evitar bloqueio da loja.'
              : 'Foi gerada uma nova cobrança referente ao uso da plataforma no período abaixo.'}
          </Text>

          <Section style={tableBox}>
            <Row label="Período" value={`${fmtDate(periodStart)} → ${fmtDate(periodEnd)}`} />
            <Row label="Pedidos" value={String(ordersCount)} />
            <Row
              label="Vencimento"
              value={fmtDate(dueDate)}
              valueColor={isOverdue ? '#dc2626' : '#111827'}
            />
          </Section>

          <Section style={amountBox}>
            <Text style={amountLabel}>Valor total</Text>
            <Text style={amountValue}>{fmtBRL(Number(amount))}</Text>
          </Section>

          <Text style={footnote}>
            Acesse o painel da sua loja para ver detalhes e declarar o pagamento.
            Em caso de dúvidas, entre em contato com o suporte.
          </Text>

          {isTest && (
            <Section style={testBox}>
              <Text style={testText}>
                ⚠️ Este é um e-mail de TESTE com dados fictícios.
              </Text>
            </Section>
          )}
        </Section>

        <Text style={footer}>Enviado pela plataforma de delivery</Text>
      </Container>
    </Body>
  </Html>
)

const Row = ({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) => (
  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <tbody>
      <tr>
        <td style={rowLabel}>{label}</td>
        <td style={{ ...rowValue, color: valueColor || '#111827' }}>{value}</td>
      </tr>
    </tbody>
  </table>
)

export const template = {
  component: BillingInvoiceEmail,
  subject: (data: Record<string, any>) =>
    data?.isOverdue
      ? `⚠️ Cobrança em atraso — ${data?.tenantName ?? 'sua loja'}`
      : `Nova cobrança disponível — ${data?.tenantName ?? 'sua loja'}`,
  displayName: 'Cobrança da plataforma',
  previewData: {
    tenantName: 'Texas Bebidas',
    amount: 60,
    periodStart: new Date(Date.now() - 30 * 86400000).toISOString(),
    periodEnd: new Date().toISOString(),
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    ordersCount: 12,
    isOverdue: false,
    isTest: true,
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  margin: 0,
  padding: '24px 0',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '0 16px' }
const header = {
  background: 'linear-gradient(135deg, #3b82f6, #1e40af)',
  padding: '24px',
  borderRadius: '12px 12px 0 0',
  color: '#ffffff',
}
const h1 = { margin: 0, fontSize: '22px', color: '#ffffff', fontWeight: 700 }
const greeting = { margin: '8px 0 0', color: '#dbeafe', fontSize: '14px' }
const card = {
  border: '1px solid #e5e7eb',
  borderTop: 'none',
  borderRadius: '0 0 12px 12px',
  padding: '24px',
}
const text = { color: '#374151', fontSize: '14px', lineHeight: '1.6', margin: '0 0 16px' }
const tableBox = { margin: '16px 0' }
const rowLabel = { padding: '8px 0', color: '#6b7280', fontSize: '13px' }
const rowValue = {
  padding: '8px 0',
  textAlign: 'right' as const,
  fontSize: '13px',
  fontWeight: 600,
}
const amountBox = {
  background: '#f3f4f6',
  padding: '16px',
  borderRadius: '8px',
  textAlign: 'center' as const,
  margin: '16px 0',
}
const amountLabel = { color: '#6b7280', fontSize: '12px', margin: 0 }
const amountValue = {
  color: '#111827',
  fontSize: '28px',
  fontWeight: 700,
  margin: '4px 0 0',
}
const footnote = { color: '#6b7280', fontSize: '12px', lineHeight: '1.6', marginTop: '24px' }
const testBox = {
  background: '#fef3c7',
  borderRadius: '6px',
  padding: '8px',
  marginTop: '16px',
}
const testText = {
  color: '#92400e',
  fontSize: '11px',
  textAlign: 'center' as const,
  margin: 0,
}
const footer = {
  color: '#9ca3af',
  fontSize: '11px',
  textAlign: 'center' as const,
  marginTop: '16px',
}
