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
      bonded_warehouses: {
        Row: {
          address1: string | null
          address2: string | null
          city: string | null
          code: string
          company_id: string
          country: string
          created_at: string
          fetched_at: string | null
          id: string
          is_active: boolean
          is_sec65: boolean | null
          license_no: string | null
          license_valid_till: string | null
          licensee_name: string | null
          name: string | null
          pin: string | null
          sec65_permission_date: string | null
          sec65_permission_no: string | null
          source: Database["public"]["Enums"]["warehouse_source"]
          station_code: string | null
          updated_at: string
          warehouse_type: Database["public"]["Enums"]["warehouse_type"] | null
        }
        Insert: {
          address1?: string | null
          address2?: string | null
          city?: string | null
          code: string
          company_id: string
          country?: string
          created_at?: string
          fetched_at?: string | null
          id?: string
          is_active?: boolean
          is_sec65?: boolean | null
          license_no?: string | null
          license_valid_till?: string | null
          licensee_name?: string | null
          name?: string | null
          pin?: string | null
          sec65_permission_date?: string | null
          sec65_permission_no?: string | null
          source?: Database["public"]["Enums"]["warehouse_source"]
          station_code?: string | null
          updated_at?: string
          warehouse_type?: Database["public"]["Enums"]["warehouse_type"] | null
        }
        Update: {
          address1?: string | null
          address2?: string | null
          city?: string | null
          code?: string
          company_id?: string
          country?: string
          created_at?: string
          fetched_at?: string | null
          id?: string
          is_active?: boolean
          is_sec65?: boolean | null
          license_no?: string | null
          license_valid_till?: string | null
          licensee_name?: string | null
          name?: string | null
          pin?: string | null
          sec65_permission_date?: string | null
          sec65_permission_no?: string | null
          source?: Database["public"]["Enums"]["warehouse_source"]
          station_code?: string | null
          updated_at?: string
          warehouse_type?: Database["public"]["Enums"]["warehouse_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "bonded_warehouses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
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
      cfs_master: {
        Row: {
          code: string | null
          company_id: string
          contact_email: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          port: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          company_id: string
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          port?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          company_id?: string
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          port?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cfs_master_company_id_fkey"
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
      deleted_jobs: {
        Row: {
          company_id: string
          deleted_at: string
          deleted_by: string | null
          id: string
          importer_name: string | null
          job_id: string
          job_number: string | null
          reason: string | null
          snapshot: Json
          stage: string | null
          title: string | null
        }
        Insert: {
          company_id: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          importer_name?: string | null
          job_id: string
          job_number?: string | null
          reason?: string | null
          snapshot?: Json
          stage?: string | null
          title?: string | null
        }
        Update: {
          company_id?: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          importer_name?: string | null
          job_id?: string
          job_number?: string | null
          reason?: string | null
          snapshot?: Json
          stage?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deleted_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deleted_jobs_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      importer_line_securities: {
        Row: {
          amount: number | null
          company_id: string
          covers_destuffed: boolean
          covers_loaded: boolean
          created_at: string
          id: string
          importer_aliases: string[]
          importer_name: string
          is_active: boolean
          kind: string
          notes: string | null
          reference: string | null
          shipping_line_id: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          amount?: number | null
          company_id: string
          covers_destuffed?: boolean
          covers_loaded?: boolean
          created_at?: string
          id?: string
          importer_aliases?: string[]
          importer_name: string
          is_active?: boolean
          kind: string
          notes?: string | null
          reference?: string | null
          shipping_line_id: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          amount?: number | null
          company_id?: string
          covers_destuffed?: boolean
          covers_loaded?: boolean
          created_at?: string
          id?: string
          importer_aliases?: string[]
          importer_name?: string
          is_active?: boolean
          kind?: string
          notes?: string | null
          reference?: string | null
          shipping_line_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "importer_line_securities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importer_line_securities_shipping_line_id_fkey"
            columns: ["shipping_line_id"]
            isOneToOne: false
            referencedRelation: "shipping_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      job_boe_header: {
        Row: {
          ad_code: string | null
          be_filing_date: string | null
          be_type: Database["public"]["Enums"]["be_type"] | null
          bond_date: string | null
          bond_expiry_date: string | null
          bond_no: string | null
          company_id: string
          created_at: string
          customs_house_code: string | null
          duty_payment_status: string | null
          exbond_clearance_kind:
            | Database["public"]["Enums"]["exbond_clearance_kind"]
            | null
          filing_status: Database["public"]["Enums"]["filing_status"] | null
          gateway_igm_date: string | null
          gateway_igm_no: string | null
          gateway_inward_date: string | null
          igm_checked: boolean
          igm_date: string | null
          igm_no: string | null
          importer_ref_no: string | null
          inbond_be_date: string | null
          inbond_be_no: string | null
          inward_date: string | null
          is_bonds_certificates: boolean | null
          is_first_check: boolean | null
          is_green_channel: boolean | null
          is_hss: boolean | null
          is_kachcha_be: boolean | null
          is_sec65_manufacturing_wh: boolean | null
          is_transhipment: boolean | null
          is_under_provisional_assessment: boolean | null
          is_under_sec46: boolean | null
          is_under_sec48: boolean | null
          is_warehouse_sale: boolean | null
          itc_lic_details: boolean | null
          job_id: string
          line_no: string | null
          marks_and_nos: string | null
          package_unit_code: string | null
          released_gross_weight_kg: number | null
          released_package_code: string | null
          released_packages: number | null
          released_uom: string | null
          sec46_override_reason: string | null
          transport_mode: Database["public"]["Enums"]["transport_mode"] | null
          updated_at: string
          updated_by: string | null
          warehouse_code: string | null
        }
        Insert: {
          ad_code?: string | null
          be_filing_date?: string | null
          be_type?: Database["public"]["Enums"]["be_type"] | null
          bond_date?: string | null
          bond_expiry_date?: string | null
          bond_no?: string | null
          company_id: string
          created_at?: string
          customs_house_code?: string | null
          duty_payment_status?: string | null
          exbond_clearance_kind?:
            | Database["public"]["Enums"]["exbond_clearance_kind"]
            | null
          filing_status?: Database["public"]["Enums"]["filing_status"] | null
          gateway_igm_date?: string | null
          gateway_igm_no?: string | null
          gateway_inward_date?: string | null
          igm_checked?: boolean
          igm_date?: string | null
          igm_no?: string | null
          importer_ref_no?: string | null
          inbond_be_date?: string | null
          inbond_be_no?: string | null
          inward_date?: string | null
          is_bonds_certificates?: boolean | null
          is_first_check?: boolean | null
          is_green_channel?: boolean | null
          is_hss?: boolean | null
          is_kachcha_be?: boolean | null
          is_sec65_manufacturing_wh?: boolean | null
          is_transhipment?: boolean | null
          is_under_provisional_assessment?: boolean | null
          is_under_sec46?: boolean | null
          is_under_sec48?: boolean | null
          is_warehouse_sale?: boolean | null
          itc_lic_details?: boolean | null
          job_id: string
          line_no?: string | null
          marks_and_nos?: string | null
          package_unit_code?: string | null
          released_gross_weight_kg?: number | null
          released_package_code?: string | null
          released_packages?: number | null
          released_uom?: string | null
          sec46_override_reason?: string | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"] | null
          updated_at?: string
          updated_by?: string | null
          warehouse_code?: string | null
        }
        Update: {
          ad_code?: string | null
          be_filing_date?: string | null
          be_type?: Database["public"]["Enums"]["be_type"] | null
          bond_date?: string | null
          bond_expiry_date?: string | null
          bond_no?: string | null
          company_id?: string
          created_at?: string
          customs_house_code?: string | null
          duty_payment_status?: string | null
          exbond_clearance_kind?:
            | Database["public"]["Enums"]["exbond_clearance_kind"]
            | null
          filing_status?: Database["public"]["Enums"]["filing_status"] | null
          gateway_igm_date?: string | null
          gateway_igm_no?: string | null
          gateway_inward_date?: string | null
          igm_checked?: boolean
          igm_date?: string | null
          igm_no?: string | null
          importer_ref_no?: string | null
          inbond_be_date?: string | null
          inbond_be_no?: string | null
          inward_date?: string | null
          is_bonds_certificates?: boolean | null
          is_first_check?: boolean | null
          is_green_channel?: boolean | null
          is_hss?: boolean | null
          is_kachcha_be?: boolean | null
          is_sec65_manufacturing_wh?: boolean | null
          is_transhipment?: boolean | null
          is_under_provisional_assessment?: boolean | null
          is_under_sec46?: boolean | null
          is_under_sec48?: boolean | null
          is_warehouse_sale?: boolean | null
          itc_lic_details?: boolean | null
          job_id?: string
          line_no?: string | null
          marks_and_nos?: string | null
          package_unit_code?: string | null
          released_gross_weight_kg?: number | null
          released_package_code?: string | null
          released_packages?: number | null
          released_uom?: string | null
          sec46_override_reason?: string | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"] | null
          updated_at?: string
          updated_by?: string | null
          warehouse_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_boe_header_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_boe_header_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_boe_header_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_bonds_certificates: {
        Row: {
          cert_date: string | null
          commissionerate: string | null
          company_id: string
          created_at: string
          division: string | null
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["bond_or_certificate"]
          number: string
          proposed: boolean
          range_office: string | null
          registration_port: string | null
          seq: number
          source: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cert_date?: string | null
          commissionerate?: string | null
          company_id: string
          created_at?: string
          division?: string | null
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["bond_or_certificate"]
          number: string
          proposed?: boolean
          range_office?: string | null
          registration_port?: string | null
          seq: number
          source?: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cert_date?: string | null
          commissionerate?: string | null
          company_id?: string
          created_at?: string
          division?: string | null
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["bond_or_certificate"]
          number?: string
          proposed?: boolean
          range_office?: string | null
          registration_port?: string | null
          seq?: number
          source?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_bonds_certificates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_bonds_certificates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_bonds_certificates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_ccrs: {
        Row: {
          applied_by: string | null
          applies: boolean | null
          assessed_at: string | null
          assessment_note: string | null
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
          applies?: boolean | null
          assessed_at?: string | null
          assessment_note?: string | null
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
          applies?: boolean | null
          assessed_at?: string | null
          assessment_note?: string | null
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
      job_clearance: {
        Row: {
          ac_passed_at: string | null
          appraiser_passed_at: string | null
          assessed_duty: number | null
          be_date: string | null
          be_number: string | null
          company_id: string
          created_at: string
          delivered_on: string | null
          duty_amount: number | null
          duty_challan_no: string | null
          duty_checked_at: string | null
          duty_checked_by: string | null
          duty_paid_on: string | null
          entry_inwards_date: string | null
          examined_on: string | null
          goods_registered_on: string | null
          id: string
          job_id: string
          noted_at: string | null
          noted_by: string | null
          notes: string | null
          ooc_reference: string | null
          out_of_charge_on: string | null
          rms_route: Database["public"]["Enums"]["rms_route"] | null
          status: Database["public"]["Enums"]["clearance_status"]
          updated_at: string
          variance_note: string | null
          variance_raised_at: string | null
          variance_resolved_at: string | null
        }
        Insert: {
          ac_passed_at?: string | null
          appraiser_passed_at?: string | null
          assessed_duty?: number | null
          be_date?: string | null
          be_number?: string | null
          company_id: string
          created_at?: string
          delivered_on?: string | null
          duty_amount?: number | null
          duty_challan_no?: string | null
          duty_checked_at?: string | null
          duty_checked_by?: string | null
          duty_paid_on?: string | null
          entry_inwards_date?: string | null
          examined_on?: string | null
          goods_registered_on?: string | null
          id?: string
          job_id: string
          noted_at?: string | null
          noted_by?: string | null
          notes?: string | null
          ooc_reference?: string | null
          out_of_charge_on?: string | null
          rms_route?: Database["public"]["Enums"]["rms_route"] | null
          status?: Database["public"]["Enums"]["clearance_status"]
          updated_at?: string
          variance_note?: string | null
          variance_raised_at?: string | null
          variance_resolved_at?: string | null
        }
        Update: {
          ac_passed_at?: string | null
          appraiser_passed_at?: string | null
          assessed_duty?: number | null
          be_date?: string | null
          be_number?: string | null
          company_id?: string
          created_at?: string
          delivered_on?: string | null
          duty_amount?: number | null
          duty_challan_no?: string | null
          duty_checked_at?: string | null
          duty_checked_by?: string | null
          duty_paid_on?: string | null
          entry_inwards_date?: string | null
          examined_on?: string | null
          goods_registered_on?: string | null
          id?: string
          job_id?: string
          noted_at?: string | null
          noted_by?: string | null
          notes?: string | null
          ooc_reference?: string | null
          out_of_charge_on?: string | null
          rms_route?: Database["public"]["Enums"]["rms_route"] | null
          status?: Database["public"]["Enums"]["clearance_status"]
          updated_at?: string
          variance_note?: string | null
          variance_raised_at?: string | null
          variance_resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_clearance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_duty_checked_by_fkey"
            columns: ["duty_checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_noted_by_fkey"
            columns: ["noted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_clearance_nocs: {
        Row: {
          applied_on: string | null
          authority: string
          company_id: string
          created_at: string
          document_id: string | null
          id: string
          job_clearance_id: string
          job_id: string
          received_on: string | null
          reference: string | null
          status: Database["public"]["Enums"]["noc_status"]
          updated_at: string
        }
        Insert: {
          applied_on?: string | null
          authority: string
          company_id: string
          created_at?: string
          document_id?: string | null
          id?: string
          job_clearance_id: string
          job_id: string
          received_on?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["noc_status"]
          updated_at?: string
        }
        Update: {
          applied_on?: string | null
          authority?: string
          company_id?: string
          created_at?: string
          document_id?: string | null
          id?: string
          job_clearance_id?: string
          job_id?: string
          received_on?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["noc_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_clearance_nocs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_nocs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "job_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_nocs_job_clearance_id_fkey"
            columns: ["job_clearance_id"]
            isOneToOne: false
            referencedRelation: "job_clearance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_nocs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_clearance_queries: {
        Row: {
          company_id: string
          created_at: string
          id: string
          job_clearance_id: string
          job_id: string
          query_text: string
          raised_on: string
          replied_on: string | null
          reply_document_id: string | null
          reply_note: string | null
          resolved_by: string | null
          source: string
          status: Database["public"]["Enums"]["clearance_query_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          job_clearance_id: string
          job_id: string
          query_text: string
          raised_on: string
          replied_on?: string | null
          reply_document_id?: string | null
          reply_note?: string | null
          resolved_by?: string | null
          source?: string
          status?: Database["public"]["Enums"]["clearance_query_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          job_clearance_id?: string
          job_id?: string
          query_text?: string
          raised_on?: string
          replied_on?: string | null
          reply_document_id?: string | null
          reply_note?: string | null
          resolved_by?: string | null
          source?: string
          status?: Database["public"]["Enums"]["clearance_query_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_clearance_queries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_queries_job_clearance_id_fkey"
            columns: ["job_clearance_id"]
            isOneToOne: false
            referencedRelation: "job_clearance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_queries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_queries_reply_document_id_fkey"
            columns: ["reply_document_id"]
            isOneToOne: false
            referencedRelation: "job_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_clearance_queries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_containers: {
        Row: {
          company_id: string
          container_no: string
          created_at: string
          id: string
          job_id: string
          seal_no: string | null
          size_type: string | null
          sr_no: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          container_no: string
          created_at?: string
          id?: string
          job_id: string
          seal_no?: string | null
          size_type?: string | null
          sr_no: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          container_no?: string
          created_at?: string
          id?: string
          job_id?: string
          seal_no?: string | null
          size_type?: string | null
          sr_no?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_containers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_containers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_containers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_delivery_plans: {
        Row: {
          cfs_id: string | null
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          job_clearance_id: string
          job_id: string
          planned_for: string
          requested_by: string | null
          status: Database["public"]["Enums"]["document_request_status"]
          support_notified_at: string | null
          updated_at: string
        }
        Insert: {
          cfs_id?: string | null
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          job_clearance_id: string
          job_id: string
          planned_for: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["document_request_status"]
          support_notified_at?: string | null
          updated_at?: string
        }
        Update: {
          cfs_id?: string | null
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          job_clearance_id?: string
          job_id?: string
          planned_for?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["document_request_status"]
          support_notified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_delivery_plans_cfs_id_fkey"
            columns: ["cfs_id"]
            isOneToOne: false
            referencedRelation: "cfs_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_delivery_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_delivery_plans_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_delivery_plans_job_clearance_id_fkey"
            columns: ["job_clearance_id"]
            isOneToOne: false
            referencedRelation: "job_clearance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_delivery_plans_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_delivery_plans_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_do: {
        Row: {
          bl_checked_at: string | null
          bl_checked_by: string | null
          bl_collected: boolean
          bl_surrender_mode: string | null
          bl_surrendered: boolean | null
          company_id: string
          created_at: string
          delivered_at: string | null
          delivery_mode: Database["public"]["Enums"]["do_delivery_mode"] | null
          deposit_expected: number | null
          do_channel: string | null
          do_number: string | null
          do_received_at: string | null
          do_valid_until: string | null
          free_days: number | null
          free_days_source: string | null
          free_time_from: string | null
          hss_docs_sent_at: string | null
          hss_flagged_at: string | null
          id: string
          is_high_sea_sale: boolean
          job_id: string
          notes: string | null
          operations_notified_at: string | null
          security_covers: boolean | null
          security_id: string | null
          shipping_line_id: string | null
          status: Database["public"]["Enums"]["do_status"]
          updated_at: string
        }
        Insert: {
          bl_checked_at?: string | null
          bl_checked_by?: string | null
          bl_collected?: boolean
          bl_surrender_mode?: string | null
          bl_surrendered?: boolean | null
          company_id: string
          created_at?: string
          delivered_at?: string | null
          delivery_mode?: Database["public"]["Enums"]["do_delivery_mode"] | null
          deposit_expected?: number | null
          do_channel?: string | null
          do_number?: string | null
          do_received_at?: string | null
          do_valid_until?: string | null
          free_days?: number | null
          free_days_source?: string | null
          free_time_from?: string | null
          hss_docs_sent_at?: string | null
          hss_flagged_at?: string | null
          id?: string
          is_high_sea_sale?: boolean
          job_id: string
          notes?: string | null
          operations_notified_at?: string | null
          security_covers?: boolean | null
          security_id?: string | null
          shipping_line_id?: string | null
          status?: Database["public"]["Enums"]["do_status"]
          updated_at?: string
        }
        Update: {
          bl_checked_at?: string | null
          bl_checked_by?: string | null
          bl_collected?: boolean
          bl_surrender_mode?: string | null
          bl_surrendered?: boolean | null
          company_id?: string
          created_at?: string
          delivered_at?: string | null
          delivery_mode?: Database["public"]["Enums"]["do_delivery_mode"] | null
          deposit_expected?: number | null
          do_channel?: string | null
          do_number?: string | null
          do_received_at?: string | null
          do_valid_until?: string | null
          free_days?: number | null
          free_days_source?: string | null
          free_time_from?: string | null
          hss_docs_sent_at?: string | null
          hss_flagged_at?: string | null
          id?: string
          is_high_sea_sale?: boolean
          job_id?: string
          notes?: string | null
          operations_notified_at?: string | null
          security_covers?: boolean | null
          security_id?: string | null
          shipping_line_id?: string | null
          status?: Database["public"]["Enums"]["do_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_do_bl_checked_by_fkey"
            columns: ["bl_checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_security_id_fkey"
            columns: ["security_id"]
            isOneToOne: false
            referencedRelation: "importer_line_securities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_shipping_line_id_fkey"
            columns: ["shipping_line_id"]
            isOneToOne: false
            referencedRelation: "shipping_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      job_do_containers: {
        Row: {
          company_id: string
          container_no: string
          created_at: string
          deposit_amount: number | null
          deposit_claimed_on: string | null
          deposit_paid_on: string | null
          deposit_refunded_on: string | null
          deposit_status: Database["public"]["Enums"]["do_deposit_status"]
          free_days: number | null
          free_time_from: string | null
          gated_out_on: string | null
          id: string
          job_do_id: string
          job_id: string
          returned_on: string | null
          size_type: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          container_no: string
          created_at?: string
          deposit_amount?: number | null
          deposit_claimed_on?: string | null
          deposit_paid_on?: string | null
          deposit_refunded_on?: string | null
          deposit_status?: Database["public"]["Enums"]["do_deposit_status"]
          free_days?: number | null
          free_time_from?: string | null
          gated_out_on?: string | null
          id?: string
          job_do_id: string
          job_id: string
          returned_on?: string | null
          size_type?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          container_no?: string
          created_at?: string
          deposit_amount?: number | null
          deposit_claimed_on?: string | null
          deposit_paid_on?: string | null
          deposit_refunded_on?: string | null
          deposit_status?: Database["public"]["Enums"]["do_deposit_status"]
          free_days?: number | null
          free_time_from?: string | null
          gated_out_on?: string | null
          id?: string
          job_do_id?: string
          job_id?: string
          returned_on?: string | null
          size_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_do_containers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_containers_job_do_id_fkey"
            columns: ["job_do_id"]
            isOneToOne: false
            referencedRelation: "job_do"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_containers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_do_documents: {
        Row: {
          company_id: string
          created_at: string
          document_id: string | null
          id: string
          job_do_id: string
          job_id: string
          name: string
          required_for: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["document_request_status"]
        }
        Insert: {
          company_id: string
          created_at?: string
          document_id?: string | null
          id?: string
          job_do_id: string
          job_id: string
          name: string
          required_for?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["document_request_status"]
        }
        Update: {
          company_id?: string
          created_at?: string
          document_id?: string | null
          id?: string
          job_do_id?: string
          job_id?: string
          name?: string
          required_for?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["document_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "job_do_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "job_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_documents_job_do_id_fkey"
            columns: ["job_do_id"]
            isOneToOne: false
            referencedRelation: "job_do"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_documents_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_do_invoices: {
        Row: {
          accounts_notified_at: string | null
          amount: number | null
          company_id: string
          created_at: string
          currency: string
          document_id: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          job_do_id: string
          job_id: string
          kind: Database["public"]["Enums"]["do_invoice_kind"]
          paid_on: string | null
          payment_amount: number | null
          payment_reference: string | null
          proof_document_id: string | null
          proof_sent_at: string | null
          scrutinised_at: string | null
          scrutinised_by: string | null
          scrutiny_note: string | null
          updated_at: string
        }
        Insert: {
          accounts_notified_at?: string | null
          amount?: number | null
          company_id: string
          created_at?: string
          currency?: string
          document_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          job_do_id: string
          job_id: string
          kind: Database["public"]["Enums"]["do_invoice_kind"]
          paid_on?: string | null
          payment_amount?: number | null
          payment_reference?: string | null
          proof_document_id?: string | null
          proof_sent_at?: string | null
          scrutinised_at?: string | null
          scrutinised_by?: string | null
          scrutiny_note?: string | null
          updated_at?: string
        }
        Update: {
          accounts_notified_at?: string | null
          amount?: number | null
          company_id?: string
          created_at?: string
          currency?: string
          document_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          job_do_id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["do_invoice_kind"]
          paid_on?: string | null
          payment_amount?: number | null
          payment_reference?: string | null
          proof_document_id?: string | null
          proof_sent_at?: string | null
          scrutinised_at?: string | null
          scrutinised_by?: string | null
          scrutiny_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_do_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_invoices_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "job_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_invoices_job_do_id_fkey"
            columns: ["job_do_id"]
            isOneToOne: false
            referencedRelation: "job_do"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_invoices_proof_document_id_fkey"
            columns: ["proof_document_id"]
            isOneToOne: false
            referencedRelation: "job_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_do_invoices_scrutinised_by_fkey"
            columns: ["scrutinised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_document_esanchit: {
        Row: {
          company_id: string
          created_at: string
          doc_type_code: string | null
          document_id: string
          expiry_date: string | null
          id: string
          invoice_sr_no: number | null
          irn: string
          issue_date: string | null
          issued_at: string | null
          item_sr_no: number | null
          job_id: string
          reference_no: string | null
          updated_at: string
          updated_by: string | null
          uploaded_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          doc_type_code?: string | null
          document_id: string
          expiry_date?: string | null
          id?: string
          invoice_sr_no?: number | null
          irn: string
          issue_date?: string | null
          issued_at?: string | null
          item_sr_no?: number | null
          job_id: string
          reference_no?: string | null
          updated_at?: string
          updated_by?: string | null
          uploaded_at: string
        }
        Update: {
          company_id?: string
          created_at?: string
          doc_type_code?: string | null
          document_id?: string
          expiry_date?: string | null
          id?: string
          invoice_sr_no?: number | null
          irn?: string
          issue_date?: string | null
          issued_at?: string | null
          item_sr_no?: number | null
          job_id?: string
          reference_no?: string | null
          updated_at?: string
          updated_by?: string | null
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_document_esanchit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_document_esanchit_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "job_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_document_esanchit_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_document_esanchit_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      job_hss_chain: {
        Row: {
          ad_code: string | null
          address: string | null
          branch_name: string | null
          branch_sr_no: number | null
          city: string | null
          company_id: string
          country: string | null
          created_at: string
          id: string
          iec: string
          job_id: string
          level: number
          name: string | null
          postal_code: string | null
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ad_code?: string | null
          address?: string | null
          branch_name?: string | null
          branch_sr_no?: number | null
          city?: string | null
          company_id: string
          country?: string | null
          created_at?: string
          id?: string
          iec: string
          job_id: string
          level: number
          name?: string | null
          postal_code?: string | null
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ad_code?: string | null
          address?: string | null
          branch_name?: string | null
          branch_sr_no?: number | null
          city?: string | null
          company_id?: string
          country?: string | null
          created_at?: string
          id?: string
          iec?: string
          job_id?: string
          level?: number
          name?: string | null
          postal_code?: string | null
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_hss_chain_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_hss_chain_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_hss_chain_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      job_items: {
        Row: {
          classification_confirmed: boolean
          company_id: string
          created_at: string
          fields: Json
          id: string
          invoice_sr_no: number
          item_sr_no: number
          job_id: string
          re_import: Json | null
          re_import_confirmed: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          classification_confirmed?: boolean
          company_id: string
          created_at?: string
          fields?: Json
          id?: string
          invoice_sr_no: number
          item_sr_no: number
          job_id: string
          re_import?: Json | null
          re_import_confirmed?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          classification_confirmed?: boolean
          company_id?: string
          created_at?: string
          fields?: Json
          id?: string
          invoice_sr_no?: number
          item_sr_no?: number
          job_id?: string
          re_import?: Json | null
          re_import_confirmed?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_mail_instructions: {
        Row: {
          be_type: Database["public"]["Enums"]["be_type"] | null
          be_type_quote: string | null
          bond_no: string | null
          bond_quote: string | null
          branch_name: string | null
          branch_quote: string | null
          claim_fta_benefit: boolean | null
          claim_fta_benefit_quote: string | null
          company_id: string
          customs_house: string | null
          customs_house_code: string | null
          customs_house_quote: string | null
          deferred_duty: boolean | null
          deferred_duty_quote: string | null
          end_use: string | null
          end_use_quote: string | null
          extracted_at: string
          importer_ref_no: string | null
          importer_ref_quote: string | null
          inbond_be_no: string | null
          inbond_be_quote: string | null
          job_id: string
          message_count: number
          other_instructions: string[]
          warehouse: string | null
          warehouse_code: string | null
          warehouse_quote: string | null
        }
        Insert: {
          be_type?: Database["public"]["Enums"]["be_type"] | null
          be_type_quote?: string | null
          bond_no?: string | null
          bond_quote?: string | null
          branch_name?: string | null
          branch_quote?: string | null
          claim_fta_benefit?: boolean | null
          claim_fta_benefit_quote?: string | null
          company_id: string
          customs_house?: string | null
          customs_house_code?: string | null
          customs_house_quote?: string | null
          deferred_duty?: boolean | null
          deferred_duty_quote?: string | null
          end_use?: string | null
          end_use_quote?: string | null
          extracted_at?: string
          importer_ref_no?: string | null
          importer_ref_quote?: string | null
          inbond_be_no?: string | null
          inbond_be_quote?: string | null
          job_id: string
          message_count?: number
          other_instructions?: string[]
          warehouse?: string | null
          warehouse_code?: string | null
          warehouse_quote?: string | null
        }
        Update: {
          be_type?: Database["public"]["Enums"]["be_type"] | null
          be_type_quote?: string | null
          bond_no?: string | null
          bond_quote?: string | null
          branch_name?: string | null
          branch_quote?: string | null
          claim_fta_benefit?: boolean | null
          claim_fta_benefit_quote?: string | null
          company_id?: string
          customs_house?: string | null
          customs_house_code?: string | null
          customs_house_quote?: string | null
          deferred_duty?: boolean | null
          deferred_duty_quote?: string | null
          end_use?: string | null
          end_use_quote?: string | null
          extracted_at?: string
          importer_ref_no?: string | null
          importer_ref_quote?: string | null
          inbond_be_no?: string | null
          inbond_be_quote?: string | null
          job_id?: string
          message_count?: number
          other_instructions?: string[]
          warehouse?: string | null
          warehouse_code?: string | null
          warehouse_quote?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_mail_instructions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_mail_instructions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sec65_finished_goods: {
        Row: {
          applies_to_items: number[] | null
          company_id: string
          created_at: string
          finished_cth: string
          finished_desc: string
          finished_qty: number
          finished_uqc: string
          gst_invoice_date: string
          gst_invoice_no: string
          id: string
          job_id: string
          seq: number
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          applies_to_items?: number[] | null
          company_id: string
          created_at?: string
          finished_cth: string
          finished_desc: string
          finished_qty: number
          finished_uqc: string
          gst_invoice_date: string
          gst_invoice_no: string
          id?: string
          job_id: string
          seq: number
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          applies_to_items?: number[] | null
          company_id?: string
          created_at?: string
          finished_cth?: string
          finished_desc?: string
          finished_qty?: number
          finished_uqc?: string
          gst_invoice_date?: string
          gst_invoice_no?: string
          id?: string
          job_id?: string
          seq?: number
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_sec65_finished_goods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_sec65_finished_goods_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_sec65_finished_goods_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          assigned_to: string | null
          branch_id: string | null
          checklist_duty: number | null
          company_id: string
          created_at: string
          created_by: string | null
          eta: string | null
          hs_codes: string[]
          id: string
          importer_name: string | null
          into_bond_job_id: string | null
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
          checklist_duty?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          eta?: string | null
          hs_codes?: string[]
          id?: string
          importer_name?: string | null
          into_bond_job_id?: string | null
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
          checklist_duty?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          eta?: string | null
          hs_codes?: string[]
          id?: string
          importer_name?: string | null
          into_bond_job_id?: string | null
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
            foreignKeyName: "jobs_into_bond_job_id_fkey"
            columns: ["into_bond_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
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
          body_preview: string | null
          body_text: string | null
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
          body_preview?: string | null
          body_text?: string | null
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
          body_preview?: string | null
          body_text?: string | null
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
      organization_ad_codes: {
        Row: {
          ad_code: string
          bank_branch: string | null
          bank_name: string | null
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          organization_id: string
        }
        Insert: {
          ad_code: string
          bank_branch?: string | null
          bank_name?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          organization_id: string
        }
        Update: {
          ad_code?: string
          bank_branch?: string | null
          bank_name?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_ad_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_ad_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_imports: {
        Row: {
          company_id: string
          created_at: string
          file_name: string
          id: string
          imported_by: string | null
          inserted_count: number
          retired_count: number
          row_count: number
          sha256: string
          updated_count: number
          warnings: string[]
        }
        Insert: {
          company_id: string
          created_at?: string
          file_name: string
          id?: string
          imported_by?: string | null
          inserted_count?: number
          retired_count?: number
          row_count?: number
          sha256: string
          updated_count?: number
          warnings?: string[]
        }
        Update: {
          company_id?: string
          created_at?: string
          file_name?: string
          id?: string
          imported_by?: string | null
          inserted_count?: number
          retired_count?: number
          row_count?: number
          sha256?: string
          updated_count?: number
          warnings?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "organization_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_imports_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ad_code: string | null
          address1: string | null
          address2: string | null
          address3: string | null
          aeo_certificate_no: string | null
          aeo_status: Database["public"]["Enums"]["aeo_status"]
          aeo_valid_till: string | null
          alias: string | null
          bin: string | null
          branch_name: string
          branch_sr_no: string
          cin: string | null
          city: string | null
          company_id: string
          country: string | null
          country_code: string | null
          created_at: string
          default_custom_house: string | null
          default_end_use_code: string | null
          email: string | null
          gst_state_code: string | null
          gstin: string | null
          id: string
          iec: string | null
          importer_ref_required: boolean
          is_active: boolean
          is_agent: boolean
          is_consignee: boolean
          is_service_provider: boolean
          is_shipper: boolean
          is_transporter: boolean
          last_import_id: string | null
          lut_number: string | null
          marine_open_policy_rate_percent: number | null
          marine_policy_no: string | null
          marine_policy_per_sending_limit_inr: number | null
          marine_policy_sum_insured_inr: number | null
          marine_policy_valid_till: string | null
          name: string
          name_key: string
          pan: string | null
          postal_code: string | null
          raw: Json
          source_created_by: string | null
          source_created_on: string | null
          st_reg_no: string | null
          state: string | null
          telephone: string | null
          updated_at: string
          web_url: string | null
        }
        Insert: {
          ad_code?: string | null
          address1?: string | null
          address2?: string | null
          address3?: string | null
          aeo_certificate_no?: string | null
          aeo_status?: Database["public"]["Enums"]["aeo_status"]
          aeo_valid_till?: string | null
          alias?: string | null
          bin?: string | null
          branch_name?: string
          branch_sr_no?: string
          cin?: string | null
          city?: string | null
          company_id: string
          country?: string | null
          country_code?: string | null
          created_at?: string
          default_custom_house?: string | null
          default_end_use_code?: string | null
          email?: string | null
          gst_state_code?: string | null
          gstin?: string | null
          id?: string
          iec?: string | null
          importer_ref_required?: boolean
          is_active?: boolean
          is_agent?: boolean
          is_consignee?: boolean
          is_service_provider?: boolean
          is_shipper?: boolean
          is_transporter?: boolean
          last_import_id?: string | null
          lut_number?: string | null
          marine_open_policy_rate_percent?: number | null
          marine_policy_no?: string | null
          marine_policy_per_sending_limit_inr?: number | null
          marine_policy_sum_insured_inr?: number | null
          marine_policy_valid_till?: string | null
          name: string
          name_key: string
          pan?: string | null
          postal_code?: string | null
          raw?: Json
          source_created_by?: string | null
          source_created_on?: string | null
          st_reg_no?: string | null
          state?: string | null
          telephone?: string | null
          updated_at?: string
          web_url?: string | null
        }
        Update: {
          ad_code?: string | null
          address1?: string | null
          address2?: string | null
          address3?: string | null
          aeo_certificate_no?: string | null
          aeo_status?: Database["public"]["Enums"]["aeo_status"]
          aeo_valid_till?: string | null
          alias?: string | null
          bin?: string | null
          branch_name?: string
          branch_sr_no?: string
          cin?: string | null
          city?: string | null
          company_id?: string
          country?: string | null
          country_code?: string | null
          created_at?: string
          default_custom_house?: string | null
          default_end_use_code?: string | null
          email?: string | null
          gst_state_code?: string | null
          gstin?: string | null
          id?: string
          iec?: string | null
          importer_ref_required?: boolean
          is_active?: boolean
          is_agent?: boolean
          is_consignee?: boolean
          is_service_provider?: boolean
          is_shipper?: boolean
          is_transporter?: boolean
          last_import_id?: string | null
          lut_number?: string | null
          marine_open_policy_rate_percent?: number | null
          marine_policy_no?: string | null
          marine_policy_per_sending_limit_inr?: number | null
          marine_policy_sum_insured_inr?: number | null
          marine_policy_valid_till?: string | null
          name?: string
          name_key?: string
          pan?: string | null
          postal_code?: string | null
          raw?: Json
          source_created_by?: string | null
          source_created_on?: string | null
          st_reg_no?: string | null
          state?: string | null
          telephone?: string | null
          updated_at?: string
          web_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_last_import_id_fkey"
            columns: ["last_import_id"]
            isOneToOne: false
            referencedRelation: "organization_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      product_master: {
        Row: {
          brand: string | null
          company_id: string
          confirmed_at: string
          confirmed_by: string | null
          created_at: string
          cth: string
          description: string
          description_key: string
          end_use_code: string | null
          exim_scheme_code: string | null
          general_description: string | null
          id: string
          importer_org_id: string
          model: string | null
          notifications: Json
          source_job_id: string | null
          times_used: number
          updated_at: string
        }
        Insert: {
          brand?: string | null
          company_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          cth: string
          description: string
          description_key: string
          end_use_code?: string | null
          exim_scheme_code?: string | null
          general_description?: string | null
          id?: string
          importer_org_id: string
          model?: string | null
          notifications?: Json
          source_job_id?: string | null
          times_used?: number
          updated_at?: string
        }
        Update: {
          brand?: string | null
          company_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          cth?: string
          description?: string
          description_key?: string
          end_use_code?: string | null
          exim_scheme_code?: string | null
          general_description?: string | null
          id?: string
          importer_org_id?: string
          model?: string | null
          notifications?: Json
          source_job_id?: string | null
          times_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_master_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_master_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_master_importer_org_id_fkey"
            columns: ["importer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_master_source_job_id_fkey"
            columns: ["source_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          cfs_id: string | null
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
          cfs_id?: string | null
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
          cfs_id?: string | null
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
            foreignKeyName: "profiles_cfs_id_fkey"
            columns: ["cfs_id"]
            isOneToOne: false
            referencedRelation: "cfs_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_chunks: {
        Row: {
          category: string | null
          chunk_no: number
          doc_date: string | null
          embedding: unknown
          id: number
          indexed_at: string
          is_amended: boolean
          is_current: boolean
          number: string | null
          number_key: string | null
          page: number
          source_id: number
          source_type: string
          source_url: string | null
          text: string
          text_hash: string
          title: string
        }
        Insert: {
          category?: string | null
          chunk_no: number
          doc_date?: string | null
          embedding: unknown
          id?: never
          indexed_at?: string
          is_amended?: boolean
          is_current?: boolean
          number?: string | null
          number_key?: string | null
          page: number
          source_id: number
          source_type: string
          source_url?: string | null
          text: string
          text_hash: string
          title: string
        }
        Update: {
          category?: string | null
          chunk_no?: number
          doc_date?: string | null
          embedding?: unknown
          id?: never
          indexed_at?: string
          is_amended?: boolean
          is_current?: boolean
          number?: string | null
          number_key?: string | null
          page?: number
          source_id?: number
          source_type?: string
          source_url?: string | null
          text?: string
          text_hash?: string
          title?: string
        }
        Relationships: []
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
      shipping_line_deposit_rates: {
        Row: {
          amount: number
          company_id: string
          container_size: string
          created_at: string
          currency: string
          delivery_mode: Database["public"]["Enums"]["do_delivery_mode"]
          id: string
          shipping_line_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          company_id: string
          container_size: string
          created_at?: string
          currency?: string
          delivery_mode: Database["public"]["Enums"]["do_delivery_mode"]
          id?: string
          shipping_line_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          container_size?: string
          created_at?: string
          currency?: string
          delivery_mode?: Database["public"]["Enums"]["do_delivery_mode"]
          id?: string
          shipping_line_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_line_deposit_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_line_deposit_rates_shipping_line_id_fkey"
            columns: ["shipping_line_id"]
            isOneToOne: false
            referencedRelation: "shipping_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_lines: {
        Row: {
          agent_name: string | null
          aliases: string[]
          company_id: string
          created_at: string
          default_free_days: number | null
          do_email: string | null
          id: string
          is_active: boolean
          issues_do_via: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          agent_name?: string | null
          aliases?: string[]
          company_id: string
          created_at?: string
          default_free_days?: number | null
          do_email?: string | null
          id?: string
          is_active?: boolean
          issues_do_via?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          agent_name?: string | null
          aliases?: string[]
          company_id?: string
          created_at?: string
          default_free_days?: number | null
          do_email?: string | null
          id?: string
          is_active?: boolean
          issues_do_via?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_relationships: {
        Row: {
          base: string | null
          company_id: string
          condition: string | null
          created_at: string
          id: string
          importer_org_id: string
          is_related: boolean
          notes: string | null
          revenue_deposit_percent: number | null
          supplier_org_id: string
          svb_custom_house: string | null
          svb_date: string | null
          svb_loading_basis: string | null
          svb_rate_assessable: number | null
          svb_rate_duty: number | null
          svb_ref_no: string | null
          svb_status_assessable: string | null
          svb_status_duty: string | null
          updated_at: string
        }
        Insert: {
          base?: string | null
          company_id: string
          condition?: string | null
          created_at?: string
          id?: string
          importer_org_id: string
          is_related?: boolean
          notes?: string | null
          revenue_deposit_percent?: number | null
          supplier_org_id: string
          svb_custom_house?: string | null
          svb_date?: string | null
          svb_loading_basis?: string | null
          svb_rate_assessable?: number | null
          svb_rate_duty?: number | null
          svb_ref_no?: string | null
          svb_status_assessable?: string | null
          svb_status_duty?: string | null
          updated_at?: string
        }
        Update: {
          base?: string | null
          company_id?: string
          condition?: string | null
          created_at?: string
          id?: string
          importer_org_id?: string
          is_related?: boolean
          notes?: string | null
          revenue_deposit_percent?: number | null
          supplier_org_id?: string
          svb_custom_house?: string | null
          svb_date?: string | null
          svb_loading_basis?: string | null
          svb_rate_assessable?: number | null
          svb_rate_duty?: number | null
          svb_ref_no?: string | null
          svb_status_assessable?: string | null
          svb_status_duty?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_relationships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_relationships_importer_org_id_fkey"
            columns: ["importer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_relationships_supplier_org_id_fkey"
            columns: ["supplier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      match_reference_chunks: {
        Args: {
          match_count?: number
          only_current?: boolean
          query_embedding: unknown
          source_types?: string[]
        }
        Returns: {
          category: string
          chunk_no: number
          doc_date: string
          id: number
          is_current: boolean
          number: string
          page: number
          similarity: number
          source_id: number
          source_type: string
          source_url: string
          text: string
          title: string
        }[]
      }
      reference_chunks_stats: {
        Args: never
        Returns: {
          chunks: number
          database_bytes: number
          documents: number
          source_type: string
        }[]
      }
      search_organizations: {
        Args: {
          p_company: string
          p_limit?: number
          p_query: string
          p_role?: string
        }
        Returns: {
          ad_code: string | null
          address1: string | null
          address2: string | null
          address3: string | null
          aeo_certificate_no: string | null
          aeo_status: Database["public"]["Enums"]["aeo_status"]
          aeo_valid_till: string | null
          alias: string | null
          bin: string | null
          branch_name: string
          branch_sr_no: string
          cin: string | null
          city: string | null
          company_id: string
          country: string | null
          country_code: string | null
          created_at: string
          default_custom_house: string | null
          default_end_use_code: string | null
          email: string | null
          gst_state_code: string | null
          gstin: string | null
          id: string
          iec: string | null
          importer_ref_required: boolean
          is_active: boolean
          is_agent: boolean
          is_consignee: boolean
          is_service_provider: boolean
          is_shipper: boolean
          is_transporter: boolean
          last_import_id: string | null
          lut_number: string | null
          marine_open_policy_rate_percent: number | null
          marine_policy_no: string | null
          marine_policy_per_sending_limit_inr: number | null
          marine_policy_sum_insured_inr: number | null
          marine_policy_valid_till: string | null
          name: string
          name_key: string
          pan: string | null
          postal_code: string | null
          raw: Json
          source_created_by: string | null
          source_created_on: string | null
          st_reg_no: string | null
          state: string | null
          telephone: string | null
          updated_at: string
          web_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      aeo_status: "none" | "T1" | "T2" | "T3"
      app_role: "platform_admin" | "company_owner" | "company_admin" | "member"
      be_type: "home_consumption" | "warehousing" | "ex_bond"
      bond_or_certificate: "bond" | "certificate"
      clearance_query_status: "open" | "replied" | "closed"
      clearance_status:
        | "noting"
        | "passing"
        | "duty_variance"
        | "duty_payment"
        | "goods_registration"
        | "examination"
        | "out_of_charge"
        | "delivery_planning"
        | "delivered"
      company_status: "active" | "suspended"
      connection_status: "active" | "needs_reauth" | "disabled"
      do_delivery_mode: "loaded" | "destuffed"
      do_deposit_status:
        | "not_applicable"
        | "pending"
        | "paid"
        | "claimed"
        | "refunded"
        | "forfeited"
      do_invoice_kind: "proforma" | "final"
      do_status:
        | "open"
        | "documents"
        | "invoice"
        | "payment"
        | "awaiting_do"
        | "do_received"
        | "delivered"
        | "closed"
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
        | "into_bond_be"
        | "freight_certificate"
        | "insurance_certificate"
        | "purchase_order"
        | "contract"
        | "gst_tax_invoice"
        | "shipping_bill"
        | "bank_certificate"
        | "high_seas_agreement"
      exbond_clearance_kind:
        | "resultant_product"
        | "as_such"
        | "capital_goods"
        | "job_work_return"
      filing_status: "advance" | "prior" | "normal"
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
      noc_status: "not_required" | "pending" | "received"
      rms_route: "facilitated" | "assessment" | "examination"
      team_kind: "scrutiny" | "do" | "customs" | "cfs" | "customer_support"
      transport_mode: "sea" | "air" | "land"
      user_status: "invited" | "active" | "disabled"
      warehouse_source: "icegate" | "operator" | "document"
      warehouse_type: "public" | "private" | "special"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      aeo_status: ["none", "T1", "T2", "T3"],
      app_role: ["platform_admin", "company_owner", "company_admin", "member"],
      be_type: ["home_consumption", "warehousing", "ex_bond"],
      bond_or_certificate: ["bond", "certificate"],
      clearance_query_status: ["open", "replied", "closed"],
      clearance_status: [
        "noting",
        "passing",
        "duty_variance",
        "duty_payment",
        "goods_registration",
        "examination",
        "out_of_charge",
        "delivery_planning",
        "delivered",
      ],
      company_status: ["active", "suspended"],
      connection_status: ["active", "needs_reauth", "disabled"],
      do_delivery_mode: ["loaded", "destuffed"],
      do_deposit_status: [
        "not_applicable",
        "pending",
        "paid",
        "claimed",
        "refunded",
        "forfeited",
      ],
      do_invoice_kind: ["proforma", "final"],
      do_status: [
        "open",
        "documents",
        "invoice",
        "payment",
        "awaiting_do",
        "do_received",
        "delivered",
        "closed",
      ],
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
        "into_bond_be",
        "freight_certificate",
        "insurance_certificate",
        "purchase_order",
        "contract",
        "gst_tax_invoice",
        "shipping_bill",
        "bank_certificate",
        "high_seas_agreement",
      ],
      exbond_clearance_kind: [
        "resultant_product",
        "as_such",
        "capital_goods",
        "job_work_return",
      ],
      filing_status: ["advance", "prior", "normal"],
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
      noc_status: ["not_required", "pending", "received"],
      rms_route: ["facilitated", "assessment", "examination"],
      team_kind: ["scrutiny", "do", "customs", "cfs", "customer_support"],
      transport_mode: ["sea", "air", "land"],
      user_status: ["invited", "active", "disabled"],
      warehouse_source: ["icegate", "operator", "document"],
      warehouse_type: ["public", "private", "special"],
    },
  },
} as const
