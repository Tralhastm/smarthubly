/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as billingInvoice } from './billing-invoice.tsx'
import { template as creditReminder } from './credit-reminder.tsx'
import { template as orderConfirmed } from './order-confirmed.tsx'
import { template as orderOutForDelivery } from './order-out-for-delivery.tsx'
import { template as orderReadyForPickup } from './order-ready-for-pickup.tsx'
import { template as orderDelivered } from './order-delivered.tsx'
import { template as weeklyReport } from './weekly-report.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'billing-invoice': billingInvoice,
  'credit-reminder': creditReminder,
  'order-confirmed': orderConfirmed,
  'order-out-for-delivery': orderOutForDelivery,
  'order-ready-for-pickup': orderReadyForPickup,
  'order-delivered': orderDelivered,
  'weekly-report': weeklyReport,
}
