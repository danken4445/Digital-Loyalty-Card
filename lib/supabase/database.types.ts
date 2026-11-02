export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor: string | null;
          created_at: string;
          detail: Json | null;
          id: string;
          target: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          target?: string | null;
        };
        Update: {
          action?: string;
          actor?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          target?: string | null;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          created_at: string;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
        };
        Relationships: [];
      };
      perk_claims: {
        Row: {
          created_at: string;
          customer_id: string;
          id: string;
          perk: string;
          staff_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id: string;
          id?: string;
          perk: string;
          staff_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          perk?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'perk_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_balances';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'perk_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
        ];
      };
      redemptions: {
        Row: {
          created_at: string;
          customer_id: string;
          id: string;
          staff_id: string;
          stamps_used: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id: string;
          id?: string;
          staff_id: string;
          stamps_used: number;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          staff_id?: string;
          stamps_used?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_balances';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
        ];
      };
      staff: {
        Row: {
          active: boolean;
          created_at: string;
          display_name: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          display_name: string;
          role?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_name?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      stamps: {
        Row: {
          created_at: string;
          customer_id: string;
          id: string;
          reason: string | null;
          source: string;
          staff_id: string | null;
          tag_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id: string;
          id?: string;
          reason?: string | null;
          source?: string;
          staff_id?: string | null;
          tag_id?: string | null;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          reason?: string | null;
          source?: string;
          staff_id?: string | null;
          tag_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'stamps_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_balances';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'stamps_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stamps_tag_id_fkey';
            columns: ['tag_id'];
            isOneToOne: false;
            referencedRelation: 'tags';
            referencedColumns: ['id'];
          },
        ];
      };
      tags: {
        Row: {
          active: boolean;
          created_at: string;
          deactivated_at: string | null;
          id: string;
          label: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          deactivated_at?: string | null;
          id: string;
          label?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          deactivated_at?: string | null;
          id?: string;
          label?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      customer_balances: {
        Row: {
          available_stamps: number | null;
          customer_id: string;
          last_stamped_at: string | null;
          stamps_redeemed: number | null;
          total_stamps: number | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      claim_instagram_upsize: {
        Args: { p_customer: string; p_staff: string };
        Returns: string;
      };
      cleanup_stale_anonymous_customers: {
        Args: { p_older_than?: string };
        Returns: number;
      };
      delete_customer_data: {
        Args: { p_customer: string };
        Returns: boolean;
      };
      ensure_customer: { Args: { p_customer: string }; Returns: string };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      log_audit_event: {
        Args: { p_action: string; p_actor: string; p_detail?: Json; p_target?: string };
        Returns: string;
      };
      merge_anonymous_customer: {
        Args: { p_source_customer: string; p_target_customer: string };
        Returns: string;
      };
      record_stamp: {
        Args: {
          p_customer: string;
          p_now?: string;
          p_reason?: string;
          p_source?: string;
          p_staff?: string;
          p_tag?: string;
        };
        Returns: string;
      };
      redeem_reward: {
        Args: { p_customer: string; p_nonce?: string; p_staff: string };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
