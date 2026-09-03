# Arquivo completo de pagamentos — SmartHubly

> Gerado em 2026-09-03T02:15:27.472130+00:00 a partir do working tree local. Este arquivo preserva fontes e referências relacionadas a pagamentos; nenhum segredo de ambiente foi incluído.

## Escopo

O diretório `files/` contém cópias dos arquivos do frontend, backend, migrações, tipos, testes, integrações, webhooks, checkout, Pix, parcelamento, taxas e rotinas de pedidos que possuem referências relacionadas a pagamentos. Os caminhos dentro de `files/` preservam a localização original no projeto.

## Integrações preservadas

| Integração/fluxo | Arquivos incluídos |
|---|---|
| Asaas | create-payment, asaas-webhook, configurações administrativas, status público e migrações de tokens/ambiente |
| Mercado Pago | create-payment, mercadopago-webhook, reconciliação e telas de checkout |
| InfinitePay | biblioteca, checkout Pix/Tap, taxas de 1x a 12x e configuração do tenant |
| PagBank | create-payment, pagbank-webhook e configurações relacionadas |
| Pix/cartão/parcelamento | componentes de checkout, gateway, PDV, venda manual e taxas |
| Pedidos/financeiro | tabelas, transações, status, automações, reconciliação e relatórios relacionados |

## Arquivos incluídos

