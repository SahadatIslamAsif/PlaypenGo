export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          assessment_id: string
          created_at: string
          id: string
          kind: string
          last_sent_at: string | null
          sent_count: number
          student_id: string
          target_date: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          id?: string
          kind: string
          last_sent_at?: string | null
          sent_count?: number
          student_id: string
          target_date: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          id?: string
          kind?: string
          last_sent_at?: string | null
          sent_count?: number
          student_id?: string
          target_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_assessment_id_student_id_fkey"
            columns: ["assessment_id", "student_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id", "student_id"]
          },
          {
            foreignKeyName: "alerts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_chapters: {
        Row: {
          assessment_id: string
          chapter_id: string
          created_at: string
          id: string
          student_id: string
        }
        Insert: {
          assessment_id: string
          chapter_id: string
          created_at?: string
          id?: string
          student_id: string
        }
        Update: {
          assessment_id?: string
          chapter_id?: string
          created_at?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_chapters_assessment_id_student_id_fkey"
            columns: ["assessment_id", "student_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id", "student_id"]
          },
          {
            foreignKeyName: "assessment_chapters_chapter_id_student_id_fkey"
            columns: ["chapter_id", "student_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      assessments: {
        Row: {
          created_at: string
          created_by: string
          id: string
          occurred_date: string | null
          paper_id: string | null
          scheduled_date: string | null
          status: string
          student_id: string
          student_subject_id: string
          type: string
          window_close_reason: string | null
          window_closed_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          occurred_date?: string | null
          paper_id?: string | null
          scheduled_date?: string | null
          status?: string
          student_id: string
          student_subject_id: string
          type: string
          window_close_reason?: string | null
          window_closed_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          occurred_date?: string | null
          paper_id?: string | null
          scheduled_date?: string | null
          status?: string
          student_id?: string
          student_subject_id?: string
          type?: string
          window_close_reason?: string | null
          window_closed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_paper_id_student_id_fkey"
            columns: ["paper_id", "student_id"]
            isOneToOne: false
            referencedRelation: "subject_papers"
            referencedColumns: ["id", "student_id"]
          },
          {
            foreignKeyName: "assessments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_student_subject_id_student_id_fkey"
            columns: ["student_subject_id", "student_id"]
            isOneToOne: false
            referencedRelation: "student_subjects"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      chapters: {
        Row: {
          created_at: string
          id: string
          name: string
          paper_id: string | null
          semester: string | null
          session_label: string | null
          sort_order: number
          source: string
          status: string
          status_updated_at: string
          student_id: string
          student_subject_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          paper_id?: string | null
          semester?: string | null
          session_label?: string | null
          sort_order?: number
          source?: string
          status?: string
          status_updated_at?: string
          student_id: string
          student_subject_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          paper_id?: string | null
          semester?: string | null
          session_label?: string | null
          sort_order?: number
          source?: string
          status?: string
          status_updated_at?: string
          student_id?: string
          student_subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chapters_paper_id_student_id_fkey"
            columns: ["paper_id", "student_id"]
            isOneToOne: false
            referencedRelation: "subject_papers"
            referencedColumns: ["id", "student_id"]
          },
          {
            foreignKeyName: "chapters_student_subject_id_student_id_fkey"
            columns: ["student_subject_id", "student_id"]
            isOneToOne: false
            referencedRelation: "student_subjects"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      confirm_tokens: {
        Row: {
          alert_id: string
          alert_kind: string
          answer: string | null
          created_at: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          alert_id: string
          alert_kind?: string
          answer?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          alert_id?: string
          alert_kind?: string
          answer?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confirm_tokens_alert_id_alert_kind_fkey"
            columns: ["alert_id", "alert_kind"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id", "kind"]
          },
        ]
      }
      email_log: {
        Row: {
          created_at: string
          email_type: string
          id: string
          payload: Json | null
          recipient_id: string
          send_date: string
          status: string
          subject_line: string | null
        }
        Insert: {
          created_at?: string
          email_type: string
          id?: string
          payload?: Json | null
          recipient_id: string
          send_date: string
          status: string
          subject_line?: string | null
        }
        Update: {
          created_at?: string
          email_type?: string
          id?: string
          payload?: Json | null
          recipient_id?: string
          send_date?: string
          status?: string
          subject_line?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_log_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_links: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          guardian_id: string
          id: string
          status: string
          student_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          guardian_id: string
          id?: string
          status?: string
          student_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          guardian_id?: string
          id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_links_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_links_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      link_code_attempts: {
        Row: {
          actor_id: string
          attempted_at: string
          attempted_code: string | null
          id: string
          succeeded: boolean
        }
        Insert: {
          actor_id: string
          attempted_at?: string
          attempted_code?: string | null
          id?: string
          succeeded?: boolean
        }
        Update: {
          actor_id?: string
          attempted_at?: string
          attempted_code?: string | null
          id?: string
          succeeded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "link_code_attempts_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      link_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          kind: string
          owner_id: string
          revoked_at: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          kind: string
          owner_id: string
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          owner_id?: string
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "link_codes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_codes_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          class_level: number | null
          created_at: string
          email: string
          full_name: string
          id: string
          role: string
          school: string
          section: string | null
          session_label: string | null
          timezone: string
        }
        Insert: {
          class_level?: number | null
          created_at?: string
          email: string
          full_name: string
          id: string
          role: string
          school?: string
          section?: string | null
          session_label?: string | null
          timezone?: string
        }
        Update: {
          class_level?: number | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: string
          school?: string
          section?: string | null
          session_label?: string | null
          timezone?: string
        }
        Relationships: []
      }
      result_images: {
        Row: {
          created_at: string
          id: string
          page_no: number
          raw_parse: Json | null
          result_id: string
          storage_path: string
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          page_no: number
          raw_parse?: Json | null
          result_id: string
          storage_path: string
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          page_no?: number
          raw_parse?: Json | null
          result_id?: string
          storage_path?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_images_result_id_student_id_fkey"
            columns: ["result_id", "student_id"]
            isOneToOne: false
            referencedRelation: "results"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      results: {
        Row: {
          assessment_id: string
          converted: number
          converted_scale: number
          created_at: string
          entry_mode: string
          id: string
          logged_at: string
          name_mismatch: boolean
          ocr_confidence: Json | null
          paper_missing: boolean
          parsed_student_name: string | null
          percentage: number
          raw_obtained: number
          raw_total: number
          student_id: string
          verified_by: string | null
        }
        Insert: {
          assessment_id: string
          converted?: number
          converted_scale: number
          created_at?: string
          entry_mode?: string
          id?: string
          logged_at?: string
          name_mismatch?: boolean
          ocr_confidence?: Json | null
          paper_missing?: boolean
          parsed_student_name?: string | null
          percentage?: number
          raw_obtained: number
          raw_total: number
          student_id: string
          verified_by?: string | null
        }
        Update: {
          assessment_id?: string
          converted?: number
          converted_scale?: number
          created_at?: string
          entry_mode?: string
          id?: string
          logged_at?: string
          name_mismatch?: boolean
          ocr_confidence?: Json | null
          paper_missing?: boolean
          parsed_student_name?: string | null
          percentage?: number
          raw_obtained?: number
          raw_total?: number
          student_id?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "results_assessment_id_student_id_fkey"
            columns: ["assessment_id", "student_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id", "student_id"]
          },
          {
            foreignKeyName: "results_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_periods: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string | null
          id: string
          is_academic: boolean
          period_no: number
          raw_text: string | null
          routine_id: string
          start_time: string | null
          student_id: string
          student_subject_id: string | null
          teacher_raw: string | null
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time?: string | null
          id?: string
          is_academic?: boolean
          period_no: number
          raw_text?: string | null
          routine_id: string
          start_time?: string | null
          student_id: string
          student_subject_id?: string | null
          teacher_raw?: string | null
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string | null
          id?: string
          is_academic?: boolean
          period_no?: number
          raw_text?: string | null
          routine_id?: string
          start_time?: string | null
          student_id?: string
          student_subject_id?: string | null
          teacher_raw?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routine_periods_routine_id_student_id_fkey"
            columns: ["routine_id", "student_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id", "student_id"]
          },
          {
            foreignKeyName: "routine_periods_student_subject_id_student_id_fkey"
            columns: ["student_subject_id", "student_id"]
            isOneToOne: false
            referencedRelation: "student_subjects"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      routines: {
        Row: {
          created_at: string
          id: string
          image_path: string | null
          is_active: boolean
          parsed_at: string | null
          session_label: string
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          parsed_at?: string | null
          session_label: string
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          parsed_at?: string | null
          session_label?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routines_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_jobs: {
        Row: {
          created_at: string
          error: string | null
          expires_at: string
          id: string
          raw_parse: Json | null
          result_id: string | null
          status: string
          student_id: string
          target_result_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          expires_at?: string
          id?: string
          raw_parse?: Json | null
          result_id?: string | null
          status?: string
          student_id: string
          target_result_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          expires_at?: string
          id?: string
          raw_parse?: Json | null
          result_id?: string | null
          status?: string
          student_id?: string
          target_result_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_jobs_result_id_student_id_fkey"
            columns: ["result_id", "student_id"]
            isOneToOne: false
            referencedRelation: "results"
            referencedColumns: ["id", "student_id"]
          },
          {
            foreignKeyName: "scan_jobs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_jobs_target_result_id_student_id_fkey"
            columns: ["target_result_id", "student_id"]
            isOneToOne: false
            referencedRelation: "results"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      scan_pages: {
        Row: {
          created_at: string
          has_header: boolean | null
          id: string
          page_no: number
          scan_job_id: string
          storage_path: string
          student_id: string
        }
        Insert: {
          created_at?: string
          has_header?: boolean | null
          id?: string
          page_no: number
          scan_job_id: string
          storage_path: string
          student_id: string
        }
        Update: {
          created_at?: string
          has_header?: boolean | null
          id?: string
          page_no?: number
          scan_job_id?: string
          storage_path?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_pages_scan_job_id_student_id_fkey"
            columns: ["scan_job_id", "student_id"]
            isOneToOne: false
            referencedRelation: "scan_jobs"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      student_subjects: {
        Row: {
          catalog_id: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          sort_order: number
          student_id: string
          teacher_name: string | null
        }
        Insert: {
          catalog_id?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          sort_order?: number
          student_id: string
          teacher_name?: string | null
        }
        Update: {
          catalog_id?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          student_id?: string
          teacher_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_subjects_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "subjects_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_subjects_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_aliases: {
        Row: {
          alias_text: string
          catalog_id: string | null
          created_at: string
          id: string
          source: string
          student_id: string | null
          student_subject_id: string | null
        }
        Insert: {
          alias_text: string
          catalog_id?: string | null
          created_at?: string
          id?: string
          source: string
          student_id?: string | null
          student_subject_id?: string | null
        }
        Update: {
          alias_text?: string
          catalog_id?: string | null
          created_at?: string
          id?: string
          source?: string
          student_id?: string | null
          student_subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subject_aliases_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "subjects_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_aliases_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_aliases_student_subject_id_fkey"
            columns: ["student_subject_id"]
            isOneToOne: false
            referencedRelation: "student_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_papers: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          student_id: string
          student_subject_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          student_id: string
          student_subject_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          student_id?: string
          student_subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_papers_student_subject_id_student_id_fkey"
            columns: ["student_subject_id", "student_id"]
            isOneToOne: false
            referencedRelation: "student_subjects"
            referencedColumns: ["id", "student_id"]
          },
        ]
      }
      subjects_catalog: {
        Row: {
          code: string | null
          common_aliases: string[]
          created_at: string
          id: string
          level: string
          name: string
        }
        Insert: {
          code?: string | null
          common_aliases?: string[]
          created_at?: string
          id?: string
          level: string
          name: string
        }
        Update: {
          code?: string | null
          common_aliases?: string[]
          created_at?: string
          id?: string
          level?: string
          name?: string
        }
        Relationships: []
      }
      tutor_allowlist: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      tutor_links: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          status: string
          student_id: string
          tutor_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          status?: string
          student_id: string
          tutor_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          status?: string
          student_id?: string
          tutor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_links_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tutor_links_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abandon_expired_scan_jobs: { Args: never; Returns: string[] }
      answer_confirm_token: {
        Args: { p_answer: string; p_token: string }
        Returns: Json
      }
      attach_scan_job_to_result: {
        Args: { p_entry: Json; p_job: string; p_result_id: string }
        Returns: Json
      }
      can_correct_result: { Args: { p_student: string }; Returns: boolean }
      can_read_student: { Args: { p_student: string }; Returns: boolean }
      capture_routine_alias: {
        Args: { p_raw: string; p_student: string; p_subject: string }
        Returns: boolean
      }
      commit_routine_grid: {
        Args: { p_grid: Json; p_session: string; p_student: string }
        Returns: Json
      }
      commit_syllabus_tree: {
        Args: { p_session: string; p_student: string; p_tree: Json }
        Returns: Json
      }
      confirm_scan_job: {
        Args: { p_entry: Json; p_job: string }
        Returns: Json
      }
      is_guardian_of: { Args: { p_student: string }; Returns: boolean }
      is_owner_student: { Args: { p_student: string }; Returns: boolean }
      is_pending_guardian_for_my_student: {
        Args: { p_other: string }
        Returns: boolean
      }
      is_tutor_of: { Args: { p_student: string }; Returns: boolean }
      issue_link_code: {
        Args: never
        Returns: {
          code: string
          created_at: string
          expires_at: string
          id: string
          kind: string
          owner_id: string
          revoked_at: string | null
          used_at: string | null
          used_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "link_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      log_manual_result: {
        Args: { p_entry: Json; p_student: string }
        Returns: Json
      }
      my_role: { Args: never; Returns: string }
      redeem_link_code: { Args: { p_code: string }; Returns: Json }
      set_assessment_chapters: {
        Args: { p_assessment: string; p_chapters: string[] }
        Returns: undefined
      }
      shares_link_with: { Args: { p_other: string }; Returns: boolean }
      storage_owner: { Args: { p_name: string }; Returns: string }
      update_routine_period: {
        Args: { p_patch: Json; p_period: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

