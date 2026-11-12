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
      billing_plans: {
        Row: {
          active: boolean;
          base_fee_centavos: number;
          code: string;
          created_at: string;
          description: string;
          included_customers: number;
          monthly_cap_centavos: number | null;
          name: string;
          per_customer_centavos: number;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          base_fee_centavos?: number;
          code: string;
          created_at?: string;
          description?: string;
          included_customers?: number;
          monthly_cap_centavos?: number | null;
          name: string;
          per_customer_centavos: number;
          sort_order?: number;
        };
        Update: {
          active?: boolean;
          base_fee_centavos?: number;
          code?: string;
          created_at?: string;
          description?: string;
          included_customers?: number;
          monthly_cap_centavos?: number | null;
          name?: string;
          per_customer_centavos?: number;
          sort_order?: number;
        };
        Relationships: [];
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
      locations: {
        Row: {
          active: boolean;
          address: string | null;
          card_mode: string;
          child_tenant_id: string | null;
          created_at: string;
          id: string;
          name: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          address?: string | null;
          card_mode?: string;
          child_tenant_id?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          tenant_id: string;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          card_mode?: string;
          child_tenant_id?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'locations_child_tenant_id_fkey';
            columns: ['child_tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'locations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
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
      milestone_claims: {
        Row: {
          created_at: string;
          customer_id: string;
          cycle_index: number;
          id: string;
          milestone_step: number;
          staff_id: string | null;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          customer_id: string;
          cycle_index: number;
          id?: string;
          milestone_step: number;
          staff_id?: string | null;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          cycle_index?: number;
          id?: string;
          milestone_step?: number;
          staff_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'milestone_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'milestone_claims_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
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
          location_id: string | null;
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
          location_id?: string | null;
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
          location_id?: string | null;
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
            foreignKeyName: 'stamps_location_tenant_fkey';
            columns: ['location_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id', 'tenant_id'];
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
      support_sessions: {
        Row: {
          admin_id: string;
          ended_at: string | null;
          expires_at: string;
          id: string;
          mode: string;
          reason: string;
          started_at: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          ended_at?: string | null;
          expires_at?: string;
          id?: string;
          mode?: string;
          reason: string;
          started_at?: string;
          tenant_id: string;
        };
        Update: {
          admin_id?: string;
          ended_at?: string | null;
          expires_at?: string;
          id?: string;
          mode?: string;
          reason?: string;
          started_at?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'support_sessions_tenant_id_fkey';
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
          hardware_uid: string | null;
          id: string;
          label: string | null;
          last_tap_counter: number | null;
          location_id: string | null;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          deactivated_at?: string | null;
          hardware_uid?: string | null;
          id: string;
          label?: string | null;
          last_tap_counter?: number | null;
          location_id?: string | null;
          tenant_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          deactivated_at?: string | null;
          hardware_uid?: string | null;
          id?: string;
          label?: string | null;
          last_tap_counter?: number | null;
          location_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tags_location_tenant_fkey';
            columns: ['location_id', 'tenant_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id', 'tenant_id'];
          },
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
      tenant_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role: string;
          tenant_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_invites_tenant_id_fkey';
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
      tenant_plan_selections: {
        Row: {
          chosen_by: string | null;
          created_at: string;
          effective_month: string;
          plan_code: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          chosen_by?: string | null;
          created_at?: string;
          effective_month: string;
          plan_code: string;
          tenant_id: string;
        };
        Update: {
          chosen_by?: string | null;
          created_at?: string;
          effective_month?: string;
          plan_code?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_plan_selections_plan_code_fkey';
            columns: ['plan_code'];
            isOneToOne: false;
            referencedRelation: 'billing_plans';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'tenant_plan_selections_tenant_id_fkey';
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
          milestone_reward_label: string | null;
          milestone_step: number | null;
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
          milestone_reward_label?: string | null;
          milestone_step?: number | null;
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
          milestone_reward_label?: string | null;
          milestone_step?: number | null;
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
          parent_tenant_id: string | null;
          slug: string;
          status: string;
          suspended_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          parent_tenant_id?: string | null;
          slug: string;
          status?: string;
          suspended_at?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          parent_tenant_id?: string | null;
          slug?: string;
          status?: string;
          suspended_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tenants_parent_tenant_id_fkey';
            columns: ['parent_tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
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
      accept_invite: {
        Args: { p_display_name: string; p_invite: string; p_user: string };
        Returns: string;
      };
      add_card: {
        Args: { p_consent_version?: string; p_customer: string; p_tenant: string };
        Returns: string;
      };
      choose_billing_plan: {
        Args: { p_actor: string; p_immediate?: boolean; p_plan: string; p_tenant: string };
        Returns: string;
      };
      claim_card_perk: {
        Args: { p_actor: string; p_customer: string; p_perk: string; p_tenant: string };
        Returns: string;
      };
      cleanup_stale_anonymous_customers: { Args: { p_older_than?: string }; Returns: number };
      create_location: {
        Args: { p_actor: string; p_address?: string; p_name: string; p_tenant: string };
        Returns: Json;
      };
      create_tag: {
        Args: { p_actor: string; p_label?: string; p_tag_id: string; p_tenant: string };
        Returns: string;
      };
      create_tag_at: {
        Args: {
          p_actor: string;
          p_label?: string;
          p_location?: string;
          p_tag_id: string;
          p_tenant: string;
        };
        Returns: string;
      };
      deactivate_tag: {
        Args: { p_actor: string; p_tag_id: string; p_tenant: string };
        Returns: string;
      };
      delete_wallet: { Args: { p_customer: string }; Returns: boolean };
      end_support_session: { Args: { p_admin: string; p_session: string }; Returns: string };
      ensure_customer: { Args: { p_customer: string }; Returns: string };
      get_billing_estimate: {
        Args: { p_actor: string; p_month?: string; p_tenant: string };
        Returns: Json;
      };
      get_owner_analytics: {
        Args: {
          p_actor: string;
          p_tenant: string;
          p_now?: string | null;
        };
        Returns: Json;
      };
      invite_member: {
        Args: { p_actor: string; p_email: string; p_role: string; p_tenant: string };
        Returns: string;
      };
      is_platform_admin_user: { Args: { p_user: string }; Returns: boolean };
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
      ops_cleanup_status: { Args: Record<PropertyKey, never>; Returns: Json };
      platform_create_tenant: {
        Args: { p_actor: string; p_name: string; p_owner_email: string; p_slug: string };
        Returns: Json;
      };
      preview_location_separation: {
        Args: { p_actor: string; p_location: string; p_tenant: string };
        Returns: Json;
      };
      preview_tenant_rules: {
        Args: { p_actor: string; p_patch: Json; p_tenant: string };
        Returns: Json;
      };
      redeem_card_reward: {
        Args: { p_actor: string; p_customer: string; p_nonce: string; p_tenant: string };
        Returns: string;
      };
      redeem_milestone_reward: {
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
      rotate_tag_at: {
        Args: {
          p_actor: string;
          p_label?: string;
          p_location?: string;
          p_new_tag_id: string;
          p_old_tag_id: string;
          p_tenant: string;
        };
        Returns: string;
      };
      set_location_card_mode: {
        Args: {
          p_actor: string;
          p_child_slug?: string;
          p_confirm_name?: string;
          p_location: string;
          p_mode: string;
          p_tenant: string;
        };
        Returns: Json;
      };
      set_member_active: {
        Args: { p_active: boolean; p_actor: string; p_tenant: string; p_user: string };
        Returns: string;
      };
      set_member_role: {
        Args: { p_actor: string; p_role: string; p_tenant: string; p_user: string };
        Returns: string;
      };
      set_tenant_status: {
        Args: { p_actor: string; p_reason: string; p_status: string; p_tenant: string };
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
        Args: {
          p_customer: string;
          p_now?: string;
          p_tag: string;
          p_tap_counter?: number | null;
          p_hardware_uid?: string | null;
        };
        Returns: Json;
      };
      start_support_session: {
        Args: { p_admin: string; p_reason: string; p_tenant: string };
        Returns: Json;
      };
      support_get_tenant_overview: { Args: { p_admin: string; p_session: string }; Returns: Json };
      support_list_recent_activity: {
        Args: { p_admin: string; p_limit?: number; p_session: string };
        Returns: Json;
      };
      tag_leak_signals: {
        Args: { p_actor: string; p_tenant: string; p_window_minutes?: number };
        Returns: Json;
      };
      update_location: {
        Args: {
          p_active: boolean;
          p_actor: string;
          p_address: string;
          p_location: string;
          p_name: string;
          p_tenant: string;
        };
        Returns: string;
      };
      update_tenant_brand: {
        Args: { p_actor: string; p_brand: Json; p_tenant: string };
        Returns: string;
      };
      update_tenant_rules: {
        Args: { p_actor: string; p_patch: Json; p_tenant: string };
        Returns: string;
      };
      platform_get_dashboard_overview: {
        Args: { p_actor: string };
        Returns: Json;
      };
      platform_generate_invoice: {
        Args: {
          p_actor: string;
          p_tenant: string;
          p_month: string;
          p_due_date: string;
          p_adjustment_centavos?: number;
          p_line_items?: Json;
          p_notes?: string | null;
          p_status?: string;
        };
        Returns: Json;
      };
      platform_update_invoice_status: {
        Args: {
          p_actor: string;
          p_invoice: string;
          p_status: string;
          p_reason?: string | null;
        };
        Returns: string;
      };
      platform_list_invoices: {
        Args: { p_actor: string; p_tenant?: string | null };
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
