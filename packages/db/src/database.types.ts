export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      branches: {
        Row: {
          code: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ccr_master: {
        Row: {
          code: string
          company_id: string
          created_at: string
          hs_code: string
          id: string
          is_active: boolean
          requirement_text: string
          title: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          hs_code: string
          id?: string
          is_active?: boolean
          requirement_text: string
          title: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          hs_code?: string
          id?: string
          is_active?: boolean
          requirement_text?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ccr_master_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["company_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["company_status"]
          updated_at?: string
        }
        Relationships: []
      }
      job_ccrs: {
        Row: {
          applied_by: string | null
          ccr_id: string | null
          code: string
          company_id: string
          created_at: string
          id: string
          job_id: string
          title: string
        }
        Insert: {
          applied_by?: string | null
          ccr_id?: string | null
          code: string
          company_id: string
          created_at?: string
          id?: string
          job_id: string
          title: string
        }
        Update: {
          applied_by?: string | null
          ccr_id?: string | null
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          job_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_ccrs_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_ccrs_ccr_id_fkey"
            columns: ["ccr_id"]
            isOneToOne: false
            referencedRelation: "ccr_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_ccrs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_ccrs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_document_requests: {
        Row: {
          ccr_code: string | null
          company_id: string
          created_at: string
          id: string
          job_id: string
          name: string
          reason: string | null
          received_document_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["document_request_status"]
        }
        Insert: {
          ccr_code?: string | null
          company_id: string
          created_at?: string
          id?: string
          job_id: string
          name: string
          reason?: string | null
          received_document_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["document_request_status"]
        }
        Update: {
          ccr_code?: string | null
          company_id?: string
          created_at?: string
          id?: string
          job_id?: string
          name?: string
          reason?: string | null
          received_document_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["document_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "job_document_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_document_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_document_requests_received_document_id_fkey"
            columns: ["received_document_id"]
            isOneToOne: false
            referencedRelation: "job_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_document_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_documents: {
        Row: {
          classification: Json | null
          classified_at: string | null
          company_id: string
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          id: string
          job_id: string
          mail_message_id: string | null
          mime_type: string | null
          sha256: string
          size_bytes: number | null
          source: string
          storage_bucket: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          classification?: Json | null
          classified_at?: string | null
          company_id: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          file_name: string
          id?: string
          job_id: string
          mail_message_id?: string | null
          mime_type?: string | null
          sha256: string
          size_bytes?: number | null
          source?: string
          storage_bucket?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          classification?: Json | null
          classified_at?: string | null
          company_id?: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string
          id?: string
          job_id?: string
          mail_message_id?: string | null
          mime_type?: string | null
          sha256?: string
          size_bytes?: number | null
          source?: string
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_documents_mail_message_id_fkey"
            columns: ["mail_message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_drafts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          draft: Json
          id: string
          job_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          draft: Json
          id?: string
          job_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          draft?: Json
          id?: string
          job_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_drafts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_drafts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_events: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          company_id: string
          created_at: string
          id: string
          job_id: string | null
          payload: Json
          type: string
        }
        Insert: {
          actor_kind?: string
          actor_user_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          job_id?: string | null
          payload?: Json
          type: string
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          job_id?: string | null
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_exports: {
        Row: {
          company_id: string
          created_at: string
          draft_version: number | null
          generated_by: string | null
          id: string
          job_id: string
          kind: string
          storage_bucket: string
          storage_path: string
          template_version: string
        }
        Insert: {
          company_id: string
          created_at?: string
          draft_version?: number | null
          generated_by?: string | null
          id?: string
          job_id: string
          kind?: string
          storage_bucket?: string
          storage_path: string
          template_version: string
        }
        Update: {
          company_id?: string
          created_at?: string
          draft_version?: number | null
          generated_by?: string | null
          id?: string
          job_id?: string
          kind?: string
          storage_bucket?: string
          storage_path?: string
          template_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_exports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_exports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_exports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_identifiers: {
        Row: {
          company_id: string
          created_at: string
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["identifier_kind"]
          value: string
          value_raw: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["identifier_kind"]
          value: string
          value_raw: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["identifier_kind"]
          value?: string
          value_raw?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_identifiers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_identifiers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          assigned_to: string | null
          branch_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          eta: string | null
          hs_codes: string[]
          id: string
          importer_name: string | null
          job_number: string | null
          reference: string | null
          remarks: string | null
          shipper_email: string | null
          shipper_id: string | null
          source: Database["public"]["Enums"]["job_source"]
          stage: Database["public"]["Enums"]["job_stage"]
          supplier_name: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          branch_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          eta?: string | null
          hs_codes?: string[]
          id?: string
          importer_name?: string | null
          job_number?: string | null
          reference?: string | null
          remarks?: string | null
          shipper_email?: string | null
          shipper_id?: string | null
          source?: Database["public"]["Enums"]["job_source"]
          stage?: Database["public"]["Enums"]["job_stage"]
          supplier_name?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          branch_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          eta?: string | null
          hs_codes?: string[]
          id?: string
          importer_name?: string | null
          job_number?: string | null
          reference?: string | null
          remarks?: string | null
          shipper_email?: string | null
          shipper_id?: string | null
          source?: Database["public"]["Enums"]["job_source"]
          stage?: Database["public"]["Enums"]["job_stage"]
          supplier_name?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_shipper_id_fkey"
            columns: ["shipper_id"]
            isOneToOne: false
            referencedRelation: "shippers"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_connections: {
        Row: {
          access_token_enc: string | null
          company_id: string
          consecutive_failures: number
          created_at: string
          delta_link: string | null
          delta_updated_at: string | null
          display_name: string | null
          email_address: string
          id: string
          last_error: string | null
          last_polled_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_poll_at: string
          profile_id: string
          provider: Database["public"]["Enums"]["mail_provider"]
          provider_account_id: string
          refresh_token_enc: string | null
          scopes: string[]
          status: Database["public"]["Enums"]["connection_status"]
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_enc?: string | null
          company_id: string
          consecutive_failures?: number
          created_at?: string
          delta_link?: string | null
          delta_updated_at?: string | null
          display_name?: string | null
          email_address: string
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_poll_at?: string
          profile_id: string
          provider?: Database["public"]["Enums"]["mail_provider"]
          provider_account_id: string
          refresh_token_enc?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_enc?: string | null
          company_id?: string
          consecutive_failures?: number
          created_at?: string
          delta_link?: string | null
          delta_updated_at?: string | null
          display_name?: string | null
          email_address?: string
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_poll_at?: string
          profile_id?: string
          provider?: Database["public"]["Enums"]["mail_provider"]
          provider_account_id?: string
          refresh_token_enc?: string | null
          scopes?: string[]
          status?: Database["public"]["Enums"]["connection_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_messages: {
        Row: {
          attempts: number
          company_id: string
          connection_id: string
          conversation_id: string | null
          created_at: string
          from_address: string | null
          from_name: string | null
          has_attachments: boolean
          id: string
          internet_message_id: string | null
          job_id: string | null
          last_error: string | null
          match_score: number | null
          outcome: Database["public"]["Enums"]["mail_outcome"] | null
          processed_at: string | null
          provider_message_id: string
          received_at: string | null
          skip_reason: string | null
          subject: string | null
        }
        Insert: {
          attempts?: number
          company_id: string
          connection_id: string
          conversation_id?: string | null
          created_at?: string
          from_address?: string | null
          from_name?: string | null
          has_attachments?: boolean
          id?: string
          internet_message_id?: string | null
          job_id?: string | null
          last_error?: string | null
          match_score?: number | null
          outcome?: Database["public"]["Enums"]["mail_outcome"] | null
          processed_at?: string | null
          provider_message_id: string
          received_at?: string | null
          skip_reason?: string | null
          subject?: string | null
        }
        Update: {
          attempts?: number
          company_id?: string
          connection_id?: string
          conversation_id?: string | null
          created_at?: string
          from_address?: string | null
          from_name?: string | null
          has_attachments?: boolean
          id?: string
          internet_message_id?: string | null
          job_id?: string | null
          last_error?: string | null
          match_score?: number | null
          outcome?: Database["public"]["Enums"]["mail_outcome"] | null
          processed_at?: string | null
          provider_message_id?: string
          received_at?: string | null
          skip_reason?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_messages_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          code_verifier: string
          company_id: string
          created_at: string
          expires_at: string
          profile_id: string
          redirect_to: string | null
          state: string
        }
        Insert: {
          code_verifier: string
          company_id: string
          created_at?: string
          expires_at?: string
          profile_id: string
          redirect_to?: string | null
          state: string
        }
        Update: {
          code_verifier?: string
          company_id?: string
          created_at?: string
          expires_at?: string
          profile_id?: string
          redirect_to?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_states_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_states_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          invited_by: string | null
          is_platform_admin: boolean
          last_login_at: string | null
          must_change_password: boolean
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["user_status"]
          team: Database["public"]["Enums"]["team_kind"] | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          invited_by?: string | null
          is_platform_admin?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["user_status"]
          team?: Database["public"]["Enums"]["team_kind"] | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          is_platform_admin?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["user_status"]
          team?: Database["public"]["Enums"]["team_kind"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      shippers: {
        Row: {
          aliases: string[]
          company_id: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          company_id: string
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shippers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_company_id: { Args: never; Returns: string }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      can_manage_company: { Args: never; Returns: boolean }
      claim_mail_connection: {
        Args: { p_stale_after?: string; p_worker: string }
        Returns: {
          access_token_enc: string | null
          company_id: string
          consecutive_failures: number
          created_at: string
          delta_link: string | null
          delta_updated_at: string | null
          display_name: string | null
          email_address: string
          id: string
          last_error: string | null
          last_polled_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_poll_at: string
          profile_id: string
          provider: Database["public"]["Enums"]["mail_provider"]
          provider_account_id: string
          refresh_token_enc: string | null
          scopes: string[]
          status: Database["public"]["Enums"]["connection_status"]
          token_expires_at: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "mail_connections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      is_platform_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "platform_admin" | "company_owner" | "company_admin" | "member"
      company_status: "active" | "suspended"
      connection_status: "active" | "needs_reauth" | "disabled"
      document_request_status: "pending" | "received" | "waived"
      document_type:
        | "invoice"
        | "bill_of_lading"
        | "air_waybill"
        | "packing_list"
        | "certificate_of_origin"
        | "certificate_of_analysis"
        | "license"
        | "svb_order"
        | "checklist"
        | "unknown"
      identifier_kind:
        | "bl"
        | "awb"
        | "invoice"
        | "container"
        | "po"
        | "conversation"
      job_source: "email" | "manual"
      job_stage:
        | "new"
        | "documents_received"
        | "exported"
        | "scrutiny"
        | "awaiting_shipper"
        | "checklist_revision"
        | "noting"
        | "closed"
      mail_outcome: "created_job" | "attached" | "skipped" | "error"
      mail_provider: "microsoft"
      team_kind: "scrutiny" | "do"
      user_status: "invited" | "active" | "disabled"
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
      app_role: ["platform_admin", "company_owner", "company_admin", "member"],
      company_status: ["active", "suspended"],
      connection_status: ["active", "needs_reauth", "disabled"],
      document_request_status: ["pending", "received", "waived"],
      document_type: [
        "invoice",
        "bill_of_lading",
        "air_waybill",
        "packing_list",
        "certificate_of_origin",
        "certificate_of_analysis",
        "license",
        "svb_order",
        "checklist",
        "unknown",
      ],
      identifier_kind: [
        "bl",
        "awb",
        "invoice",
        "container",
        "po",
        "conversation",
      ],
      job_source: ["email", "manual"],
      job_stage: [
        "new",
        "documents_received",
        "exported",
        "scrutiny",
        "awaiting_shipper",
        "checklist_revision",
        "noting",
        "closed",
      ],
      mail_outcome: ["created_job", "attached", "skipped", "error"],
      mail_provider: ["microsoft"],
      team_kind: ["scrutiny", "do"],
      user_status: ["invited", "active", "disabled"],
    },
  },
} as const