| Caminho original | Cópia no arquivo | Tamanho (bytes) |
|---|---|---:|
| `.github/workflows/supabase-deploy.yml` | `files/.github/workflows/supabase-deploy.yml` | 1082 |
| `__attachments__/pasted_content_2.txt` | `files/__attachments__/pasted_content_2.txt` | 3332 |
| `src/components/pdv/PdvPayment.tsx` | `files/src/components/pdv/PdvPayment.tsx` | 6292 |
| `src/components/shared/CepAddressForm.tsx` | `files/src/components/shared/CepAddressForm.tsx` | 7202 |
| `src/components/shared/MarketingPostGenerator.tsx` | `files/src/components/shared/MarketingPostGenerator.tsx` | 24326 |
| `src/components/super-admin/CindyChat.tsx` | `files/src/components/super-admin/CindyChat.tsx` | 31824 |
| `src/components/super-admin/SuperAdminAiEditor.tsx` | `files/src/components/super-admin/SuperAdminAiEditor.tsx` | 32221 |
| `src/components/super-admin/SuperAdminDashboard.tsx` | `files/src/components/super-admin/SuperAdminDashboard.tsx` | 3513 |
| `src/components/super-admin/SuperAdminFeeRequests.tsx` | `files/src/components/super-admin/SuperAdminFeeRequests.tsx` | 5213 |
| `src/components/super-admin/SuperAdminFinancialReport.tsx` | `files/src/components/super-admin/SuperAdminFinancialReport.tsx` | 5757 |
| `src/components/super-admin/SuperAdminMetrics.tsx` | `files/src/components/super-admin/SuperAdminMetrics.tsx` | 5839 |
| `src/components/super-admin/SuperAdminStoreHealth.tsx` | `files/src/components/super-admin/SuperAdminStoreHealth.tsx` | 7553 |
| `src/components/super-admin/SuperAdminTenants.tsx` | `files/src/components/super-admin/SuperAdminTenants.tsx` | 43252 |
| `src/components/super-admin/SuperAdminUsageMonitor.tsx` | `files/src/components/super-admin/SuperAdminUsageMonitor.tsx` | 7701 |
| `src/components/tenant/AddressAutocomplete.tsx` | `files/src/components/tenant/AddressAutocomplete.tsx` | 3196 |
| `src/components/tenant/CepAddressInput.tsx` | `files/src/components/tenant/CepAddressInput.tsx` | 11328 |
| `src/components/tenant/FinancialReportPDFButton.tsx` | `files/src/components/tenant/FinancialReportPDFButton.tsx` | 11298 |
| `src/components/tenant/ManualSaleDialog.tsx` | `files/src/components/tenant/ManualSaleDialog.tsx` | 13235 |
| `src/components/tenant/OnboardingChecklist.tsx` | `files/src/components/tenant/OnboardingChecklist.tsx` | 4272 |
| `src/components/tenant/StructuredAddressInput.tsx` | `files/src/components/tenant/StructuredAddressInput.tsx` | 5997 |
| `src/components/tenant/SupplierShippingConfig.tsx` | `files/src/components/tenant/SupplierShippingConfig.tsx` | 11490 |
| `src/components/tenant/TableSplitPaymentDialog.tsx` | `files/src/components/tenant/TableSplitPaymentDialog.tsx` | 5925 |
| `src/components/tenant/TenantAdminAutomations.tsx` | `files/src/components/tenant/TenantAdminAutomations.tsx` | 29529 |
| `src/components/tenant/TenantAdminAutomationsDiagnostic.tsx` | `files/src/components/tenant/TenantAdminAutomationsDiagnostic.tsx` | 14617 |
| `src/components/tenant/TenantAdminAutomationsMonitor.tsx` | `files/src/components/tenant/TenantAdminAutomationsMonitor.tsx` | 17106 |
| `src/components/tenant/TenantAdminDashboard.tsx` | `files/src/components/tenant/TenantAdminDashboard.tsx` | 12113 |
| `src/components/tenant/TenantAdminEmails.tsx` | `files/src/components/tenant/TenantAdminEmails.tsx` | 14119 |
| `src/components/tenant/TenantAdminFichaTecnica.tsx` | `files/src/components/tenant/TenantAdminFichaTecnica.tsx` | 17742 |
| `src/components/tenant/TenantAdminFinanceDeep.tsx` | `files/src/components/tenant/TenantAdminFinanceDeep.tsx` | 29051 |
| `src/components/tenant/TenantAdminIntegrations.tsx` | `files/src/components/tenant/TenantAdminIntegrations.tsx` | 21712 |
| `src/components/tenant/TenantAdminOrders.tsx` | `files/src/components/tenant/TenantAdminOrders.tsx` | 41240 |
| `src/components/tenant/TenantAdminProducts.tsx` | `files/src/components/tenant/TenantAdminProducts.tsx` | 98130 |
| `src/components/tenant/TenantAdminScheduling.tsx` | `files/src/components/tenant/TenantAdminScheduling.tsx` | 29443 |
| `src/components/tenant/TenantAdminShipping.tsx` | `files/src/components/tenant/TenantAdminShipping.tsx` | 20725 |
| `src/components/tenant/TenantAffiliateCatalog.tsx` | `files/src/components/tenant/TenantAffiliateCatalog.tsx` | 18220 |
| `src/components/tenant/TenantCartDrawer.tsx` | `files/src/components/tenant/TenantCartDrawer.tsx` | 80910 |
| `src/components/tenant/TenantFinancialManager.tsx` | `files/src/components/tenant/TenantFinancialManager.tsx` | 87206 |
| `src/components/tenant/TenantQuickSale.tsx` | `files/src/components/tenant/TenantQuickSale.tsx` | 24804 |
| `src/components/tenant/TenantSellerManagement.tsx` | `files/src/components/tenant/TenantSellerManagement.tsx` | 11346 |
| `src/components/tenant/WaiterComandaEditor.tsx` | `files/src/components/tenant/WaiterComandaEditor.tsx` | 16323 |
| `src/hooks/useCoupons.ts` | `files/src/hooks/useCoupons.ts` | 4491 |
| `src/hooks/useFeeRequests.ts` | `files/src/hooks/useFeeRequests.ts` | 1711 |
| `src/hooks/useFichaTecnica.ts` | `files/src/hooks/useFichaTecnica.ts` | 4244 |
| `src/hooks/useFinanceDeep.ts` | `files/src/hooks/useFinanceDeep.ts` | 6704 |
| `src/hooks/useOrders.ts` | `files/src/hooks/useOrders.ts` | 10328 |
| `src/hooks/useProducts.ts` | `files/src/hooks/useProducts.ts` | 4962 |
| `src/hooks/useStoreHealth.ts` | `files/src/hooks/useStoreHealth.ts` | 6466 |
| `src/hooks/useSuppliers.ts` | `files/src/hooks/useSuppliers.ts` | 3652 |
| `src/hooks/useTenants.ts` | `files/src/hooks/useTenants.ts` | 3568 |
| `src/integrations/supabase/types.ts` | `files/src/integrations/supabase/types.ts` | 198693 |
| `src/lib/admin-subtabs.tsx` | `files/src/lib/admin-subtabs.tsx` | 3068 |
| `src/lib/escpos.ts` | `files/src/lib/escpos.ts` | 6758 |
| `src/lib/help-content.ts` | `files/src/lib/help-content.ts` | 24622 |
| `src/lib/infinitepay.ts` | `files/src/lib/infinitepay.ts` | 1417 |
| `src/lib/order-finance.ts` | `files/src/lib/order-finance.ts` | 1560 |
| `src/lib/order-print.ts` | `files/src/lib/order-print.ts` | 5033 |
| `src/lib/payment-method.ts` | `files/src/lib/payment-method.ts` | 1579 |
| `src/lib/remove-image-bg.ts` | `files/src/lib/remove-image-bg.ts` | 2952 |
| `src/pages/DriverPanel.tsx` | `files/src/pages/DriverPanel.tsx` | 23892 |
| `src/pages/PdvMaquininha.tsx` | `files/src/pages/PdvMaquininha.tsx` | 9192 |
| `src/pages/SuperAdmin.tsx` | `files/src/pages/SuperAdmin.tsx` | 9180 |
| `src/pages/SupplierPanel.tsx` | `files/src/pages/SupplierPanel.tsx` | 61645 |
| `src/pages/TableSession.tsx` | `files/src/pages/TableSession.tsx` | 26864 |
| `src/pages/TenantAdmin.tsx` | `files/src/pages/TenantAdmin.tsx` | 79769 |
| `src/pages/TenantOrderStatus.tsx` | `files/src/pages/TenantOrderStatus.tsx` | 27728 |
| `src/pages/TenantPaymentGateway.tsx` | `files/src/pages/TenantPaymentGateway.tsx` | 13563 |
| `src/pages/Totem.tsx` | `files/src/pages/Totem.tsx` | 11674 |
| `src/pages/WaiterPanel.tsx` | `files/src/pages/WaiterPanel.tsx` | 28772 |
| `src/test/wave1-e2e.test.tsx` | `files/src/test/wave1-e2e.test.tsx` | 8423 |
| `supabase/config.toml` | `files/supabase/config.toml` | 1223 |
| `supabase/deno.lock` | `files/supabase/deno.lock` | 36965 |
| `supabase/functions/_shared/platform_knowledge.ts` | `files/supabase/functions/_shared/platform_knowledge.ts` | 15916 |
| `supabase/functions/_shared/transactional-email-templates/credit-reminder.tsx` | `files/supabase/functions/_shared/transactional-email-templates/credit-reminder.tsx` | 5767 |
| `supabase/functions/_shared/transactional-email-templates/weekly-report.tsx` | `files/supabase/functions/_shared/transactional-email-templates/weekly-report.tsx` | 17906 |
| `supabase/functions/_shared/uber-direct.ts` | `files/supabase/functions/_shared/uber-direct.ts` | 2833 |
| `supabase/functions/ai-chat-unified/_routes/cindy/_prompt.ts` | `files/supabase/functions/ai-chat-unified/_routes/cindy/_prompt.ts` | 9417 |
| `supabase/functions/ai-chat-unified/_routes/cindy/index.ts` | `files/supabase/functions/ai-chat-unified/_routes/cindy/index.ts` | 30855 |
| `supabase/functions/ai-chat-unified/_routes/clara/index.ts` | `files/supabase/functions/ai-chat-unified/_routes/clara/index.ts` | 25990 |
| `supabase/functions/ai-chat-unified/_routes/store/index.ts` | `files/supabase/functions/ai-chat-unified/_routes/store/index.ts` | 19512 |
| `supabase/functions/ai-chat-unified/index.dist.js` | `files/supabase/functions/ai-chat-unified/index.dist.js` | 169582 |
| `supabase/functions/ai-code-editor/index.ts` | `files/supabase/functions/ai-code-editor/index.ts` | 30483 |
| `supabase/functions/ai-media-unified/_routes/generate/index.ts` | `files/supabase/functions/ai-media-unified/_routes/generate/index.ts` | 31500 |
| `supabase/functions/ai-media-unified/_routes/parse-txt/index.ts` | `files/supabase/functions/ai-media-unified/_routes/parse-txt/index.ts` | 13936 |
| `supabase/functions/ai-media-unified/_routes/search/index.ts` | `files/supabase/functions/ai-media-unified/_routes/search/index.ts` | 33798 |
| `supabase/functions/asaas-webhook/index.ts` | `files/supabase/functions/asaas-webhook/index.ts` | 5210 |
| `supabase/functions/auto-test-platform/index.ts` | `files/supabase/functions/auto-test-platform/index.ts` | 20209 |
| `supabase/functions/automations-cron/index.ts` | `files/supabase/functions/automations-cron/index.ts` | 25475 |
| `supabase/functions/calculate-distance/index.ts` | `files/supabase/functions/calculate-distance/index.ts` | 4659 |
| `supabase/functions/chat-cindy/_prompt.ts` | `files/supabase/functions/chat-cindy/_prompt.ts` | 9414 |
| `supabase/functions/chat-cindy/index.ts` | `files/supabase/functions/chat-cindy/index.ts` | 30295 |
| `supabase/functions/chat-sofia/_prompts.ts` | `files/supabase/functions/chat-sofia/_prompts.ts` | 32385 |
| `supabase/functions/chat-sofia/index.ts` | `files/supabase/functions/chat-sofia/index.ts` | 24901 |
| `supabase/functions/clara-agent/index.ts` | `files/supabase/functions/clara-agent/index.ts` | 11467 |
| `supabase/functions/clara-empresarial/index.ts` | `files/supabase/functions/clara-empresarial/index.ts` | 25518 |
| `supabase/functions/code-index/index.ts` | `files/supabase/functions/code-index/index.ts` | 21077 |
| `supabase/functions/code-unified/_routes/editor/index.ts` | `files/supabase/functions/code-unified/_routes/editor/index.ts` | 30074 |
| `supabase/functions/code-unified/_routes/index/index.ts` | `files/supabase/functions/code-unified/_routes/index/index.ts` | 21513 |
| `supabase/functions/create-payment/index.ts` | `files/supabase/functions/create-payment/index.ts` | 17257 |
| `supabase/functions/delivery-unified/_routes/distance/index.ts` | `files/supabase/functions/delivery-unified/_routes/distance/index.ts` | 5106 |
| `supabase/functions/delivery-unified/_routes/quote/index.ts` | `files/supabase/functions/delivery-unified/_routes/quote/index.ts` | 24741 |
| `supabase/functions/delivery-unified/_routes/uber-request/index.ts` | `files/supabase/functions/delivery-unified/_routes/uber-request/index.ts` | 5698 |
| `supabase/functions/demo-data/index.ts` | `files/supabase/functions/demo-data/index.ts` | 14206 |
| `supabase/functions/e2e-platform-test/index.ts` | `files/supabase/functions/e2e-platform-test/index.ts` | 17027 |
| `supabase/functions/emit-nfce/index.ts` | `files/supabase/functions/emit-nfce/index.ts` | 15503 |
| `supabase/functions/finance-unified/_routes/pull-financeflow/index.ts` | `files/supabase/functions/finance-unified/_routes/pull-financeflow/index.ts` | 6654 |
| `supabase/functions/finance-unified/_routes/stats/index.ts` | `files/supabase/functions/finance-unified/_routes/stats/index.ts` | 5053 |
| `supabase/functions/finance-unified/_routes/sync-financeflow/index.ts` | `files/supabase/functions/finance-unified/_routes/sync-financeflow/index.ts` | 9591 |
| `supabase/functions/fiscal-unified/_routes/emit/index.ts` | `files/supabase/functions/fiscal-unified/_routes/emit/index.ts` | 15635 |
| `supabase/functions/fiscal-unified/_routes/generate/index.ts` | `files/supabase/functions/fiscal-unified/_routes/generate/index.ts` | 8949 |
| `supabase/functions/generate-invoices/index.ts` | `files/supabase/functions/generate-invoices/index.ts` | 8502 |
| `supabase/functions/generate-product-image/index.ts` | `files/supabase/functions/generate-product-image/index.ts` | 31059 |
| `supabase/functions/handle-email-suppression/index.ts` | `files/supabase/functions/handle-email-suppression/index.ts` | 6421 |
| `supabase/functions/import-supplier-catalog/index.ts` | `files/supabase/functions/import-supplier-catalog/index.ts` | 28702 |
| `supabase/functions/marketing-post/index.ts` | `files/supabase/functions/marketing-post/index.ts` | 24588 |
| `supabase/functions/marketing-unified/_routes/post/index.ts` | `files/supabase/functions/marketing-unified/_routes/post/index.ts` | 25027 |
| `supabase/functions/mercadopago-webhook/index.ts` | `files/supabase/functions/mercadopago-webhook/index.ts` | 12901 |
| `supabase/functions/mp-reconciliation-cron/index.ts` | `files/supabase/functions/mp-reconciliation-cron/index.ts` | 5296 |
| `supabase/functions/notify-unified/_routes/send-credit/index.ts` | `files/supabase/functions/notify-unified/_routes/send-credit/index.ts` | 3544 |
| `supabase/functions/notify-unified/_routes/suppression/index.ts` | `files/supabase/functions/notify-unified/_routes/suppression/index.ts` | 6863 |
| `supabase/functions/pagbank-webhook/index.ts` | `files/supabase/functions/pagbank-webhook/index.ts` | 4156 |
| `supabase/functions/parse-products-txt/index.ts` | `files/supabase/functions/parse-products-txt/index.ts` | 18337 |
| `supabase/functions/pull-for-financeflow/index.ts` | `files/supabase/functions/pull-for-financeflow/index.ts` | 6197 |
| `supabase/functions/quote-delivery/index.ts` | `files/supabase/functions/quote-delivery/index.ts` | 23948 |
| `supabase/functions/request-uber-delivery/index.ts` | `files/supabase/functions/request-uber-delivery/index.ts` | 5257 |
| `supabase/functions/search-google-images/index.ts` | `files/supabase/functions/search-google-images/index.ts` | 33355 |
| `supabase/functions/send-credit-reminder/index.ts` | `files/supabase/functions/send-credit-reminder/index.ts` | 3097 |
| `supabase/functions/store-agent/index.ts` | `files/supabase/functions/store-agent/index.ts` | 5378 |
| `supabase/functions/store-chat/index.ts` | `files/supabase/functions/store-chat/index.ts` | 20039 |
| `supabase/functions/sync-to-financeflow/index.ts` | `files/supabase/functions/sync-to-financeflow/index.ts` | 9134 |
| `supabase/functions/tenant-usage-stats/index.ts` | `files/supabase/functions/tenant-usage-stats/index.ts` | 4623 |
| `supabase/migrations/20260413035735_d2b1dfc2-9020-49b7-b8e4-071b2b23c88d.sql` | `files/supabase/migrations/20260413035735_d2b1dfc2-9020-49b7-b8e4-071b2b23c88d.sql` | 12797 |
| `supabase/migrations/20260413161718_1bc440cb-38bc-4153-9b11-2a48eaf6249d.sql` | `files/supabase/migrations/20260413161718_1bc440cb-38bc-4153-9b11-2a48eaf6249d.sql` | 74 |
| `supabase/migrations/20260414010320_9bd0d38a-9c9f-4b3f-8ced-9173f0cce0b5.sql` | `files/supabase/migrations/20260414010320_9bd0d38a-9c9f-4b3f-8ced-9173f0cce0b5.sql` | 335 |
| `supabase/migrations/20260414034554_f3a93737-095b-4970-ae33-a6dafa892c93.sql` | `files/supabase/migrations/20260414034554_f3a93737-095b-4970-ae33-a6dafa892c93.sql` | 81 |
| `supabase/migrations/20260415020614_59a45444-ab0f-4a8d-9282-c0b12c3fca18.sql` | `files/supabase/migrations/20260415020614_59a45444-ab0f-4a8d-9282-c0b12c3fca18.sql` | 806 |
| `supabase/migrations/20260415024002_c6d2153e-31e7-4bcf-9a92-8fa2b1e953bf.sql` | `files/supabase/migrations/20260415024002_c6d2153e-31e7-4bcf-9a92-8fa2b1e953bf.sql` | 82 |
| `supabase/migrations/20260415035757_b689da5e-ccef-451c-a974-fc22fbb15821.sql` | `files/supabase/migrations/20260415035757_b689da5e-ccef-451c-a974-fc22fbb15821.sql` | 1260 |
| `supabase/migrations/20260416160715_c6892074-ca0c-47e5-a6a3-47d58162b242.sql` | `files/supabase/migrations/20260416160715_c6892074-ca0c-47e5-a6a3-47d58162b242.sql` | 146 |
| `supabase/migrations/20260417023620_0c2013b8-3680-4506-b74d-8272efe92f54.sql` | `files/supabase/migrations/20260417023620_0c2013b8-3680-4506-b74d-8272efe92f54.sql` | 302 |
| `supabase/migrations/20260418161840_93190f9d-f0ea-41b1-a73c-4abcd6d3f9d0.sql` | `files/supabase/migrations/20260418161840_93190f9d-f0ea-41b1-a73c-4abcd6d3f9d0.sql` | 221 |
| `supabase/migrations/20260419022031_e8b2c278-82b6-45c3-b641-19e90df79c6f.sql` | `files/supabase/migrations/20260419022031_e8b2c278-82b6-45c3-b641-19e90df79c6f.sql` | 617 |
| `supabase/migrations/20260419040036_d40b989f-33cb-41d1-a968-c7772c851ae0.sql` | `files/supabase/migrations/20260419040036_d40b989f-33cb-41d1-a968-c7772c851ae0.sql` | 255 |
| `supabase/migrations/20260420190520_cef99a7a-4eeb-47a9-b921-bede72e16a3e.sql` | `files/supabase/migrations/20260420190520_cef99a7a-4eeb-47a9-b921-bede72e16a3e.sql` | 4475 |
| `supabase/migrations/20260421182809_8f41668a-662a-4d83-ac66-61606c172b74.sql` | `files/supabase/migrations/20260421182809_8f41668a-662a-4d83-ac66-61606c172b74.sql` | 997 |
| `supabase/migrations/20260424154017_003ef601-5d65-41da-96cb-eccfc53faaed.sql` | `files/supabase/migrations/20260424154017_003ef601-5d65-41da-96cb-eccfc53faaed.sql` | 9694 |
| `supabase/migrations/20260424154120_328d48bb-3ec5-4996-b569-f24fc6be7d99.sql` | `files/supabase/migrations/20260424154120_328d48bb-3ec5-4996-b569-f24fc6be7d99.sql` | 1413 |
| `supabase/migrations/20260424154248_9ad9a5f4-d3ab-4acb-ba50-eb8ac7ade269.sql` | `files/supabase/migrations/20260424154248_9ad9a5f4-d3ab-4acb-ba50-eb8ac7ade269.sql` | 4378 |
| `supabase/migrations/20260424155505_f04e6b46-b1f9-488c-8dce-0849d886e17c.sql` | `files/supabase/migrations/20260424155505_f04e6b46-b1f9-488c-8dce-0849d886e17c.sql` | 6567 |
| `supabase/migrations/20260424232345_6f2110a8-a71e-4007-a5a8-d1ff9ab2d39f.sql` | `files/supabase/migrations/20260424232345_6f2110a8-a71e-4007-a5a8-d1ff9ab2d39f.sql` | 1575 |
| `supabase/migrations/20260426000215_2b2083e3-b2a8-4f69-8daa-cb8015e0453d.sql` | `files/supabase/migrations/20260426000215_2b2083e3-b2a8-4f69-8daa-cb8015e0453d.sql` | 2932 |
| `supabase/migrations/20260427100356_fbda29be-90c3-4211-983c-24673070e55f.sql` | `files/supabase/migrations/20260427100356_fbda29be-90c3-4211-983c-24673070e55f.sql` | 802 |
| `supabase/migrations/20260427105115_839a59a3-2df7-4774-8aca-84f8090da600.sql` | `files/supabase/migrations/20260427105115_839a59a3-2df7-4774-8aca-84f8090da600.sql` | 5340 |
| `supabase/migrations/20260428053418_91145d4d-eda2-4254-a59d-45d08a3b89b0.sql` | `files/supabase/migrations/20260428053418_91145d4d-eda2-4254-a59d-45d08a3b89b0.sql` | 2096 |
| `supabase/migrations/20260429234051_9d1b2bf7-949b-4c21-94cb-d2cdbf0a7640.sql` | `files/supabase/migrations/20260429234051_9d1b2bf7-949b-4c21-94cb-d2cdbf0a7640.sql` | 417 |
| `supabase/migrations/20260501193550_655f5cad-d2c0-4242-9055-edfbd44bb14e.sql` | `files/supabase/migrations/20260501193550_655f5cad-d2c0-4242-9055-edfbd44bb14e.sql` | 1699 |
| `supabase/migrations/20260507110514_ba22b530-3b51-4bb6-9e94-932c21a55305.sql` | `files/supabase/migrations/20260507110514_ba22b530-3b51-4bb6-9e94-932c21a55305.sql` | 1396 |
| `supabase/migrations/20260513162324_2f06c77c-a684-4807-9189-569497352e43.sql` | `files/supabase/migrations/20260513162324_2f06c77c-a684-4807-9189-569497352e43.sql` | 937 |
| `supabase/migrations/20260514094422_ae33cd53-42da-4f51-a05f-5580a07a71d1.sql` | `files/supabase/migrations/20260514094422_ae33cd53-42da-4f51-a05f-5580a07a71d1.sql` | 1490 |
| `supabase/migrations/20260524212445_cced1cfe-735f-45d9-bd41-c62bc85bbc95.sql` | `files/supabase/migrations/20260524212445_cced1cfe-735f-45d9-bd41-c62bc85bbc95.sql` | 5111 |
| `supabase/migrations/20260525221617_e48b3649-5866-4674-970e-1186dabe1fde.sql` | `files/supabase/migrations/20260525221617_e48b3649-5866-4674-970e-1186dabe1fde.sql` | 2951 |
| `supabase/migrations/20260525222016_7430dabc-01ed-4993-b9fc-77fb53823db8.sql` | `files/supabase/migrations/20260525222016_7430dabc-01ed-4993-b9fc-77fb53823db8.sql` | 1580 |
| `supabase/migrations/20260526000720_9cf613bf-74a9-4870-b1ac-f3b36a450c7b.sql` | `files/supabase/migrations/20260526000720_9cf613bf-74a9-4870-b1ac-f3b36a450c7b.sql` | 7578 |
| `supabase/migrations/20260526000917_62b92cd8-a9b7-4f63-b5da-54abc8722165.sql` | `files/supabase/migrations/20260526000917_62b92cd8-a9b7-4f63-b5da-54abc8722165.sql` | 2087 |
| `supabase/migrations/20260526002843_7363c0d2-00e4-4dfd-adcf-2d61ebaf3fa6.sql` | `files/supabase/migrations/20260526002843_7363c0d2-00e4-4dfd-adcf-2d61ebaf3fa6.sql` | 8629 |
| `supabase/migrations/20260526020441_55955353-e4c8-4b86-b1bf-a276a26b2ef4.sql` | `files/supabase/migrations/20260526020441_55955353-e4c8-4b86-b1bf-a276a26b2ef4.sql` | 6668 |
| `supabase/migrations/20260526030850_4b88949e-2eff-4753-b499-e125d78e72a0.sql` | `files/supabase/migrations/20260526030850_4b88949e-2eff-4753-b499-e125d78e72a0.sql` | 6355 |
| `supabase/migrations/20260528000445_37c41679-4027-4703-abd2-a58fa930cdf8.sql` | `files/supabase/migrations/20260528000445_37c41679-4027-4703-abd2-a58fa930cdf8.sql` | 7674 |
| `supabase/migrations/20260528012757_214418b1-865e-474b-bc0c-422dd03032bd.sql` | `files/supabase/migrations/20260528012757_214418b1-865e-474b-bc0c-422dd03032bd.sql` | 2172 |
| `supabase/migrations/20260811131505_e2b7465e-ffe8-4f98-8800-df733c57f25d.sql` | `files/supabase/migrations/20260811131505_e2b7465e-ffe8-4f98-8800-df733c57f25d.sql` | 2139 |
| `supabase/migrations/20260811133724_c9ca2370-9704-4eb6-8974-7bb669596182.sql` | `files/supabase/migrations/20260811133724_c9ca2370-9704-4eb6-8974-7bb669596182.sql` | 1793 |
| `supabase/migrations/20260820120000_tenants_public_blocked.sql` | `files/supabase/migrations/20260820120000_tenants_public_blocked.sql` | 1549 |
| `supabase/migrations/20260829130000_seller_control.sql` | `files/supabase/migrations/20260829130000_seller_control.sql` | 5399 |
| `supabase/migrations/20260830045000_fix_seller_module_rls.sql` | `files/supabase/migrations/20260830045000_fix_seller_module_rls.sql` | 3696 |
| `supabase/migrations/20260830113000_expose_demo_payment_public.sql` | `files/supabase/migrations/20260830113000_expose_demo_payment_public.sql` | 1635 |
| `supabase/migrations/20260830114500_fix_public_supplier_shipping_view.sql` | `files/supabase/migrations/20260830114500_fix_public_supplier_shipping_view.sql` | 667 |
| `supabase/migrations/20260902120000_infinitepay_core.sql` | `files/supabase/migrations/20260902120000_infinitepay_core.sql` | 2012 |
| `supabase/migrations/20260903001000_asaas_tenant_tokens.sql` | `files/supabase/migrations/20260903001000_asaas_tenant_tokens.sql` | 559 |
| `supabase/migrations/20260903012000_allow_asaas_provider.sql` | `files/supabase/migrations/20260903012000_allow_asaas_provider.sql` | 237 |
| `supabase/migrations/20260903013000_asaas_customer_document.sql` | `files/supabase/migrations/20260903013000_asaas_customer_document.sql` | 75 |
| `supabase/migrations/20260903014000_expose_asaas_public_status.sql` | `files/supabase/migrations/20260903014000_expose_asaas_public_status.sql` | 1751 |

## Evidência anexada

O log fornecido pelo usuário foi preservado em `files/__attachments__/pasted_content_2.txt`. Ele registra eventos do webhook Asaas, incluindo respostas HTTP 200 após as correções e respostas HTTP 503 históricas.

## Segurança

Tokens de API, chaves privadas, variáveis `.env`, credenciais de produção e valores secretos não foram copiados para este arquivo. O inventário contém código e configuração estrutural para auditoria, não credenciais.
