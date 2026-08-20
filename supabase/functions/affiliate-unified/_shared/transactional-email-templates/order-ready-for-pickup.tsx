/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props { customerName?: string; tenantName?: string; orderId?: string }

const Email = ({ customerName = '', tenantName = 'Loja', orderId = '' }: Props) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu pedido #{orderId} está pronto para retirada</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}><Heading style={h1}>📦 Pronto para retirada!</Heading></Section>
        <Section style={card}>
          <Text style={text}>Olá{customerName ? `, ${customerName}` : ''}! Seu pedido <b>#{orderId}</b> em <b>{tenantName}</b> está pronto e te esperando para retirada.</Text>
          <Text style={footnote}><b>Não recebeu algum e-mail?</b> Confira sua caixa de spam ou promoções.</Text>
        </Section>
        <Text style={footer}>{tenantName}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `📦 Pedido #${d?.orderId ?? ''} pronto para retirada`,
  displayName: 'Pedido pronto para retirada',
  previewData: { customerName: 'João', tenantName: 'Lanchar', orderId: 'A1B2C3D4' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif', margin: 0, padding: '24px 0' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '0 16px' }
const header = { background: 'linear-gradient(135deg,#f59e0b,#d97706)', padding: '24px', borderRadius: '12px 12px 0 0', color: '#fff' }
const h1 = { margin: 0, fontSize: '22px', color: '#fff', fontWeight: 700 }
const card = { border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '24px' }
const text = { color: '#374151', fontSize: '14px', lineHeight: '1.6', margin: '0 0 16px' }
const footnote = { color: '#6b7280', fontSize: '12px', lineHeight: '1.6', marginTop: '16px' }
const footer = { color: '#9ca3af', fontSize: '11px', textAlign: 'center' as const, marginTop: '16px' }
