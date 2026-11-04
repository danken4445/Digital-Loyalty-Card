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
          tenant_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          target?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          target?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_cards: {
        Row: {
          added_at: string;
          consent_version: string;
          customer_id: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          added_at?: string;
          consent_version?: string;
          customer_id: string;
          tenant_id: string;
        };
        Update: {
          added_at?: string;
          consent_version?: string;
          customer_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_cards_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_cards_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
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
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id: string;
          id?: string;
          perk: string;
          staff_id: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          perk?: string;
          staff_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'perk_claims_card_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'card_balances';
            referencedColumns: ['tenant_id', 'customer_id'];
          },
          {
            foreignKeyName: 'perk_claims_card_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_cards';
            referencedColumns: ['tenant_id', 'customer_id'];
          },
          {
            foreignKeyName: 'perk_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'perk_claims_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
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
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id: string;
          id?: string;
          staff_id: string;
          stamps_used: number;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          staff_id?: string;
          stamps_used?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'redemptions_card_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'card_balances';
            referencedColumns: ['tenant_id', 'customer_id'];
          },
          {
            foreignKeyName: 'redemptions_card_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_cards';
            referencedColumns: ['tenant_id', 'customer_id'];
          },
          {
            foreignKeyName: 'redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'redemptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
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
          tenant_id: string;
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
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          reason?: string | null;
          source?: string;
          staff_id?: string | null;
          tag_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stamps_card_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'card_balances';
            referencedColumns: ['tenant_id', 'customer_id'];
          },
          {
            foreignKeyName: 'stamps_card_fkey';
            columns: ['tenant_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_cards';
            referencedColumns: ['tenant_id', 'customer_id'];
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
          {
            foreignKeyName: 'stamps_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
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
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          deactivated_at?: string | null;
          id: string;
          label?: string | null;
          tenant_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          deactivated_at?: string | null;
          id?: string;
          label?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tags_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_domains: {
        Row: {
          host: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          host: string;
          tenant_id: string;
        };
        Update: {
          host?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_domains_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_members: {
        Row: {
          active: boolean;
          created_at: string;
          display_name: string;
          role: string;
          tenant_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          display_name: string;
          role?: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_name?: string;
          role?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_members_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_settings: {
        Row: {
          brand: NonNullable<Json>;
          cooldown_minutes: number;
          currency: string;
          daily_cap: number;
          perks: NonNullable<Json>;
          reward_label: string;
          reward_threshold: number;
          tag_throttle_seconds: number;
          tenant_id: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          brand?: NonNullable<Json>;
          cooldown_minutes?: number;
          currency?: string;
          daily_cap?: number;
          perks?: NonNullable<Json>;
          reward_label?: string;
          reward_threshold?: number;
          tag_throttle_seconds?: number;
          tenant_id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          brand?: NonNullable<Json>;
          cooldown_minutes?: number;
          currency?: string;
          daily_cap?: number;
          perks?: NonNullable<Json>;
          reward_label?: string;
          reward_threshold?: number;
          tag_throttle_seconds?: number;
          tenant_id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          status?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      card_balances: {
        Row: {
          available_stamps: number | null;
          customer_id: string;
          last_stamped_at: string | null;
          stamps_redeemed: number | null;
          tenant_id: string;
          total_stamps: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: 'customer_cards_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_cards_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      add_card: {
        Args: { p_consent_version?: string; p_customer: string; p_tenant: string };
        Returns: string;
      };
      claim_card_perk: {
        Args: { p_actor: string; p_customer: string; p_perk: string; p_tenant: string };
        Returns: string;
      };
      cleanup_stale_anonymous_customers: { Args: { p_older_than?: string }; Returns: number };
      create_tag: {
        Args: { p_actor: string; p_label?: string; p_tag_id: string; p_tenant: string };
        Returns: string;
      };
      deactivate_tag: {
        Args: { p_actor: string; p_tag_id: string; p_tenant: string };
        Returns: string;
      };
      delete_wallet: { Args: { p_customer: string }; Returns: boolean };
      ensure_customer: { Args: { p_customer: string }; Returns: string };
      log_audit_event: {
        Args: {
          p_action: string;
          p_actor: string;
          p_detail?: Json;
          p_target?: string;
          p_tenant?: string;
        };
        Returns: string;
      };
      merge_nonce_used: { Args: { p_nonce: string }; Returns: boolean };
      merge_wallets: { Args: { p_source: string; p_target: string }; Returns: Json };
      redeem_card_reward: {
        Args: { p_actor: string; p_customer: string; p_nonce: string; p_tenant: string };
        Returns: string;
      };
      remove_card: { Args: { p_customer: string; p_tenant: string }; Returns: boolean };
      rotate_tag: {
        Args: {
          p_actor: string;
          p_label?: string;
          p_new_tag_id: string;
          p_old_tag_id: string;
          p_tenant: string;
        };
        Returns: string;
      };
      stamp_card_manual: {
        Args: {
          p_actor: string;
          p_customer: string;
          p_now?: string;
          p_reason: string;
          p_tenant: string;
        };
        Returns: string;
      };
      stamp_card_nfc: {
        Args: { p_customer: string; p_now?: string; p_tag: string };
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
