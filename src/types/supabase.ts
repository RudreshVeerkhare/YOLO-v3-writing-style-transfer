// ============================================================
// Supabase Database Types
// Auto-generated types for the gallery database schema
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      papers: {
        Row: {
          id: string;
          arxiv_id: string;
          title: string;
          authors: string[];
          original_abstract: string;
          file_path: string;
          public_url: string;
          version: number;
          parent_version_id: string | null;
          contributor_name: string | null;
          contributor_twitter: string | null;
          tags: string[];
          view_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          arxiv_id: string;
          title: string;
          authors: string[];
          original_abstract: string;
          file_path: string;
          public_url: string;
          version?: number;
          parent_version_id?: string | null;
          contributor_name?: string | null;
          contributor_twitter?: string | null;
          tags?: string[];
          view_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          arxiv_id?: string;
          title?: string;
          authors?: string[];
          original_abstract?: string;
          file_path?: string;
          public_url?: string;
          version?: number;
          parent_version_id?: string | null;
          contributor_name?: string | null;
          contributor_twitter?: string | null;
          tags?: string[];
          view_count?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}

// Convenience type for a paper record
export type Paper = Database['public']['Tables']['papers']['Row'];
export type PaperInsert = Database['public']['Tables']['papers']['Insert'];
export type PaperUpdate = Database['public']['Tables']['papers']['Update'];
