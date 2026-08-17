/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface CreditReminderProps {
  customerName?: string
  storeName?: string
  amount?: number
  amountPaid?: number
  description?: string
  dueDate?: string
  daysOverdue?: number
  pixKey?: string
  storePhone?: string
  isOverdue?: boolean
  reminderNumber?: number
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d: string) => {
  try { return new Date(d).toLocaleDateString('pt-BR') } catch { return d }
}

const CreditReminderEmail = ({
  customerName = 'Cliente',
  storeName = 'Loja',
  amount = 0,
  amountPaid = 0,
  description = '',
  dueDate = new Date().toISOString(),
  daysOverdue = 0,
  pixKey = '',
  storePhone = '',
  isOverdue = false,
  reminderNumber = 1,
}: CreditReminderProps) => {
  const remaining = Math.max(0, amount - amountPaid)
  const tone = isOverdue ? '#dc2626' : '#f59e0b'
  const headline = isOverdue
    ? `Pagamento em atraso há ${daysOverdue} dia${daysOverdue === 1 ? '' : 's'}`
    : 'Lembrete de pagamento'

  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{headline} — {storeName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={{ ...badge, backgroundColor: tone }}>
            <Text style={badgeText}>{isOverdue ? '⚠️ ATRASADO' : '📋 LEMBRETE'}</Text>
          </Section>

          <Heading style={h1}>Olá, {customerName}!</Heading>

          <Text style={text}>
            Esta é uma mensagem da <strong>{storeName}</strong> sobre o seu fiado em aberto.
            {reminderNumber > 1 && ` (Lembrete nº ${reminderNumber})`}
          </Text>

          <Section style={card}>
            <Text style={cardLabel}>Valor em aberto</Text>
            <Text style={{ ...cardValue, color: tone }}>{fmtBRL(remaining)}</Text>
            {amountPaid > 0 && (
              <Text style={cardSub}>
                (Pago parcial: {fmtBRL(amountPaid)} de {fmtBRL(amount)})
              </Text>
            )}
            {description && (
              <>
                <Hr style={hr} />
                <Text style={cardLabel}>Referente a</Text>
                <Text style={cardItem}>{description}</Text>
              </>
            )}
            <Hr style={hr} />
            <Text style={cardLabel}>Vencimento</Text>
            <Text style={cardItem}>
              {fmtDate(dueDate)}
              {isOverdue && <span style={{ color: tone, fontWeight: 'bold' }}> · vencido</span>}
            </Text>
          </Section>

          {pixKey && (
            <Section style={pixBox}>
              <Text style={pixLabel}>💸 Pague com PIX</Text>
              <Text style={pixKeyStyle}>{pixKey}</Text>
            </Section>
          )}

          {storePhone && (
            <Text style={text}>
              Dúvidas? Entre em contato: <strong>{storePhone}</strong>
            </Text>
          )}

          <Text style={text}>
            Se você já pagou, por favor desconsidere este e-mail. Obrigado!
          </Text>

          <Hr style={hr} />
          <Text style={footer}>{storeName} · Mensagem automática de cobrança</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CreditReminderEmail,
  subject: (d: Record<string, any>) =>
    d?.isOverdue
      ? `⚠️ Pagamento em atraso — ${d?.storeName || 'Loja'}`
      : `Lembrete de pagamento — ${d?.storeName || 'Loja'}`,
  displayName: 'Lembrete de fiado',
  previewData: {
    customerName: 'João Silva',
    storeName: 'Lanchar',
    amount: 45.5,
    amountPaid: 0,
    description: '2 X-Burger + 1 Coca 2L',
    dueDate: new Date(Date.now() - 3 * 86400000).toISOString(),
    daysOverdue: 3,
    pixKey: 'lanchar@pix.com',
    storePhone: '(11) 99999-0000',
    isOverdue: true,
    reminderNumber: 2,
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '20px 25px', maxWidth: '560px' }
const badge = { borderRadius: '6px', padding: '6px 12px', display: 'inline-block', marginBottom: '16px' }
const badgeText = { color: '#ffffff', fontSize: '12px', fontWeight: 'bold', margin: 0, letterSpacing: '0.5px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#111827', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const card = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', margin: '20px 0' }
const cardLabel = { fontSize: '11px', color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '0 0 4px', fontWeight: 'bold' }
const cardValue = { fontSize: '28px', fontWeight: 'bold', margin: '0 0 4px' }
const cardItem = { fontSize: '14px', color: '#111827', margin: '0 0 8px' }
const cardSub = { fontSize: '12px', color: '#6b7280', margin: '0' }
const pixBox = { backgroundColor: '#ecfdf5', border: '1px solid #10b981', borderRadius: '8px', padding: '14px', margin: '16px 0', textAlign: 'center' as const }
const pixLabel = { fontSize: '13px', color: '#047857', fontWeight: 'bold', margin: '0 0 6px' }
const pixKeyStyle = { fontSize: '15px', color: '#064e3b', fontFamily: 'monospace', margin: 0, wordBreak: 'break-all' as const }
const hr = { border: 'none', borderTop: '1px solid #e5e7eb', margin: '14px 0' }
const footer = { fontSize: '11px', color: '#9ca3af', margin: '20px 0 0', textAlign: 'center' as const }
