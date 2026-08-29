export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts_payable_receivable: {
        Row: {
          alert_days_before: number | null
          amount: number
          attachments: Json | null
          category: string | null
          created_at: string
          description: string
          due_date: string
          id: string
          kind: string
          notes: string | null
          paid: boolean
          paid_at: string | null
          payment_method: string | null
          recurrence: string | null
          recurrence_until: string | null
          supplier_or_payer: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          alert_days_before?: number | null
          amount: number
          attachments?: Json | null
          category?: string | null
          created_at?: string
          description: string
          due_date: string
          id?: string
          kind: string
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_method?: string | null
          recurrence?: string | null
          recurrence_until?: string | null
          supplier_or_payer?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          alert_days_before?: number | null
          amount?: number
          attachments?: Json | null
          category?: string | null
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          kind?: string
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_method?: string | null
          recurrence?: string | null
          recurrence_until?: string | null
          supplier_or_payer?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_receivable_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_payable_receivable_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      acquirer_reconciliations: {
        Row: {
          acquirer: string
          actual_settlement_date: string | null
          authorization_code: string | null
          card_brand: string | null
          created_at: string
          divergence_reason: string | null
          expected_settlement_date: string | null
          fee_amount: number | null
          gross_amount: number
          id: string
          imported_at: string
          installments: number | null
          matched_order_id: string | null
          net_amount: number
          nsu: string | null
          raw_data: Json | null
          status: string
          tenant_id: string
          transaction_date: string
          updated_at: string
        }
        Insert: {
          acquirer: string
          actual_settlement_date?: string | null
          authorization_code?: string | null
          card_brand?: string | null
          created_at?: string
          divergence_reason?: string | null
          expected_settlement_date?: string | null
          fee_amount?: number | null
          gross_amount: number
          id?: string
          imported_at?: string
          installments?: number | null
          matched_order_id?: string | null
          net_amount: number
          nsu?: string | null
          raw_data?: Json | null
          status?: string
          tenant_id: string
          transaction_date: string
          updated_at?: string
        }
        Update: {
          acquirer?: string
          actual_settlement_date?: string | null
          authorization_code?: string | null
          card_brand?: string | null
          created_at?: string
          divergence_reason?: string | null
          expected_settlement_date?: string | null
          fee_amount?: number | null
          gross_amount?: number
          id?: string
          imported_at?: string
          installments?: number | null
          matched_order_id?: string | null
          net_amount?: number
          nsu?: string | null
          raw_data?: Json | null
          status?: string
          tenant_id?: string
          transaction_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acquirer_reconciliations_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acquirer_reconciliations_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "orders_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acquirer_reconciliations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acquirer_reconciliations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_clicks: {
        Row: {
          clicked_at: string
          id: string
          ip_hash: string | null
          product_id: string
          referrer: string | null
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          clicked_at?: string
          id?: string
          ip_hash?: string | null
          product_id: string
          referrer?: string | null
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          clicked_at?: string
          id?: string
          ip_hash?: string | null
          product_id?: string
          referrer?: string | null
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      affiliate_match_suggestions: {
        Row: {
          acted_at: string | null
          category: string
          created_at: string
          id: string
          match_score: number
          product_description: string
          product_name: string
          rationale: string | null
          status: string
          suggested_network: string | null
          suggested_url: string | null
          tenant_id: string
        }
        Insert: {
          acted_at?: string | null
          category?: string
          created_at?: string
          id?: string
          match_score?: number
          product_description?: string
          product_name: string
          rationale?: string | null
          status?: string
          suggested_network?: string | null
          suggested_url?: string | null
          tenant_id: string
        }
        Update: {
          acted_at?: string | null
          category?: string
          created_at?: string
          id?: string
          match_score?: number
          product_description?: string
          product_name?: string
          rationale?: string | null
          status?: string
          suggested_network?: string | null
          suggested_url?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      ai_workers: {
        Row: {
          base_url: string
          created_at: string
          exhausted_at: string | null
          id: string
          is_active: boolean
          is_exhausted: boolean
          last_used_at: string | null
          name: string
          promoted_from_generated_id: string | null
          source: string
          updated_at: string
          worker_type: string
        }
        Insert: {
          base_url: string
          created_at?: string
          exhausted_at?: string | null
          id?: string
          is_active?: boolean
          is_exhausted?: boolean
          last_used_at?: string | null
          name?: string
          promoted_from_generated_id?: string | null
          source?: string
          updated_at?: string
          worker_type?: string
        }
        Update: {
          base_url?: string
          created_at?: string
          exhausted_at?: string | null
          id?: string
          is_active?: boolean
          is_exhausted?: boolean
          last_used_at?: string | null
          name?: string
          promoted_from_generated_id?: string | null
          source?: string
          updated_at?: string
          worker_type?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          api_key: string
          created_at: string
          id: string
          is_exhausted: boolean
          last_used_at: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          api_key: string
          created_at?: string
          id?: string
          is_exhausted?: boolean
          last_used_at?: string | null
          provider?: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          id?: string
          is_exhausted?: boolean
          last_used_at?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          actual_end: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          delay_minutes: number
          id: string
          notes: string
          order_id: string
          planned_duration_minutes: number
          product_id: string | null
          product_name: string
          scheduled_start: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          delay_minutes?: number
          id?: string
          notes?: string
          order_id: string
          planned_duration_minutes?: number
          product_id?: string | null
          product_name?: string
          scheduled_start: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          delay_minutes?: number
          id?: string
          notes?: string
          order_id?: string
          planned_duration_minutes?: number
          product_id?: string | null
          product_name?: string
          scheduled_start?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          automation_type: string
          error_message: string | null
          id: string
          metrics: Json
          ran_at: string
          status: string
          tenant_id: string | null
        }
        Insert: {
          automation_type: string
          error_message?: string | null
          id?: string
          metrics?: Json
          ran_at?: string
          status?: string
          tenant_id?: string | null
        }
        Update: {
          automation_type?: string
          error_message?: string | null
          id?: string
          metrics?: Json
          ran_at?: string
          status?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      automation_suggestions: {
        Row: {
          acted_at: string | null
          created_at: string
          description: string
          id: string
          payload: Json
          status: string
          tenant_id: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          acted_at?: string | null
          created_at?: string
          description?: string
          id?: string
          payload?: Json
          status?: string
          tenant_id: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          acted_at?: string | null
          created_at?: string
          description?: string
          id?: string
          payload?: Json
          status?: string
          tenant_id?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_suggestions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_suggestions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoices: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          due_date: string
          id: string
          orders_count: number
          paid_at: string | null
          payment_declared_at: string | null
          payment_note: string | null
          period_end: string
          period_start: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          due_date: string
          id?: string
          orders_count?: number
          paid_at?: string | null
          payment_declared_at?: string | null
          payment_note?: string | null
          period_end: string
          period_start: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          orders_count?: number
          paid_at?: string | null
          payment_declared_at?: string | null
          payment_note?: string | null
          period_end?: string
          period_start?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_sessions: {
        Row: {
          abandoned_notified_at: string | null
          converted_order_id: string | null
          coupon_code: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string
          id: string
          items: Json
          last_activity_at: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          abandoned_notified_at?: string | null
          converted_order_id?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone: string
          id?: string
          items?: Json
          last_activity_at?: string
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          abandoned_notified_at?: string | null
          converted_order_id?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string
          id?: string
          items?: Json
          last_activity_at?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          id: string
          operator_name: string | null
          reason: string | null
          session_id: string
          tenant_id: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          operator_name?: string | null
          reason?: string | null
          session_id: string
          tenant_id: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          operator_name?: string | null
          reason?: string | null
          session_id?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_register_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          notes: string | null
          opened_at: string
          opening_amount: number
          operator_name: string
          operator_role: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_amount?: number
          operator_name: string
          operator_role?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_amount?: number
          operator_name?: string
          operator_role?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_backups: {
        Row: {
          addon_count: number
          created_at: string
          id: string
          product_count: number
          size_bytes: number
          snapshot: Json
          tenant_id: string
          variant_count: number
        }
        Insert: {
          addon_count?: number
          created_at?: string
          id?: string
          product_count?: number
          size_bytes?: number
          snapshot: Json
          tenant_id: string
          variant_count?: number
        }
        Update: {
          addon_count?: number
          created_at?: string
          id?: string
          product_count?: number
          size_bytes?: number
          snapshot?: Json
          tenant_id?: string
          variant_count?: number
        }
        Relationships: []
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          max_uses: number | null
          min_order_value: number
          tenant_id: string
          updated_at: string
          uses_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          discount_type?: string
          discount_value: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          min_order_value?: number
          tenant_id: string
          updated_at?: string
          uses_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          min_order_value?: number
          tenant_id?: string
          updated_at?: string
          uses_count?: number
        }
        Relationships: []
      }
      credit_accounts: {
        Row: {
          amount: number
          amount_paid: number
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string
          description: string
          due_date: string
          id: string
          last_reminder_at: string | null
          notes: string
          paid_at: string | null
          reminders_sent: number
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          amount_paid?: number
          created_at?: string
          customer_email?: string
          customer_name: string
          customer_phone?: string
          description?: string
          due_date: string
          id?: string
          last_reminder_at?: string | null
          notes?: string
          paid_at?: string | null
          reminders_sent?: number
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_paid?: number
          created_at?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          description?: string
          due_date?: string
          id?: string
          last_reminder_at?: string | null
          notes?: string
          paid_at?: string | null
          reminders_sent?: number
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_payments: {
        Row: {
          amount: number
          created_at: string
          credit_account_id: string
          id: string
          note: string
          paid_at: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          credit_account_id: string
          id?: string
          note?: string
          paid_at?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          credit_account_id?: string
          id?: string
          note?: string
          paid_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_payments_credit_account_id_fkey"
            columns: ["credit_account_id"]
            isOneToOne: false
            referencedRelation: "credit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          amount: number
          created_at: string
          due_date: string | null
          id: string
          name: string
          paid: boolean
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date?: string | null
          id?: string
          name: string
          paid?: boolean
          tenant_id: string
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string | null
          id?: string
          name?: string
          paid?: boolean
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_locations: {
        Row: {
          accuracy: number | null
          driver_id: string
          heading: number | null
          id: string
          lat: number
          lng: number
          speed: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          driver_id: string
          heading?: number | null
          id?: string
          lat: number
          lng: number
          speed?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          driver_id?: string
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          speed?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          access_token: string
          active: boolean
          created_at: string
          id: string
          is_online: boolean
          last_online_at: string | null
          name: string
          phone: string
          supplier_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string
          active?: boolean
          created_at?: string
          id?: string
          is_online?: boolean
          last_online_at?: string | null
          name: string
          phone?: string
          supplier_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          active?: boolean
          created_at?: string
          id?: string
          is_online?: boolean
          last_online_at?: string | null
          name?: string
          phone?: string
          supplier_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      email_unsubscribes: {
        Row: {
          email: string
          id: string
          tenant_id: string
          unsubscribed_at: string
        }
        Insert: {
          email: string
          id?: string
          tenant_id: string
          unsubscribed_at?: string
        }
        Update: {
          email?: string
          id?: string
          tenant_id?: string
          unsubscribed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          product_id: string
          requested_percent: number
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          product_id: string
          requested_percent: number
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          product_id?: string
          requested_percent?: number
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      financial_entries: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          description: string
          due_date: string | null
          forecast_date: string | null
          id: string
          is_credit_card: boolean
          is_forecast: boolean
          paid: boolean
          paid_at: string | null
          payment_method: string
          received_at: string | null
          subcategory: string | null
          tenant_id: string
          type: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          date?: string
          description: string
          due_date?: string | null
          forecast_date?: string | null
          id?: string
          is_credit_card?: boolean
          is_forecast?: boolean
          paid?: boolean
          paid_at?: string | null
          payment_method?: string
          received_at?: string | null
          subcategory?: string | null
          tenant_id: string
          type: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          description?: string
          due_date?: string | null
          forecast_date?: string | null
          id?: string
          is_credit_card?: boolean
          is_forecast?: boolean
          paid?: boolean
          paid_at?: string | null
          payment_method?: string
          received_at?: string | null
          subcategory?: string | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_cancellations: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          invoice_id: string | null
          justificativa: string
          kind: string
          numero_final: number | null
          numero_inicial: number | null
          performed_at: string
          performed_by: string | null
          protocolo: string | null
          serie: number | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          justificativa: string
          kind: string
          numero_final?: number | null
          numero_inicial?: number | null
          performed_at?: string
          performed_by?: string | null
          protocolo?: string | null
          serie?: number | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          invoice_id?: string | null
          justificativa?: string
          kind?: string
          numero_final?: number | null
          numero_inicial?: number | null
          performed_at?: string
          performed_by?: string | null
          protocolo?: string | null
          serie?: number | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_cancellations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "fiscal_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_cancellations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_cancellations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_invoices: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          chave_acesso: string | null
          created_at: string
          emitted_at: string | null
          environment: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          numero: number | null
          order_id: string | null
          pdf_url: string | null
          protocolo: string | null
          provider: string
          provider_response: Json | null
          qr_code: string | null
          serie: number | null
          status: string
          tenant_id: string
          tipo: string
          total: number | null
          updated_at: string
          xml_url: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          chave_acesso?: string | null
          created_at?: string
          emitted_at?: string | null
          environment: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          numero?: number | null
          order_id?: string | null
          pdf_url?: string | null
          protocolo?: string | null
          provider: string
          provider_response?: Json | null
          qr_code?: string | null
          serie?: number | null
          status?: string
          tenant_id: string
          tipo?: string
          total?: number | null
          updated_at?: string
          xml_url?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          chave_acesso?: string | null
          created_at?: string
          emitted_at?: string | null
          environment?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          numero?: number | null
          order_id?: string | null
          pdf_url?: string | null
          protocolo?: string | null
          provider?: string
          provider_response?: Json | null
          qr_code?: string | null
          serie?: number | null
          status?: string
          tenant_id?: string
          tipo?: string
          total?: number | null
          updated_at?: string
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_offline_queue: {
        Row: {
          attempts: number
          created_at: string
          emitted_invoice_id: string | null
          enqueued_at: string
          id: string
          last_error: string | null
          order_id: string | null
          payload: Json
          processed_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          emitted_invoice_id?: string | null
          enqueued_at?: string
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload: Json
          processed_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          emitted_invoice_id?: string | null
          enqueued_at?: string
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_offline_queue_emitted_invoice_id_fkey"
            columns: ["emitted_invoice_id"]
            isOneToOne: false
            referencedRelation: "fiscal_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_offline_queue_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_offline_queue_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_offline_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_offline_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_settings: {
        Row: {
          access_token: string | null
          access_token_secret: string | null
          api_token: string | null
          cest_padrao: string | null
          cfop_padrao: string | null
          cnae: string | null
          cnpj: string | null
          consumer_key: string | null
          consumer_secret: string | null
          created_at: string
          csc_id: string | null
          csc_token: string | null
          csosn_padrao: string | null
          cst_padrao: string | null
          enabled: boolean
          endereco_bairro: string | null
          endereco_cep: string | null
          endereco_cidade: string | null
          endereco_codigo_municipio: string | null
          endereco_complemento: string | null
          endereco_logradouro: string | null
          endereco_numero: string | null
          endereco_uf: string | null
          environment: string
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          ncm_padrao: string | null
          nfeio_company_id: string | null
          nome_fantasia: string | null
          offline_mode_enabled: boolean | null
          origem_padrao: string | null
          provider: string
          proximo_numero_nfce: number
          razao_social: string | null
          regime_tributario: string | null
          sat_assinatura_ac: string | null
          sat_codigo_ativacao: string | null
          sat_enabled: boolean | null
          sat_serial: string | null
          serie_nfce: number
          tenant_id: string
          unidade_padrao: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_secret?: string | null
          api_token?: string | null
          cest_padrao?: string | null
          cfop_padrao?: string | null
          cnae?: string | null
          cnpj?: string | null
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          csc_id?: string | null
          csc_token?: string | null
          csosn_padrao?: string | null
          cst_padrao?: string | null
          enabled?: boolean
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_codigo_municipio?: string | null
          endereco_complemento?: string | null
          endereco_logradouro?: string | null
          endereco_numero?: string | null
          endereco_uf?: string | null
          environment?: string
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          ncm_padrao?: string | null
          nfeio_company_id?: string | null
          nome_fantasia?: string | null
          offline_mode_enabled?: boolean | null
          origem_padrao?: string | null
          provider?: string
          proximo_numero_nfce?: number
          razao_social?: string | null
          regime_tributario?: string | null
          sat_assinatura_ac?: string | null
          sat_codigo_ativacao?: string | null
          sat_enabled?: boolean | null
          sat_serial?: string | null
          serie_nfce?: number
          tenant_id: string
          unidade_padrao?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_secret?: string | null
          api_token?: string | null
          cest_padrao?: string | null
          cfop_padrao?: string | null
          cnae?: string | null
          cnpj?: string | null
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          csc_id?: string | null
          csc_token?: string | null
          csosn_padrao?: string | null
          cst_padrao?: string | null
          enabled?: boolean
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_codigo_municipio?: string | null
          endereco_complemento?: string | null
          endereco_logradouro?: string | null
          endereco_numero?: string | null
          endereco_uf?: string | null
          environment?: string
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          ncm_padrao?: string | null
          nfeio_company_id?: string | null
          nome_fantasia?: string | null
          offline_mode_enabled?: boolean | null
          origem_padrao?: string | null
          provider?: string
          proximo_numero_nfce?: number
          razao_social?: string | null
          regime_tributario?: string | null
          sat_assinatura_ac?: string | null
          sat_codigo_ativacao?: string | null
          sat_enabled?: boolean | null
          sat_serial?: string | null
          serie_nfce?: number
          tenant_id?: string
          unidade_padrao?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_blocks: {
        Row: {
          action: string
          created_at: string
          customer_name: string
          customer_phone: string
          id: string
          order_id: string | null
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          risk_score: number
          signals: Json
          tenant_id: string
        }
        Insert: {
          action?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          order_id?: string | null
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          risk_score?: number
          signals?: Json
          tenant_id: string
        }
        Update: {
          action?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string
          id?: string
          order_id?: string | null
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          risk_score?: number
          signals?: Json
          tenant_id?: string
        }
        Relationships: []
      }
      generated_workers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          base_url: string | null
          created_at: string
          current_step: string
          error_code: string | null
          error_message: string | null
          gmail_used: string | null
          id: string
          last_test_at: string | null
          lovable_project_url: string | null
          metadata: Json
          name: string
          progress_percent: number
          promoted_worker_id: string | null
          prompt_used: string | null
          rejected_at: string | null
          rejection_reason: string | null
          session_id: string | null
          status: string
          supabase_project_url: string | null
          test_latency_ms: number | null
          test_passed: boolean | null
          test_response_sample: string | null
          updated_at: string
          worker_type: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          base_url?: string | null
          created_at?: string
          current_step?: string
          error_code?: string | null
          error_message?: string | null
          gmail_used?: string | null
          id?: string
          last_test_at?: string | null
          lovable_project_url?: string | null
          metadata?: Json
          name?: string
          progress_percent?: number
          promoted_worker_id?: string | null
          prompt_used?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          session_id?: string | null
          status?: string
          supabase_project_url?: string | null
          test_latency_ms?: number | null
          test_passed?: boolean | null
          test_response_sample?: string | null
          updated_at?: string
          worker_type?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          base_url?: string | null
          created_at?: string
          current_step?: string
          error_code?: string | null
          error_message?: string | null
          gmail_used?: string | null
          id?: string
          last_test_at?: string | null
          lovable_project_url?: string | null
          metadata?: Json
          name?: string
          progress_percent?: number
          promoted_worker_id?: string | null
          prompt_used?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          session_id?: string | null
          status?: string
          supabase_project_url?: string | null
          test_latency_ms?: number | null
          test_passed?: boolean | null
          test_response_sample?: string | null
          updated_at?: string
          worker_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_workers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "generation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string
          status: string
          total_approved: number
          total_failed: number
          total_generated: number
          total_planned: number
          total_ready: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string
          status?: string
          total_approved?: number
          total_failed?: number
          total_generated?: number
          total_planned?: number
          total_ready?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string
          status?: string
          total_approved?: number
          total_failed?: number
          total_generated?: number
          total_planned?: number
          total_ready?: number
          updated_at?: string
        }
        Relationships: []
      }
      ghost_order_flags: {
        Row: {
          customer_phone: string
          flagged_at: string
          ghost_score: number
          id: string
          notified_at: string | null
          order_id: string
          reason: string
          resolved_at: string | null
          tenant_id: string
        }
        Insert: {
          customer_phone?: string
          flagged_at?: string
          ghost_score?: number
          id?: string
          notified_at?: string | null
          order_id: string
          reason?: string
          resolved_at?: string | null
          tenant_id: string
        }
        Update: {
          customer_phone?: string
          flagged_at?: string
          ghost_score?: number
          id?: string
          notified_at?: string | null
          order_id?: string
          reason?: string
          resolved_at?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      image_generation_jobs: {
        Row: {
          cooldown_until: string | null
          done: number
          failed: number
          finished_at: string | null
          id: string
          message: string
          product_ids: string[]
          reason: string
          started_at: string
          status: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          cooldown_until?: string | null
          done?: number
          failed?: number
          finished_at?: string | null
          id?: string
          message?: string
          product_ids?: string[]
          reason?: string
          started_at?: string
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          cooldown_until?: string | null
          done?: number
          failed?: number
          finished_at?: string | null
          id?: string
          message?: string
          product_ids?: string[]
          reason?: string
          started_at?: string
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      ingredients: {
        Row: {
          cost_per_unit: number
          created_at: string
          id: string
          name: string
          notes: string | null
          stock: number
          stock_min: number
          supplier: string | null
          tenant_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          cost_per_unit?: number
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          stock?: number
          stock_min?: number
          supplier?: string | null
          tenant_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          cost_per_unit?: number
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          stock?: number
          stock_min?: number
          supplier?: string | null
          tenant_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          api_key: string
          created_at: string
          enabled: boolean
          financeflow_url: string
          id: string
          last_sync_at: string | null
          last_sync_error: string
          last_sync_status: string
          sync_orders: boolean
          sync_products: boolean
          sync_stock: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          api_key?: string
          created_at?: string
          enabled?: boolean
          financeflow_url?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string
          last_sync_status?: string
          sync_orders?: boolean
          sync_products?: boolean
          sync_stock?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          enabled?: boolean
          financeflow_url?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string
          last_sync_status?: string
          sync_orders?: boolean
          sync_products?: boolean
          sync_stock?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      investments: {
        Row: {
          amount: number
          created_at: string
          id: string
          kind: string
          liquidated_at: string | null
          matures_at: string | null
          name: string
          notes: string
          started_at: string
          tenant_id: string
          updated_at: string
          yield_rate: number
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          kind?: string
          liquidated_at?: string | null
          matures_at?: string | null
          name: string
          notes?: string
          started_at?: string
          tenant_id: string
          updated_at?: string
          yield_rate?: number
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          kind?: string
          liquidated_at?: string | null
          matures_at?: string | null
          name?: string
          notes?: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
          yield_rate?: number
        }
        Relationships: []
      }
      loyalty_records: {
        Row: {
          address: string
          created_at: string
          id: string
          points: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          points?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          points?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          body_html: string
          coupon_code: string | null
          created_at: string
          error_message: string | null
          failed_count: number | null
          id: string
          preview_text: string | null
          recipients_count: number | null
          scheduled_for: string | null
          segment: string
          sent_at: string | null
          status: string
          subject: string
          succeeded_count: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body_html: string
          coupon_code?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number | null
          id?: string
          preview_text?: string | null
          recipients_count?: number | null
          scheduled_for?: string | null
          segment?: string
          sent_at?: string | null
          status?: string
          subject: string
          succeeded_count?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          coupon_code?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number | null
          id?: string
          preview_text?: string | null
          recipients_count?: number | null
          scheduled_for?: string | null
          segment?: string
          sent_at?: string | null
          status?: string
          subject?: string
          succeeded_count?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_reconciliation_runs: {
        Row: {
          divergences: Json
          divergent: number
          error_message: string | null
          id: string
          matched: number
          payments_checked: number
          period_end: string
          period_start: string
          ran_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          divergences?: Json
          divergent?: number
          error_message?: string | null
          id?: string
          matched?: number
          payments_checked?: number
          period_end: string
          period_start: string
          ran_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          divergences?: Json
          divergent?: number
          error_message?: string | null
          id?: string
          matched?: number
          payments_checked?: number
          period_end?: string
          period_start?: string
          ran_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      nfe_imports: {
        Row: {
          apr_id: string | null
          chave_nfe: string | null
          confidence: Json
          created_at: string
          extracted_data: Json
          id: string
          imported_by: string | null
          source_filename: string | null
          source_type: string
          status: string
          stock_movement_ids: string[] | null
          supplier_id: string | null
          tenant_id: string
          updated_at: string
          user_adjustments: Json
        }
        Insert: {
          apr_id?: string | null
          chave_nfe?: string | null
          confidence?: Json
          created_at?: string
          extracted_data?: Json
          id?: string
          imported_by?: string | null
          source_filename?: string | null
          source_type: string
          status?: string
          stock_movement_ids?: string[] | null
          supplier_id?: string | null
          tenant_id: string
          updated_at?: string
          user_adjustments?: Json
        }
        Update: {
          apr_id?: string | null
          chave_nfe?: string | null
          confidence?: Json
          created_at?: string
          extracted_data?: Json
          id?: string
          imported_by?: string | null
          source_filename?: string | null
          source_type?: string
          status?: string
          stock_movement_ids?: string[] | null
          supplier_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_adjustments?: Json
        }
        Relationships: []
      }
      order_chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          sender_type: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          sender_type: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "order_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      order_chats: {
        Row: {
          created_at: string
          customer_name: string
          customer_phone: string
          customer_session_token: string
          id: string
          last_message_at: string | null
          last_sender: string | null
          order_id: string
          tenant_id: string
          unread_for_customer: number
          unread_for_store: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_name?: string
          customer_phone?: string
          customer_session_token?: string
          id?: string
          last_message_at?: string | null
          last_sender?: string | null
          order_id: string
          tenant_id: string
          unread_for_customer?: number
          unread_for_store?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_name?: string
          customer_phone?: string
          customer_session_token?: string
          id?: string
          last_message_at?: string | null
          last_sender?: string | null
          order_id?: string
          tenant_id?: string
          unread_for_customer?: number
          unread_for_store?: number
          updated_at?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          actor: string
          actor_id: string | null
          created_at: string
          description: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json | null
          order_id: string
          tenant_id: string
          to_status: string | null
        }
        Insert: {
          actor?: string
          actor_id?: string | null
          created_at?: string
          description?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          order_id: string
          tenant_id: string
          to_status?: string | null
        }
        Update: {
          actor?: string
          actor_id?: string | null
          created_at?: string
          description?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string
          tenant_id?: string
          to_status?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          addons: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_qty: number
          created_at: string
          id: string
          notes: string | null
          order_id: string
          product_name: string
          product_price: number
          quantity: number
          variant_name: string | null
        }
        Insert: {
          addons?: Json | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_qty?: number
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          product_name: string
          product_price: number
          quantity?: number
          variant_name?: string | null
        }
        Update: {
          addons?: Json | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_qty?: number
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          product_name?: string
          product_price?: number
          quantity?: number
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_public"
            referencedColumns: ["id"]
          },
        ]
      }
      order_reviews: {
        Row: {
          comment: string
          created_at: string
          id: string
          order_id: string
          rating: number
          supplier_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          comment?: string
          created_at?: string
          id?: string
          order_id: string
          rating: number
          supplier_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          order_id?: string
          rating?: number
          supplier_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          auto_cancelled: boolean
          cancel_reason: string | null
          cash_session_id: string | null
          change_for: number | null
          client_uuid: string | null
          coupon_code: string | null
          created_at: string
          customer_address: string
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_fee: number
          delivery_provider: string | null
          delivery_status_note: string | null
          delivery_type: string
          discount_amount: number
          distance: number | null
          driver_id: string | null
          external_tracking_provider: string | null
          external_tracking_url: string | null
          id: string
          kds_ready_at: string | null
          kds_started_at: string | null
          kds_status: string | null
          lalamove_driver_name: string | null
          lalamove_driver_phone: string | null
          lalamove_driver_plate: string | null
          lalamove_order_id: string | null
          lalamove_payer: string
          lalamove_price: number | null
          lalamove_share_link: string | null
          lalamove_status: string | null
          payment_method: string
          payment_received: boolean
          platform_fee: number
          print_count: number
          printed_at: string | null
          printed_by: string | null
          split_payments: Json | null
          status: string
          supplier_id: string | null
          table_label: string | null
          table_session_id: string | null
          tenant_id: string
          total: number
          uber_direct_delivery_id: string | null
          uber_direct_price: number | null
          uber_direct_status: string | null
          uber_direct_tracking_url: string | null
          updated_at: string
          whatsapp_address_source: string | null
          whatsapp_batch_id: string | null
          whatsapp_sent_at: string | null
        }
        Insert: {
          auto_cancelled?: boolean
          cancel_reason?: string | null
          cash_session_id?: string | null
          change_for?: number | null
          client_uuid?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_address?: string
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          delivery_fee?: number
          delivery_provider?: string | null
          delivery_status_note?: string | null
          delivery_type: string
          discount_amount?: number
          distance?: number | null
          driver_id?: string | null
          external_tracking_provider?: string | null
          external_tracking_url?: string | null
          id?: string
          kds_ready_at?: string | null
          kds_started_at?: string | null
          kds_status?: string | null
          lalamove_driver_name?: string | null
          lalamove_driver_phone?: string | null
          lalamove_driver_plate?: string | null
          lalamove_order_id?: string | null
          lalamove_payer?: string
          lalamove_price?: number | null
          lalamove_share_link?: string | null
          lalamove_status?: string | null
          payment_method: string
          payment_received?: boolean
          platform_fee?: number
          print_count?: number
          printed_at?: string | null
          printed_by?: string | null
          split_payments?: Json | null
          status?: string
          supplier_id?: string | null
          table_label?: string | null
          table_session_id?: string | null
          tenant_id: string
          total: number
          uber_direct_delivery_id?: string | null
          uber_direct_price?: number | null
          uber_direct_status?: string | null
          uber_direct_tracking_url?: string | null
          updated_at?: string
          whatsapp_address_source?: string | null
          whatsapp_batch_id?: string | null
          whatsapp_sent_at?: string | null
        }
        Update: {
          auto_cancelled?: boolean
          cancel_reason?: string | null
          cash_session_id?: string | null
          change_for?: number | null
          client_uuid?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_address?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          delivery_fee?: number
          delivery_provider?: string | null
          delivery_status_note?: string | null
          delivery_type?: string
          discount_amount?: number
          distance?: number | null
          driver_id?: string | null
          external_tracking_provider?: string | null
          external_tracking_url?: string | null
          id?: string
          kds_ready_at?: string | null
          kds_started_at?: string | null
          kds_status?: string | null
          lalamove_driver_name?: string | null
          lalamove_driver_phone?: string | null
          lalamove_driver_plate?: string | null
          lalamove_order_id?: string | null
          lalamove_payer?: string
          lalamove_price?: number | null
          lalamove_share_link?: string | null
          lalamove_status?: string | null
          payment_method?: string
          payment_received?: boolean
          platform_fee?: number
          print_count?: number
          printed_at?: string | null
          printed_by?: string | null
          split_payments?: Json | null
          status?: string
          supplier_id?: string | null
          table_label?: string | null
          table_session_id?: string | null
          tenant_id?: string
          total?: number
          uber_direct_delivery_id?: string | null
          uber_direct_price?: number | null
          uber_direct_status?: string | null
          uber_direct_tracking_url?: string | null
          updated_at?: string
          whatsapp_address_source?: string | null
          whatsapp_batch_id?: string | null
          whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          checkout_url: string | null
          created_at: string
          external_id: string | null
          external_reference: string | null
          id: string
          method: string | null
          order_id: string | null
          pix_qr_code: string | null
          pix_qr_image: string | null
          provider: string
          raw_request: Json | null
          raw_response: Json | null
          raw_webhook: Json | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          checkout_url?: string | null
          created_at?: string
          external_id?: string | null
          external_reference?: string | null
          id?: string
          method?: string | null
          order_id?: string | null
          pix_qr_code?: string | null
          pix_qr_image?: string | null
          provider: string
          raw_request?: Json | null
          raw_response?: Json | null
          raw_webhook?: Json | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          checkout_url?: string | null
          created_at?: string
          external_id?: string | null
          external_reference?: string | null
          id?: string
          method?: string | null
          order_id?: string | null
          pix_qr_code?: string | null
          pix_qr_image?: string | null
          provider?: string
          raw_request?: Json | null
          raw_response?: Json | null
          raw_webhook?: Json | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      product_addons: {
        Row: {
          created_at: string
          id: string
          max_quantity: number
          name: string
          price: number
          product_id: string
          required: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_quantity?: number
          name: string
          price?: number
          product_id: string
          required?: boolean
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_quantity?: number
          name?: string
          price?: number
          product_id?: string
          required?: boolean
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_recipes: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          product_id: string
          quantity: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          product_id: string
          quantity?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          product_id?: string
          quantity?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_recipes_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipes_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients_low_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          created_at: string
          id: string
          in_stock: boolean
          name: string
          price_delta: number
          product_id: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          in_stock?: boolean
          name: string
          price_delta?: number
          product_id: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          in_stock?: boolean
          name?: string
          price_delta?: number
          product_id?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          affiliate_coupon_code: string | null
          affiliate_coupon_discount_price: number | null
          affiliate_coupon_expires_at: string | null
          affiliate_network: string | null
          affiliate_url: string | null
          auto_categorize: boolean
          availability_mode: string
          category: string
          cest: string | null
          cfop: string | null
          created_at: string
          csosn: string | null
          cst: string | null
          description: string
          duration_minutes: number | null
          has_shipping: boolean
          id: string
          image: string
          in_stock: boolean
          item_type: string
          kitchen_sector: string | null
          max_concurrent: number | null
          name: string
          ncm: string | null
          origem: string | null
          original_price: number
          platform_fee_percent: number | null
          price: number
          shipping_fee_override: number | null
          shipping_origin_override: string | null
          stock_quantity: number | null
          subcategory: string
          supplier_id: string | null
          tenant_id: string
          unidade: string | null
          updated_at: string
        }
        Insert: {
          affiliate_coupon_code?: string | null
          affiliate_coupon_discount_price?: number | null
          affiliate_coupon_expires_at?: string | null
          affiliate_network?: string | null
          affiliate_url?: string | null
          auto_categorize?: boolean
          availability_mode?: string
          category?: string
          cest?: string | null
          cfop?: string | null
          created_at?: string
          csosn?: string | null
          cst?: string | null
          description?: string
          duration_minutes?: number | null
          has_shipping?: boolean
          id?: string
          image?: string
          in_stock?: boolean
          item_type?: string
          kitchen_sector?: string | null
          max_concurrent?: number | null
          name: string
          ncm?: string | null
          origem?: string | null
          original_price?: number
          platform_fee_percent?: number | null
          price: number
          shipping_fee_override?: number | null
          shipping_origin_override?: string | null
          stock_quantity?: number | null
          subcategory?: string
          supplier_id?: string | null
          tenant_id: string
          unidade?: string | null
          updated_at?: string
        }
        Update: {
          affiliate_coupon_code?: string | null
          affiliate_coupon_discount_price?: number | null
          affiliate_coupon_expires_at?: string | null
          affiliate_network?: string | null
          affiliate_url?: string | null
          auto_categorize?: boolean
          availability_mode?: string
          category?: string
          cest?: string | null
          cfop?: string | null
          created_at?: string
          csosn?: string | null
          cst?: string | null
          description?: string
          duration_minutes?: number | null
          has_shipping?: boolean
          id?: string
          image?: string
          in_stock?: boolean
          item_type?: string
          kitchen_sector?: string | null
          max_concurrent?: number | null
          name?: string
          ncm?: string | null
          origem?: string | null
          original_price?: number
          platform_fee_percent?: number | null
          price?: number
          shipping_fee_override?: number | null
          shipping_origin_override?: string | null
          stock_quantity?: number | null
          subcategory?: string
          supplier_id?: string | null
          tenant_id?: string
          unidade?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_learnings: {
        Row: {
          conversation_excerpt: Json | null
          created_at: string
          id: string
          key_lesson: string
          niche: string | null
          outcome: string
          pain_signals: string[] | null
          prospect_id: string | null
          weight: number
          what_failed: string | null
          what_worked: string | null
        }
        Insert: {
          conversation_excerpt?: Json | null
          created_at?: string
          id?: string
          key_lesson: string
          niche?: string | null
          outcome: string
          pain_signals?: string[] | null
          prospect_id?: string | null
          weight?: number
          what_failed?: string | null
          what_worked?: string | null
        }
        Update: {
          conversation_excerpt?: Json | null
          created_at?: string
          id?: string
          key_lesson?: string
          niche?: string | null
          outcome?: string
          pain_signals?: string[] | null
          prospect_id?: string | null
          weight?: number
          what_failed?: string | null
          what_worked?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          driver_id: string | null
          endpoint: string
          id: string
          p256dh: string
          supplier_id: string | null
          tenant_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          driver_id?: string | null
          endpoint: string
          id?: string
          p256dh: string
          supplier_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          driver_id?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          supplier_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_packages: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          name: string
          price: number
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name: string
          price?: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name?: string
          price?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_variables: {
        Row: {
          active: boolean
          auto_categorize: boolean
          category: string
          created_at: string
          description: string
          id: string
          max_quantity: number | null
          min_quantity: number
          name: string
          price_per_unit: number
          sort_order: number
          subcategory: string
          tenant_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          auto_categorize?: boolean
          category?: string
          created_at?: string
          description?: string
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          name: string
          price_per_unit?: number
          sort_order?: number
          subcategory?: string
          tenant_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          auto_categorize?: boolean
          category?: string
          created_at?: string
          description?: string
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          name?: string
          price_per_unit?: number
          sort_order?: number
          subcategory?: string
          tenant_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      remote_prospects: {
        Row: {
          address: string | null
          business_name: string
          category: string | null
          city: string | null
          cnpj: string | null
          competitor_stack: string[] | null
          conversation_log: Json
          created_at: string
          created_by: string | null
          description: string | null
          email: string | null
          followup_count: number
          has_instagram: boolean
          has_website: boolean
          hours: string | null
          id: string
          initial_message: string | null
          instagram_handle: string | null
          last_sent_at: string | null
          latitude: number | null
          longitude: number | null
          manual_intel: string | null
          manual_website_url: string | null
          maps_url: string | null
          neighborhood: string | null
          next_followup_at: string | null
          niche: string | null
          notes: string | null
          pain_signals: string[]
          pain_summary: string | null
          phone: string | null
          photos: Json | null
          price_level: number | null
          priority_score: number
          rating: number | null
          raw_data: Json | null
          region: string | null
          review_notes: string | null
          reviews_count: number | null
          reviews_sample: Json
          reviews_scraped_at: string | null
          scrape_source: string | null
          sector: string | null
          source: string | null
          stack_scraped_at: string | null
          stack_summary: string | null
          state: string | null
          status: string
          updated_at: string
          website_url: string | null
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          business_name: string
          category?: string | null
          city?: string | null
          cnpj?: string | null
          competitor_stack?: string[] | null
          conversation_log?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          email?: string | null
          followup_count?: number
          has_instagram?: boolean
          has_website?: boolean
          hours?: string | null
          id?: string
          initial_message?: string | null
          instagram_handle?: string | null
          last_sent_at?: string | null
          latitude?: number | null
          longitude?: number | null
          manual_intel?: string | null
          manual_website_url?: string | null
          maps_url?: string | null
          neighborhood?: string | null
          next_followup_at?: string | null
          niche?: string | null
          notes?: string | null
          pain_signals?: string[]
          pain_summary?: string | null
          phone?: string | null
          photos?: Json | null
          price_level?: number | null
          priority_score?: number
          rating?: number | null
          raw_data?: Json | null
          region?: string | null
          review_notes?: string | null
          reviews_count?: number | null
          reviews_sample?: Json
          reviews_scraped_at?: string | null
          scrape_source?: string | null
          sector?: string | null
          source?: string | null
          stack_scraped_at?: string | null
          stack_summary?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          website_url?: string | null
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          business_name?: string
          category?: string | null
          city?: string | null
          cnpj?: string | null
          competitor_stack?: string[] | null
          conversation_log?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          email?: string | null
          followup_count?: number
          has_instagram?: boolean
          has_website?: boolean
          hours?: string | null
          id?: string
          initial_message?: string | null
          instagram_handle?: string | null
          last_sent_at?: string | null
          latitude?: number | null
          longitude?: number | null
          manual_intel?: string | null
          manual_website_url?: string | null
          maps_url?: string | null
          neighborhood?: string | null
          next_followup_at?: string | null
          niche?: string | null
          notes?: string | null
          pain_signals?: string[]
          pain_summary?: string | null
          phone?: string | null
          photos?: Json | null
          price_level?: number | null
          priority_score?: number
          rating?: number | null
          raw_data?: Json | null
          region?: string | null
          review_notes?: string | null
          reviews_count?: number | null
          reviews_sample?: Json
          reviews_scraped_at?: string | null
          scrape_source?: string | null
          sector?: string | null
          source?: string | null
          stack_scraped_at?: string | null
          stack_summary?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          website_url?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      restaurant_tables: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          label: string
          seats: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          label: string
          seats?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          label?: string
          seats?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          created_at: string
          customer_name: string
          id: string
          message: string
          resolved_at: string | null
          session_id: string
          status: string
          table_id: string
          table_label: string
          tenant_id: string
          waiter_id: string | null
        }
        Insert: {
          created_at?: string
          customer_name?: string
          id?: string
          message?: string
          resolved_at?: string | null
          session_id: string
          status?: string
          table_id: string
          table_label: string
          tenant_id: string
          waiter_id?: string | null
        }
        Update: {
          created_at?: string
          customer_name?: string
          id?: string
          message?: string
          resolved_at?: string | null
          session_id?: string
          status?: string
          table_id?: string
          table_label?: string
          tenant_id?: string
          waiter_id?: string | null
        }
        Relationships: []
      }
      stock_counts: {
        Row: {
          counted_qty: number
          created_at: string
          difference: number | null
          id: string
          ingredient_id: string
          notes: string | null
          operator_name: string | null
          photo_url: string | null
          system_qty: number
          tenant_id: string
        }
        Insert: {
          counted_qty: number
          created_at?: string
          difference?: number | null
          id?: string
          ingredient_id: string
          notes?: string | null
          operator_name?: string | null
          photo_url?: string | null
          system_qty: number
          tenant_id: string
        }
        Update: {
          counted_qty?: number
          created_at?: string
          difference?: number | null
          id?: string
          ingredient_id?: string
          notes?: string | null
          operator_name?: string | null
          photo_url?: string | null
          system_qty?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients_low_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          batch_code: string | null
          created_at: string
          expires_at: string | null
          id: string
          ingredient_id: string
          operator_name: string | null
          order_id: string | null
          quantity: number
          reason: string | null
          tenant_id: string
          type: string
          unit_cost: number | null
        }
        Insert: {
          batch_code?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id: string
          operator_name?: string | null
          order_id?: string | null
          quantity: number
          reason?: string | null
          tenant_id: string
          type: string
          unit_cost?: number | null
        }
        Update: {
          batch_code?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          ingredient_id?: string
          operator_name?: string | null
          order_id?: string | null
          quantity?: number
          reason?: string | null
          tenant_id?: string
          type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients_low_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      street_prospects: {
        Row: {
          ai_draft: string | null
          ai_review_notes: string | null
          chosen_plan: string | null
          contact_phone: string | null
          conversation_log: Json
          created_at: string
          has_contact: boolean
          id: string
          last_analysis_at: string | null
          liked_point: string | null
          manual_intel: string | null
          message_sent: boolean
          notes: string | null
          outcome: string | null
          pasted_history: string | null
          refusal_reason: string | null
          reminder_at: string | null
          responded: boolean
          status: string
          store_name: string
          street_name: string
          suggested_next_message: string | null
          tags: Json
          updated_at: string
          visited_at: string
        }
        Insert: {
          ai_draft?: string | null
          ai_review_notes?: string | null
          chosen_plan?: string | null
          contact_phone?: string | null
          conversation_log?: Json
          created_at?: string
          has_contact?: boolean
          id?: string
          last_analysis_at?: string | null
          liked_point?: string | null
          manual_intel?: string | null
          message_sent?: boolean
          notes?: string | null
          outcome?: string | null
          pasted_history?: string | null
          refusal_reason?: string | null
          reminder_at?: string | null
          responded?: boolean
          status?: string
          store_name: string
          street_name: string
          suggested_next_message?: string | null
          tags?: Json
          updated_at?: string
          visited_at?: string
        }
        Update: {
          ai_draft?: string | null
          ai_review_notes?: string | null
          chosen_plan?: string | null
          contact_phone?: string | null
          conversation_log?: Json
          created_at?: string
          has_contact?: boolean
          id?: string
          last_analysis_at?: string | null
          liked_point?: string | null
          manual_intel?: string | null
          message_sent?: boolean
          notes?: string | null
          outcome?: string | null
          pasted_history?: string | null
          refusal_reason?: string | null
          reminder_at?: string | null
          responded?: boolean
          status?: string
          store_name?: string
          street_name?: string
          suggested_next_message?: string | null
          tags?: Json
          updated_at?: string
          visited_at?: string
        }
        Relationships: []
      }
      supplier_chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          is_filtered: boolean
          original_content: string | null
          sender_type: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          is_filtered?: boolean
          original_content?: string | null
          sender_type: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          is_filtered?: boolean
          original_content?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "supplier_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_chats: {
        Row: {
          created_at: string
          customer_name: string
          customer_session_token: string
          id: string
          is_active: boolean
          product_id: string
          supplier_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_name?: string
          customer_session_token?: string
          id?: string
          is_active?: boolean
          product_id: string
          supplier_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_name?: string
          customer_session_token?: string
          id?: string
          is_active?: boolean
          product_id?: string
          supplier_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_chats_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_chats_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_chats_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_chats_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_chats_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          access_token: string
          active: boolean
          address: string
          created_at: string
          delivery_max_radius_km: number
          id: string
          lalamove_api_key: string | null
          lalamove_api_secret: string | null
          lalamove_market: string | null
          lalamove_sandbox: boolean
          lalamove_use_store_api: string
          name: string
          phone: string
          responsible_for_delivery: boolean
          shipping_base_fee: number
          shipping_base_radius_km: number
          shipping_max_fee: number | null
          shipping_mode: string
          shipping_per_km_fee: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string
          active?: boolean
          address?: string
          created_at?: string
          delivery_max_radius_km?: number
          id?: string
          lalamove_api_key?: string | null
          lalamove_api_secret?: string | null
          lalamove_market?: string | null
          lalamove_sandbox?: boolean
          lalamove_use_store_api?: string
          name: string
          phone?: string
          responsible_for_delivery?: boolean
          shipping_base_fee?: number
          shipping_base_radius_km?: number
          shipping_max_fee?: number | null
          shipping_mode?: string
          shipping_per_km_fee?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          active?: boolean
          address?: string
          created_at?: string
          delivery_max_radius_km?: number
          id?: string
          lalamove_api_key?: string | null
          lalamove_api_secret?: string | null
          lalamove_market?: string | null
          lalamove_sandbox?: boolean
          lalamove_use_store_api?: string
          name?: string
          phone?: string
          responsible_for_delivery?: boolean
          shipping_base_fee?: number
          shipping_base_radius_km?: number
          shipping_max_fee?: number | null
          shipping_mode?: string
          shipping_per_km_fee?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          sender_name: string | null
          sender_type: string
          ticket_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          sender_name?: string | null
          sender_type: string
          ticket_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          sender_name?: string | null
          sender_type?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          priority: string
          resolution: string | null
          resolved_at: string | null
          status: string
          subject: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          priority?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          subject: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          priority?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          subject?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      table_session_items: {
        Row: {
          added_by: string
          addons: Json
          created_at: string
          id: string
          notes: string
          product_id: string | null
          product_name: string
          product_price: number
          quantity: number
          session_id: string
          tab_label: string | null
          tenant_id: string
          variant_name: string | null
          version: number
        }
        Insert: {
          added_by?: string
          addons?: Json
          created_at?: string
          id?: string
          notes?: string
          product_id?: string | null
          product_name: string
          product_price: number
          quantity?: number
          session_id: string
          tab_label?: string | null
          tenant_id: string
          variant_name?: string | null
          version?: number
        }
        Update: {
          added_by?: string
          addons?: Json
          created_at?: string
          id?: string
          notes?: string
          product_id?: string | null
          product_name?: string
          product_price?: number
          quantity?: number
          session_id?: string
          tab_label?: string | null
          tenant_id?: string
          variant_name?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "table_session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      table_session_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          note: string
          operator_name: string
          paid_at: string
          payer_name: string
          session_id: string
          tab_label: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: string
          note?: string
          operator_name?: string
          paid_at?: string
          payer_name?: string
          session_id: string
          tab_label?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          note?: string
          operator_name?: string
          paid_at?: string
          payer_name?: string
          session_id?: string
          tab_label?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_session_payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_session_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_session_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          assigned_waiter_id: string | null
          assigned_waiter_name: string | null
          created_at: string
          customer_name: string
          id: string
          merged_into_session_id: string | null
          opened_at: string
          opened_by: string
          order_id: string | null
          owner_device_id: string | null
          paid_at: string | null
          sent_at: string | null
          share_code: string | null
          status: string
          table_id: string
          table_label: string
          tenant_id: string
          total: number
          updated_at: string
          version: number
        }
        Insert: {
          assigned_waiter_id?: string | null
          assigned_waiter_name?: string | null
          created_at?: string
          customer_name?: string
          id?: string
          merged_into_session_id?: string | null
          opened_at?: string
          opened_by?: string
          order_id?: string | null
          owner_device_id?: string | null
          paid_at?: string | null
          sent_at?: string | null
          share_code?: string | null
          status?: string
          table_id: string
          table_label: string
          tenant_id: string
          total?: number
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_waiter_id?: string | null
          assigned_waiter_name?: string | null
          created_at?: string
          customer_name?: string
          id?: string
          merged_into_session_id?: string | null
          opened_at?: string
          opened_by?: string
          order_id?: string | null
          owner_device_id?: string | null
          paid_at?: string | null
          sent_at?: string | null
          share_code?: string | null
          status?: string
          table_id?: string
          table_label?: string
          tenant_id?: string
          total?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_merged_into_session_id_fkey"
            columns: ["merged_into_session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          abandoned_cart_email_enabled: boolean
          active: boolean
          address: string
          admin_tabs_config: Json
          admin_theme_mode: string | null
          auto_abandon_coupon: boolean
          auto_affiliate_match: boolean
          auto_backup_catalog: boolean
          auto_cancel_pending_minutes: number
          auto_cancel_pending_payment: boolean
          auto_categorize_nightly: boolean
          auto_combo_suggestion: boolean
          auto_confirm_card_payments: boolean
          auto_confirm_paid_orders: boolean
          auto_credit_reminders: boolean
          auto_detect_ghost_orders: boolean
          auto_dropshipping_enabled: boolean
          auto_fraud_check: boolean
          auto_log_platform_fee: boolean
          auto_low_stock_promo: boolean
          auto_peak_alert: boolean
          auto_phantom_alert: boolean
          auto_phantom_minutes: number
          auto_reconcile_mp: boolean
          auto_reorder_catalog: boolean
          auto_review_ai_reply: boolean
          auto_review_response: boolean
          auto_weekly_report: boolean
          billing_blocked_until: string | null
          billing_degraded_at: string | null
          billing_email: string | null
          billing_frequency: string
          billing_grace_days: number
          billing_mode: string
          billing_status: string
          billing_suspended_at: string | null
          billing_warning_sent_at: string | null
          blocked: boolean
          blocked_at: string | null
          blocked_reason: string | null
          brand_bg_color: string
          brand_primary_color: string
          brevo_sender_email: string | null
          brevo_sender_name: string | null
          catalog_layout: string
          created_at: string
          delivery_max_radius_km: number
          delivery_mode: number
          delivery_responsible: string
          demo_payment_enabled: boolean
          description: string | null
          dropshipping_freight_mode: string
          dropshipping_review_mode: boolean
          dropshipping_submode: string
          fee_mode: string
          fee_split_store_percent: number
          fraud_strictness: string
          id: string
          is_donated: boolean
          is_dropshipping: boolean
          lalamove_api_key: string | null
          lalamove_api_secret: string | null
          lalamove_enabled: boolean
          lalamove_market: string | null
          lalamove_sandbox: boolean
          last_invoice_at: string | null
          logo_url: string | null
          marketing_emails_enabled: boolean
          mercadopago_token: string | null
          monthly_fee: number
          name: string
          niche: string | null
          pagbank_env: string
          pagbank_token: string | null
          payment_provider: string
          phone: string | null
          pickup_enabled: boolean
          pix_key: string | null
          pix_key_type: string | null
          platform_fee: number
          platform_fee_percent: number
          printer_agent_token: string
          printer_enabled: boolean
          printer_footer_text: string
          printer_header_text: string
          printer_kitchen_copy: boolean
          printer_mode: string
          printer_paper_width: string
          promo_active: boolean
          promo_text: string
          promo_title: string
          quotes_enabled: boolean
          quotes_feature_enabled: boolean
          quotes_intro_text: string
          require_customer_email: boolean
          scheduling_auto_confirm: boolean
          scheduling_capacity: number
          scheduling_close_time: string
          scheduling_enabled: boolean
          scheduling_open_days: number[]
          scheduling_open_time: string
          scheduling_slot_minutes: number
          shipping_base_fee: number
          shipping_base_radius_km: number
          shipping_enabled: boolean
          shipping_lalamove_apply_cap: boolean
          shipping_lalamove_auto: boolean
          shipping_lalamove_margin_percent: number
          shipping_max_fee: number | null
          shipping_mode: string
          shipping_origin_address: string
          shipping_per_km_fee: number
          slug: string
          sound_alert_enabled: boolean
          sound_alert_loud: boolean
          splash_bg_color: string
          store_mode: string
          storefront_config: Json
          tables_enabled: boolean
          transactional_emails_enabled: boolean
          uber_direct_client_id: string | null
          uber_direct_client_secret: string | null
          uber_direct_customer_id: string | null
          uber_direct_enabled: boolean | null
          uber_direct_sandbox: boolean | null
          uber_direct_use_platform_keys: boolean
          updated_at: string
          waiter_access_token: string
          whatsapp: string | null
          whatsapp_checkout_note: string | null
          whatsapp_consultora_phone: string
          whatsapp_default_address_source: string
          whatsapp_show_pix: boolean
          whatsapp_store_address: string
          whatsapp_store_cep: string
        }
        Insert: {
          abandoned_cart_email_enabled?: boolean
          active?: boolean
          address?: string
          admin_tabs_config?: Json
          admin_theme_mode?: string | null
          auto_abandon_coupon?: boolean
          auto_affiliate_match?: boolean
          auto_backup_catalog?: boolean
          auto_cancel_pending_minutes?: number
          auto_cancel_pending_payment?: boolean
          auto_categorize_nightly?: boolean
          auto_combo_suggestion?: boolean
          auto_confirm_card_payments?: boolean
          auto_confirm_paid_orders?: boolean
          auto_credit_reminders?: boolean
          auto_detect_ghost_orders?: boolean
          auto_dropshipping_enabled?: boolean
          auto_fraud_check?: boolean
          auto_log_platform_fee?: boolean
          auto_low_stock_promo?: boolean
          auto_peak_alert?: boolean
          auto_phantom_alert?: boolean
          auto_phantom_minutes?: number
          auto_reconcile_mp?: boolean
          auto_reorder_catalog?: boolean
          auto_review_ai_reply?: boolean
          auto_review_response?: boolean
          auto_weekly_report?: boolean
          billing_blocked_until?: string | null
          billing_degraded_at?: string | null
          billing_email?: string | null
          billing_frequency?: string
          billing_grace_days?: number
          billing_mode?: string
          billing_status?: string
          billing_suspended_at?: string | null
          billing_warning_sent_at?: string | null
          blocked?: boolean
          blocked_at?: string | null
          blocked_reason?: string | null
          brand_bg_color?: string
          brand_primary_color?: string
          brevo_sender_email?: string | null
          brevo_sender_name?: string | null
          catalog_layout?: string
          created_at?: string
          delivery_max_radius_km?: number
          delivery_mode?: number
          delivery_responsible?: string
          demo_payment_enabled?: boolean
          description?: string | null
          dropshipping_freight_mode?: string
          dropshipping_review_mode?: boolean
          dropshipping_submode?: string
          fee_mode?: string
          fee_split_store_percent?: number
          fraud_strictness?: string
          id?: string
          is_donated?: boolean
          is_dropshipping?: boolean
          lalamove_api_key?: string | null
          lalamove_api_secret?: string | null
          lalamove_enabled?: boolean
          lalamove_market?: string | null
          lalamove_sandbox?: boolean
          last_invoice_at?: string | null
          logo_url?: string | null
          marketing_emails_enabled?: boolean
          mercadopago_token?: string | null
          monthly_fee?: number
          name: string
          niche?: string | null
          pagbank_env?: string
          pagbank_token?: string | null
          payment_provider?: string
          phone?: string | null
          pickup_enabled?: boolean
          pix_key?: string | null
          pix_key_type?: string | null
          platform_fee?: number
          platform_fee_percent?: number
          printer_agent_token?: string
          printer_enabled?: boolean
          printer_footer_text?: string
          printer_header_text?: string
          printer_kitchen_copy?: boolean
          printer_mode?: string
          printer_paper_width?: string
          promo_active?: boolean
          promo_text?: string
          promo_title?: string
          quotes_enabled?: boolean
          quotes_feature_enabled?: boolean
          quotes_intro_text?: string
          require_customer_email?: boolean
          scheduling_auto_confirm?: boolean
          scheduling_capacity?: number
          scheduling_close_time?: string
          scheduling_enabled?: boolean
          scheduling_open_days?: number[]
          scheduling_open_time?: string
          scheduling_slot_minutes?: number
          shipping_base_fee?: number
          shipping_base_radius_km?: number
          shipping_enabled?: boolean
          shipping_lalamove_apply_cap?: boolean
          shipping_lalamove_auto?: boolean
          shipping_lalamove_margin_percent?: number
          shipping_max_fee?: number | null
          shipping_mode?: string
          shipping_origin_address?: string
          shipping_per_km_fee?: number
          slug: string
          sound_alert_enabled?: boolean
          sound_alert_loud?: boolean
          splash_bg_color?: string
          store_mode?: string
          storefront_config?: Json
          tables_enabled?: boolean
          transactional_emails_enabled?: boolean
          uber_direct_client_id?: string | null
          uber_direct_client_secret?: string | null
          uber_direct_customer_id?: string | null
          uber_direct_enabled?: boolean | null
          uber_direct_sandbox?: boolean | null
          uber_direct_use_platform_keys?: boolean
          updated_at?: string
          waiter_access_token?: string
          whatsapp?: string | null
          whatsapp_checkout_note?: string | null
          whatsapp_consultora_phone?: string
          whatsapp_default_address_source?: string
          whatsapp_show_pix?: boolean
          whatsapp_store_address?: string
          whatsapp_store_cep?: string
        }
        Update: {
          abandoned_cart_email_enabled?: boolean
          active?: boolean
          address?: string
          admin_tabs_config?: Json
          admin_theme_mode?: string | null
          auto_abandon_coupon?: boolean
          auto_affiliate_match?: boolean
          auto_backup_catalog?: boolean
          auto_cancel_pending_minutes?: number
          auto_cancel_pending_payment?: boolean
          auto_categorize_nightly?: boolean
          auto_combo_suggestion?: boolean
          auto_confirm_card_payments?: boolean
          auto_confirm_paid_orders?: boolean
          auto_credit_reminders?: boolean
          auto_detect_ghost_orders?: boolean
          auto_dropshipping_enabled?: boolean
          auto_fraud_check?: boolean
          auto_log_platform_fee?: boolean
          auto_low_stock_promo?: boolean
          auto_peak_alert?: boolean
          auto_phantom_alert?: boolean
          auto_phantom_minutes?: number
          auto_reconcile_mp?: boolean
          auto_reorder_catalog?: boolean
          auto_review_ai_reply?: boolean
          auto_review_response?: boolean
          auto_weekly_report?: boolean
          billing_blocked_until?: string | null
          billing_degraded_at?: string | null
          billing_email?: string | null
          billing_frequency?: string
          billing_grace_days?: number
          billing_mode?: string
          billing_status?: string
          billing_suspended_at?: string | null
          billing_warning_sent_at?: string | null
          blocked?: boolean
          blocked_at?: string | null
          blocked_reason?: string | null
          brand_bg_color?: string
          brand_primary_color?: string
          brevo_sender_email?: string | null
          brevo_sender_name?: string | null
          catalog_layout?: string
          created_at?: string
          delivery_max_radius_km?: number
          delivery_mode?: number
          delivery_responsible?: string
          demo_payment_enabled?: boolean
          description?: string | null
          dropshipping_freight_mode?: string
          dropshipping_review_mode?: boolean
          dropshipping_submode?: string
          fee_mode?: string
          fee_split_store_percent?: number
          fraud_strictness?: string
          id?: string
          is_donated?: boolean
          is_dropshipping?: boolean
          lalamove_api_key?: string | null
          lalamove_api_secret?: string | null
          lalamove_enabled?: boolean
          lalamove_market?: string | null
          lalamove_sandbox?: boolean
          last_invoice_at?: string | null
          logo_url?: string | null
          marketing_emails_enabled?: boolean
          mercadopago_token?: string | null
          monthly_fee?: number
          name?: string
          niche?: string | null
          pagbank_env?: string
          pagbank_token?: string | null
          payment_provider?: string
          phone?: string | null
          pickup_enabled?: boolean
          pix_key?: string | null
          pix_key_type?: string | null
          platform_fee?: number
          platform_fee_percent?: number
          printer_agent_token?: string
          printer_enabled?: boolean
          printer_footer_text?: string
          printer_header_text?: string
          printer_kitchen_copy?: boolean
          printer_mode?: string
          printer_paper_width?: string
          promo_active?: boolean
          promo_text?: string
          promo_title?: string
          quotes_enabled?: boolean
          quotes_feature_enabled?: boolean
          quotes_intro_text?: string
          require_customer_email?: boolean
          scheduling_auto_confirm?: boolean
          scheduling_capacity?: number
          scheduling_close_time?: string
          scheduling_enabled?: boolean
          scheduling_open_days?: number[]
          scheduling_open_time?: string
          scheduling_slot_minutes?: number
          shipping_base_fee?: number
          shipping_base_radius_km?: number
          shipping_enabled?: boolean
          shipping_lalamove_apply_cap?: boolean
          shipping_lalamove_auto?: boolean
          shipping_lalamove_margin_percent?: number
          shipping_max_fee?: number | null
          shipping_mode?: string
          shipping_origin_address?: string
          shipping_per_km_fee?: number
          slug?: string
          sound_alert_enabled?: boolean
          sound_alert_loud?: boolean
          splash_bg_color?: string
          store_mode?: string
          storefront_config?: Json
          tables_enabled?: boolean
          transactional_emails_enabled?: boolean
          uber_direct_client_id?: string | null
          uber_direct_client_secret?: string | null
          uber_direct_customer_id?: string | null
          uber_direct_enabled?: boolean | null
          uber_direct_sandbox?: boolean | null
          uber_direct_use_platform_keys?: boolean
          updated_at?: string
          waiter_access_token?: string
          whatsapp?: string | null
          whatsapp_checkout_note?: string | null
          whatsapp_consultora_phone?: string
          whatsapp_default_address_source?: string
          whatsapp_show_pix?: boolean
          whatsapp_store_address?: string
          whatsapp_store_cep?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          approved: boolean
          created_at: string
          email: string | null
          id: string
          pin_code: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email?: string | null
          id?: string
          pin_code?: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string | null
          id?: string
          pin_code?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      waiters: {
        Row: {
          access_token: string
          active: boolean
          commission_percent: number
          created_at: string
          id: string
          last_assigned_at: string | null
          last_online_at: string | null
          name: string
          online: boolean
          pin_code: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string
          active?: boolean
          commission_percent?: number
          created_at?: string
          id?: string
          last_assigned_at?: string | null
          last_online_at?: string | null
          name: string
          online?: boolean
          pin_code?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          active?: boolean
          commission_percent?: number
          created_at?: string
          id?: string
          last_assigned_at?: string | null
          last_online_at?: string | null
          name?: string
          online?: boolean
          pin_code?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string | null
          id: string
          order_id: string | null
          payload: Json | null
          processed_at: string
          provider: string
          result: Json | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type?: string | null
          id?: string
          order_id?: string | null
          payload?: Json | null
          processed_at?: string
          provider: string
          result?: Json | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string | null
          id?: string
          order_id?: string | null
          payload?: Json | null
          processed_at?: string
          provider?: string
          result?: Json | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      worker_test_logs: {
        Row: {
          created_at: string
          error_message: string | null
          generated_worker_id: string
          http_status: number | null
          id: string
          latency_ms: number | null
          response_sample: string | null
          success: boolean
          test_type: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          generated_worker_id: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          response_sample?: string | null
          success?: boolean
          test_type?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          generated_worker_id?: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          response_sample?: string | null
          success?: boolean
          test_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_test_logs_generated_worker_id_fkey"
            columns: ["generated_worker_id"]
            isOneToOne: false
            referencedRelation: "generated_workers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      appointments_public: {
        Row: {
          actual_end: string | null
          created_at: string | null
          delay_minutes: number | null
          id: string | null
          order_id: string | null
          planned_duration_minutes: number | null
          product_id: string | null
          product_name: string | null
          scheduled_start: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          actual_end?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          id?: string | null
          order_id?: string | null
          planned_duration_minutes?: number | null
          product_id?: string | null
          product_name?: string | null
          scheduled_start?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_end?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          id?: string | null
          order_id?: string | null
          planned_duration_minutes?: number | null
          product_id?: string | null
          product_name?: string | null
          scheduled_start?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      drivers_public: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string | null
          is_online: boolean | null
          last_online_at: string | null
          name: string | null
          supplier_id: string | null
          tenant_id: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string | null
          is_online?: boolean | null
          last_online_at?: string | null
          name?: string | null
          supplier_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string | null
          is_online?: boolean | null
          last_online_at?: string | null
          name?: string | null
          supplier_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients_low_stock: {
        Row: {
          cost_per_unit: number | null
          created_at: string | null
          id: string | null
          name: string | null
          notes: string | null
          shortage: number | null
          stock: number | null
          stock_min: number | null
          supplier: string | null
          tenant_id: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          cost_per_unit?: number | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          shortage?: never
          stock?: number | null
          stock_min?: number | null
          supplier?: string | null
          tenant_id?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          cost_per_unit?: number | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          shortage?: never
          stock?: number | null
          stock_min?: number | null
          supplier?: string | null
          tenant_id?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      orders_public: {
        Row: {
          change_for: number | null
          coupon_code: string | null
          created_at: string | null
          customer_address: string | null
          customer_name: string | null
          delivery_fee: number | null
          delivery_status_note: string | null
          delivery_type: string | null
          discount_amount: number | null
          distance: number | null
          driver_id: string | null
          external_tracking_provider: string | null
          external_tracking_url: string | null
          id: string | null
          lalamove_driver_name: string | null
          lalamove_driver_plate: string | null
          lalamove_share_link: string | null
          lalamove_status: string | null
          payment_method: string | null
          print_count: number | null
          printed_at: string | null
          status: string | null
          supplier_id: string | null
          tenant_id: string | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          change_for?: number | null
          coupon_code?: string | null
          created_at?: string | null
          customer_address?: string | null
          customer_name?: string | null
          delivery_fee?: number | null
          delivery_status_note?: string | null
          delivery_type?: string | null
          discount_amount?: number | null
          distance?: number | null
          driver_id?: string | null
          external_tracking_provider?: string | null
          external_tracking_url?: string | null
          id?: string | null
          lalamove_driver_name?: string | null
          lalamove_driver_plate?: string | null
          lalamove_share_link?: string | null
          lalamove_status?: string | null
          payment_method?: string | null
          print_count?: number | null
          printed_at?: string | null
          status?: string | null
          supplier_id?: string | null
          tenant_id?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          change_for?: number | null
          coupon_code?: string | null
          created_at?: string | null
          customer_address?: string | null
          customer_name?: string | null
          delivery_fee?: number | null
          delivery_status_note?: string | null
          delivery_type?: string | null
          discount_amount?: number | null
          distance?: number | null
          driver_id?: string | null
          external_tracking_provider?: string | null
          external_tracking_url?: string | null
          id?: string | null
          lalamove_driver_name?: string | null
          lalamove_driver_plate?: string | null
          lalamove_share_link?: string | null
          lalamove_status?: string | null
          payment_method?: string | null
          print_count?: number | null
          printed_at?: string | null
          status?: string | null
          supplier_id?: string | null
          tenant_id?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers_public: {
        Row: {
          active: boolean | null
          address: string | null
          created_at: string | null
          delivery_max_radius_km: number | null
          id: string | null
          lalamove_market: string | null
          lalamove_sandbox: boolean | null
          lalamove_use_store_api: string | null
          name: string | null
          phone: string | null
          responsible_for_delivery: boolean | null
          shipping_base_fee: number | null
          shipping_base_radius_km: number | null
          shipping_max_fee: number | null
          shipping_mode: string | null
          shipping_per_km_fee: number | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          created_at?: string | null
          delivery_max_radius_km?: number | null
          id?: string | null
          lalamove_market?: string | null
          lalamove_sandbox?: boolean | null
          lalamove_use_store_api?: string | null
          name?: string | null
          phone?: string | null
          responsible_for_delivery?: boolean | null
          shipping_base_fee?: number | null
          shipping_base_radius_km?: number | null
          shipping_max_fee?: number | null
          shipping_mode?: string | null
          shipping_per_km_fee?: number | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          address?: string | null
          created_at?: string | null
          delivery_max_radius_km?: number | null
          id?: string | null
          lalamove_market?: string | null
          lalamove_sandbox?: boolean | null
          lalamove_use_store_api?: string | null
          name?: string | null
          phone?: string | null
          responsible_for_delivery?: boolean | null
          shipping_base_fee?: number | null
          shipping_base_radius_km?: number | null
          shipping_max_fee?: number | null
          shipping_mode?: string | null
          shipping_per_km_fee?: number | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants_public: {
        Row: {
          active: boolean | null
          address: string | null
          admin_tabs_config: Json | null
          auto_dropshipping_enabled: boolean | null
          billing_mode: string | null
          blocked: boolean | null
          blocked_at: string | null
          blocked_reason: string | null
          brand_bg_color: string | null
          brand_primary_color: string | null
          catalog_layout: string | null
          created_at: string | null
          delivery_max_radius_km: number | null
          delivery_mode: number | null
          delivery_responsible: string | null
          demo_payment_enabled: boolean | null
          description: string | null
          dropshipping_freight_mode: string | null
          dropshipping_review_mode: boolean | null
          dropshipping_submode: string | null
          fee_mode: string | null
          fee_split_store_percent: number | null
          has_online_payment: boolean | null
          id: string | null
          is_donated: boolean | null
          is_dropshipping: boolean | null
          lalamove_enabled: boolean | null
          lalamove_market: string | null
          lalamove_sandbox: boolean | null
          logo_url: string | null
          monthly_fee: number | null
          name: string | null
          niche: string | null
          payment_provider: string | null
          phone: string | null
          pickup_enabled: boolean | null
          pix_key: string | null
          pix_key_type: string | null
          platform_fee: number | null
          platform_fee_percent: number | null
          printer_enabled: boolean | null
          printer_paper_width: string | null
          promo_active: boolean | null
          promo_text: string | null
          promo_title: string | null
          quotes_enabled: boolean | null
          quotes_feature_enabled: boolean | null
          quotes_intro_text: string | null
          scheduling_auto_confirm: boolean | null
          scheduling_capacity: number | null
          scheduling_close_time: string | null
          scheduling_enabled: boolean | null
          scheduling_open_days: number[] | null
          scheduling_open_time: string | null
          scheduling_slot_minutes: number | null
          shipping_base_fee: number | null
          shipping_base_radius_km: number | null
          shipping_enabled: boolean | null
          shipping_lalamove_apply_cap: boolean | null
          shipping_lalamove_auto: boolean | null
          shipping_lalamove_margin_percent: number | null
          shipping_max_fee: number | null
          shipping_mode: string | null
          shipping_origin_address: string | null
          shipping_per_km_fee: number | null
          slug: string | null
          sound_alert_enabled: boolean | null
          sound_alert_loud: boolean | null
          splash_bg_color: string | null
          store_mode: string | null
          storefront_config: Json | null
          updated_at: string | null
          whatsapp: string | null
          whatsapp_checkout_note: string | null
          whatsapp_consultora_phone: string | null
          whatsapp_default_address_source: string | null
          whatsapp_show_pix: boolean | null
          whatsapp_store_address: string | null
          whatsapp_store_cep: string | null
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          admin_tabs_config?: Json | null
          auto_dropshipping_enabled?: boolean | null
          billing_mode?: string | null
          blocked?: boolean | null
          blocked_at?: string | null
          blocked_reason?: string | null
          brand_bg_color?: string | null
          brand_primary_color?: string | null
          catalog_layout?: string | null
          created_at?: string | null
          delivery_max_radius_km?: number | null
          delivery_mode?: number | null
          delivery_responsible?: string | null
          demo_payment_enabled?: boolean | null
          description?: string | null
          dropshipping_freight_mode?: string | null
          dropshipping_review_mode?: boolean | null
          dropshipping_submode?: string | null
          fee_mode?: string | null
          fee_split_store_percent?: number | null
          has_online_payment?: never
          id?: string | null
          is_donated?: boolean | null
          is_dropshipping?: boolean | null
          lalamove_enabled?: boolean | null
          lalamove_market?: string | null
          lalamove_sandbox?: boolean | null
          logo_url?: string | null
          monthly_fee?: number | null
          name?: string | null
          niche?: string | null
          payment_provider?: string | null
          phone?: string | null
          pickup_enabled?: boolean | null
          pix_key?: string | null
          pix_key_type?: string | null
          platform_fee?: number | null
          platform_fee_percent?: number | null
          printer_enabled?: boolean | null
          printer_paper_width?: string | null
          promo_active?: boolean | null
          promo_text?: string | null
          promo_title?: string | null
          quotes_enabled?: boolean | null
          quotes_feature_enabled?: boolean | null
          quotes_intro_text?: string | null
          scheduling_auto_confirm?: boolean | null
          scheduling_capacity?: number | null
          scheduling_close_time?: string | null
          scheduling_enabled?: boolean | null
          scheduling_open_days?: number[] | null
          scheduling_open_time?: string | null
          scheduling_slot_minutes?: number | null
          shipping_base_fee?: number | null
          shipping_base_radius_km?: number | null
          shipping_enabled?: boolean | null
          shipping_lalamove_apply_cap?: boolean | null
          shipping_lalamove_auto?: boolean | null
          shipping_lalamove_margin_percent?: number | null
          shipping_max_fee?: number | null
          shipping_mode?: string | null
          shipping_origin_address?: string | null
          shipping_per_km_fee?: number | null
          slug?: string | null
          sound_alert_enabled?: boolean | null
          sound_alert_loud?: boolean | null
          splash_bg_color?: string | null
          store_mode?: string | null
          storefront_config?: Json | null
          updated_at?: string | null
          whatsapp?: string | null
          whatsapp_checkout_note?: string | null
          whatsapp_consultora_phone?: string | null
          whatsapp_default_address_source?: string | null
          whatsapp_show_pix?: boolean | null
          whatsapp_store_address?: string | null
          whatsapp_store_cep?: string | null
        }
        Update: {
          active?: boolean | null
          address?: string | null
          admin_tabs_config?: Json | null
          auto_dropshipping_enabled?: boolean | null
          billing_mode?: string | null
          blocked?: boolean | null
          blocked_at?: string | null
          blocked_reason?: string | null
          brand_bg_color?: string | null
          brand_primary_color?: string | null
          catalog_layout?: string | null
          created_at?: string | null
          delivery_max_radius_km?: number | null
          delivery_mode?: number | null
          delivery_responsible?: string | null
          demo_payment_enabled?: boolean | null
          description?: string | null
          dropshipping_freight_mode?: string | null
          dropshipping_review_mode?: boolean | null
          dropshipping_submode?: string | null
          fee_mode?: string | null
          fee_split_store_percent?: number | null
          has_online_payment?: never
          id?: string | null
          is_donated?: boolean | null
          is_dropshipping?: boolean | null
          lalamove_enabled?: boolean | null
          lalamove_market?: string | null
          lalamove_sandbox?: boolean | null
          logo_url?: string | null
          monthly_fee?: number | null
          name?: string | null
          niche?: string | null
          payment_provider?: string | null
          phone?: string | null
          pickup_enabled?: boolean | null
          pix_key?: string | null
          pix_key_type?: string | null
          platform_fee?: number | null
          platform_fee_percent?: number | null
          printer_enabled?: boolean | null
          printer_paper_width?: string | null
          promo_active?: boolean | null
          promo_text?: string | null
          promo_title?: string | null
          quotes_enabled?: boolean | null
          quotes_feature_enabled?: boolean | null
          quotes_intro_text?: string | null
          scheduling_auto_confirm?: boolean | null
          scheduling_capacity?: number | null
          scheduling_close_time?: string | null
          scheduling_enabled?: boolean | null
          scheduling_open_days?: number[] | null
          scheduling_open_time?: string | null
          scheduling_slot_minutes?: number | null
          shipping_base_fee?: number | null
          shipping_base_radius_km?: number | null
          shipping_enabled?: boolean | null
          shipping_lalamove_apply_cap?: boolean | null
          shipping_lalamove_auto?: boolean | null
          shipping_lalamove_margin_percent?: number | null
          shipping_max_fee?: number | null
          shipping_mode?: string | null
          shipping_origin_address?: string | null
          shipping_per_km_fee?: number | null
          slug?: string | null
          sound_alert_enabled?: boolean | null
          sound_alert_loud?: boolean | null
          splash_bg_color?: string | null
          store_mode?: string | null
          storefront_config?: Json | null
          updated_at?: string | null
          whatsapp?: string | null
          whatsapp_checkout_note?: string | null
          whatsapp_consultora_phone?: string | null
          whatsapp_default_address_source?: string | null
          whatsapp_show_pix?: boolean | null
          whatsapp_store_address?: string | null
          whatsapp_store_cep?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_nfce_lock: { Args: { _order_id: string }; Returns: boolean }
      adjust_ingredient_stock: {
        Args: {
          _allow_negative?: boolean
          _delta: number
          _ingredient_id: string
        }
        Returns: Json
      }
      assign_waiter_to_session: {
        Args: { _session_id: string }
        Returns: string
      }
      auto_cancel_expired_orders: {
        Args: never
        Returns: {
          c_name: string
          c_phone: string
          cancelled_id: string
          t_id: string
        }[]
      }
      calc_cash_session_expected: {
        Args: { _session_id: string }
        Returns: number
      }
      calc_product_cmv: { Args: { _product_id: string }; Returns: number }
      can_cancel_nfce: { Args: { _invoice_id: string }; Returns: boolean }
      cancel_order_item_partial: {
        Args: {
          _by?: string
          _order_item_id: string
          _qty: number
          _reason?: string
        }
        Returns: Json
      }
      cleanup_push_subscription: {
        Args: {
          _driver_id?: string
          _endpoint: string
          _supplier_id?: string
          _tenant_id?: string
        }
        Returns: number
      }
      cleanup_stale_drivers: { Args: never; Returns: number }
      create_customer_supplier_chat: {
        Args: {
          _customer_name: string
          _product_id: string
          _supplier_id: string
          _tenant_id: string
        }
        Returns: {
          created_at: string
          customer_name: string
          customer_session_token: string
          id: string
          is_active: boolean
          product_id: string
          supplier_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplier_chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_ghost_orders: {
        Args: never
        Returns: {
          flagged_id: string
          flagged_order: string
          flagged_tenant: string
        }[]
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_offline_nfce: {
        Args: { _order_id: string; _payload: Json; _tenant_id: string }
        Returns: string
      }
      find_or_create_order_chat: {
        Args: {
          _customer_name: string
          _customer_phone: string
          _order_id: string
          _tenant_id: string
        }
        Returns: {
          created_at: string
          customer_name: string
          customer_phone: string
          customer_session_token: string
          id: string
          last_message_at: string | null
          last_sender: string | null
          order_id: string
          tenant_id: string
          unread_for_customer: number
          unread_for_store: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "order_chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_abc_curve: {
        Args: { _from: string; _tenant_id: string; _to: string }
        Returns: {
          abc_class: string
          cumulative_pct: number
          product_name: string
          qty: number
          revenue: number
        }[]
      }
      get_cash_flow_projection: {
        Args: { _days?: number; _tenant_id: string }
        Returns: {
          accumulated: number
          d: string
          net: number
          projected_in: number
          projected_out: number
        }[]
      }
      get_demand_forecast: {
        Args: { _tenant_id: string }
        Returns: {
          confidence: string
          dow: number
          forecast_date: string
          predicted_orders: number
          predicted_revenue: number
        }[]
      }
      get_dre: {
        Args: { _from: string; _tenant_id: string; _to: string }
        Returns: Json
      }
      get_dre_comparison: {
        Args: { _months?: number; _tenant_id: string }
        Returns: {
          cmv: number
          expenses: number
          month_start: string
          net_profit: number
          platform_fee: number
          revenue: number
        }[]
      }
      get_driver_by_token: {
        Args: { _token: string }
        Returns: {
          access_token: string
          active: boolean
          created_at: string
          id: string
          is_online: boolean
          last_online_at: string | null
          name: string
          phone: string
          supplier_id: string | null
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "drivers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_executive_kpis: { Args: { _tenant_id: string }; Returns: Json }
      get_heatmap: {
        Args: { _days?: number; _tenant_id: string }
        Returns: {
          dow: number
          hour: number
          orders: number
          revenue: number
        }[]
      }
      get_live_floor: { Args: { _tenant_id: string }; Returns: Json }
      get_loyalty_points: {
        Args: { _address: string; _tenant_id: string }
        Returns: number
      }
      get_operational_reports: {
        Args: { _from: string; _tenant_id: string; _to: string }
        Returns: Json
      }
      get_order_chat_by_token: {
        Args: { _chat_id: string; _token: string }
        Returns: {
          created_at: string
          customer_name: string
          customer_phone: string
          customer_session_token: string
          id: string
          last_message_at: string | null
          last_sender: string | null
          order_id: string
          tenant_id: string
          unread_for_customer: number
          unread_for_store: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "order_chats"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_order_items_public: {
        Args: { _order_id: string }
        Returns: {
          addons: Json | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_qty: number
          created_at: string
          id: string
          notes: string | null
          order_id: string
          product_name: string
          product_price: number
          quantity: number
          variant_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_orders_by_phone: {
        Args: { _phone: string; _tenant_id: string }
        Returns: {
          change_for: number | null
          coupon_code: string | null
          created_at: string | null
          customer_address: string | null
          customer_name: string | null
          delivery_fee: number | null
          delivery_status_note: string | null
          delivery_type: string | null
          discount_amount: number | null
          distance: number | null
          driver_id: string | null
          external_tracking_provider: string | null
          external_tracking_url: string | null
          id: string | null
          lalamove_driver_name: string | null
          lalamove_driver_plate: string | null
          lalamove_share_link: string | null
          lalamove_status: string | null
          payment_method: string | null
          print_count: number | null
          printed_at: string | null
          status: string | null
          supplier_id: string | null
          tenant_id: string | null
          total: number | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "orders_public"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_session_tabs: { Args: { _session_id: string }; Returns: Json }
      get_stuck_orders: {
        Args: { _tenant_id: string }
        Returns: {
          created_at: string
          customer_name: string
          id: string
          minutes_stuck: number
          severity: string
          status: string
          table_label: string
          total: number
        }[]
      }
      get_supplier_by_token: {
        Args: { _token: string }
        Returns: {
          access_token: string
          active: boolean
          address: string
          created_at: string
          delivery_max_radius_km: number
          id: string
          lalamove_api_key: string | null
          lalamove_api_secret: string | null
          lalamove_market: string | null
          lalamove_sandbox: boolean
          lalamove_use_store_api: string
          name: string
          phone: string
          responsible_for_delivery: boolean
          shipping_base_fee: number
          shipping_base_radius_km: number
          shipping_max_fee: number | null
          shipping_mode: string
          shipping_per_km_fee: number
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "suppliers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_supplier_chat_by_token: {
        Args: { _product_id: string; _token: string }
        Returns: {
          created_at: string
          customer_name: string
          customer_session_token: string
          id: string
          is_active: boolean
          product_id: string
          supplier_id: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "supplier_chats"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_supplier_lalamove_status: {
        Args: { _supplier_token: string }
        Returns: Json
      }
      get_tenant_pix: {
        Args: { _tenant_id: string }
        Returns: {
          pix_key: string
          pix_key_type: string
        }[]
      }
      get_tenant_public_by_slug: {
        Args: { _slug: string }
        Returns: {
          active: boolean | null
          address: string | null
          admin_tabs_config: Json | null
          auto_dropshipping_enabled: boolean | null
          billing_mode: string | null
          blocked: boolean | null
          blocked_at: string | null
          blocked_reason: string | null
          brand_bg_color: string | null
          brand_primary_color: string | null
          catalog_layout: string | null
          created_at: string | null
          delivery_max_radius_km: number | null
          delivery_mode: number | null
          delivery_responsible: string | null
          demo_payment_enabled: boolean | null
          description: string | null
          dropshipping_freight_mode: string | null
          dropshipping_review_mode: boolean | null
          dropshipping_submode: string | null
          fee_mode: string | null
          fee_split_store_percent: number | null
          has_online_payment: boolean | null
          id: string | null
          is_donated: boolean | null
          is_dropshipping: boolean | null
          lalamove_enabled: boolean | null
          lalamove_market: string | null
          lalamove_sandbox: boolean | null
          logo_url: string | null
          monthly_fee: number | null
          name: string | null
          niche: string | null
          payment_provider: string | null
          phone: string | null
          pickup_enabled: boolean | null
          pix_key: string | null
          pix_key_type: string | null
          platform_fee: number | null
          platform_fee_percent: number | null
          printer_enabled: boolean | null
          printer_paper_width: string | null
          promo_active: boolean | null
          promo_text: string | null
          promo_title: string | null
          quotes_enabled: boolean | null
          quotes_feature_enabled: boolean | null
          quotes_intro_text: string | null
          scheduling_auto_confirm: boolean | null
          scheduling_capacity: number | null
          scheduling_close_time: string | null
          scheduling_enabled: boolean | null
          scheduling_open_days: number[] | null
          scheduling_open_time: string | null
          scheduling_slot_minutes: number | null
          shipping_base_fee: number | null
          shipping_base_radius_km: number | null
          shipping_enabled: boolean | null
          shipping_lalamove_apply_cap: boolean | null
          shipping_lalamove_auto: boolean | null
          shipping_lalamove_margin_percent: number | null
          shipping_max_fee: number | null
          shipping_mode: string | null
          shipping_origin_address: string | null
          shipping_per_km_fee: number | null
          slug: string | null
          sound_alert_enabled: boolean | null
          sound_alert_loud: boolean | null
          splash_bg_color: string | null
          store_mode: string | null
          storefront_config: Json | null
          updated_at: string | null
          whatsapp: string | null
          whatsapp_checkout_note: string | null
          whatsapp_consultora_phone: string | null
          whatsapp_default_address_source: string | null
          whatsapp_show_pix: boolean | null
          whatsapp_store_address: string | null
          whatsapp_store_cep: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tenants_public"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_waiter_by_token: {
        Args: { _tenant_id: string; _token: string }
        Returns: {
          access_token: string
          active: boolean
          commission_percent: number
          created_at: string
          id: string
          last_assigned_at: string | null
          last_online_at: string | null
          name: string
          online: boolean
          pin_code: string | null
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "waiters"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_waiter_commissions: {
        Args: { _from: string; _tenant_id: string; _to: string }
        Returns: {
          commission_amount: number
          commission_percent: number
          orders_count: number
          revenue: number
          waiter_id: string
          waiter_name: string
        }[]
      }
      has_platform_role: {
        Args: {
          _role: Database["public"]["Enums"]["platform_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      list_active_drivers_for_supplier: {
        Args: { _supplier_token: string }
        Returns: {
          id: string
          name: string
          phone: string
        }[]
      }
      list_chat_messages_by_token: {
        Args: { _chat_id: string; _token: string }
        Returns: {
          chat_id: string
          content: string
          created_at: string
          id: string
          sender_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "order_chat_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_service_requests_for_session: {
        Args: { _session_id: string }
        Returns: {
          created_at: string
          customer_name: string
          id: string
          message: string
          resolved_at: string | null
          session_id: string
          status: string
          table_id: string
          table_label: string
          tenant_id: string
          waiter_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "service_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_supplier_chats_by_supplier_token: {
        Args: { _token: string }
        Returns: {
          created_at: string
          customer_name: string
          customer_session_token: string
          id: string
          is_active: boolean
          product_id: string
          supplier_id: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "supplier_chats"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      log_order_created_event: {
        Args: { _description: string; _metadata?: Json; _order_id: string }
        Returns: undefined
      }
      log_order_revenue_entry: { Args: { _order_id: string }; Returns: boolean }
      log_platform_fee_entry: { Args: { _order_id: string }; Returns: boolean }
      mark_chat_read_by_token: {
        Args: { _chat_id: string; _side: string; _token: string }
        Returns: undefined
      }
      mark_overdue_credits: { Args: never; Returns: undefined }
      merge_table_sessions: {
        Args: { _source_id: string; _target_id: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      place_order: { Args: { _items?: Json; _order: Json }; Returns: string }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      register_loyalty_point: {
        Args: { _address: string; _tenant_id: string }
        Returns: number
      }
      register_webhook_event: {
        Args: {
          _event_id: string
          _event_type?: string
          _order_id?: string
          _payload?: Json
          _provider: string
          _tenant_id?: string
        }
        Returns: boolean
      }
      request_admin_role: {
        Args: { _email?: string; _tenant_id: string; _user_id: string }
        Returns: undefined
      }
      request_admin_role_by_email: {
        Args: { _email: string; _tenant_id: string }
        Returns: Json
      }
      restore_order_stock: { Args: { _order_id: string }; Returns: boolean }
      reverse_order_revenue_entry: {
        Args: { _order_id: string }
        Returns: boolean
      }
      safe_uuid: { Args: { txt: string }; Returns: string }
      send_customer_chat_message: {
        Args: { _chat_id: string; _content: string; _token: string }
        Returns: {
          chat_id: string
          content: string
          created_at: string
          id: string
          sender_type: string
        }
        SetofOptions: {
          from: "*"
          to: "order_chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      toggle_product_86: {
        Args: { _in_stock: boolean; _product_id: string }
        Returns: boolean
      }
      transfer_table_session: {
        Args: { _new_table_id: string; _session_id: string }
        Returns: boolean
      }
      update_table_session_safe: {
        Args: { _expected_version: number; _patch: Json; _session_id: string }
        Returns: Json
      }
      validate_pdv_pin: {
        Args: { _pin: string; _tenant_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      platform_role: "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      platform_role: ["super_admin"],
    },
  },
} as const
