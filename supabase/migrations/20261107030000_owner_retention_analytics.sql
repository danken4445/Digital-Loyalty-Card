-- Migration: 20261107030000_owner_retention_analytics.sql
-- Description: Owner Retention & Loyalty Card Analytics RPC (get_owner_analytics)
--              Strictly owner-only (private.member_role = 'owner').
--              Computes retention, card funnel, cohort, and top 10 customer metrics
--              in the shop's configured timezone.

create or replace function public.get_owner_analytics(
  p_actor uuid,
  p_tenant uuid,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_tz text;
  v_threshold integer;
  v_reward_label text;
  v_now timestamptz;
  v_pulse jsonb;
  v_retention_health jsonb;
  v_card_funnel jsonb;
  v_cohorts jsonb;
  v_top_customers jsonb;
begin
  -- 1. Authorization check: strictly owner-only
  if p_tenant is null or p_actor is null then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  v_role := private.member_role(p_actor, p_tenant);
  if coalesce(v_role, '') != 'owner' then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  -- 2. Shop settings & timezone lookup
  select ts.timezone, ts.reward_threshold, ts.reward_label
  into v_tz, v_threshold, v_reward_label
  from public.tenant_settings as ts
  where ts.tenant_id = p_tenant;

  if not found then
    return pg_catalog.jsonb_build_object('result', 'not-found');
  end if;

  v_tz := coalesce(v_tz, 'UTC');
  v_threshold := coalesce(v_threshold, 10);
  v_reward_label := coalesce(v_reward_label, 'FREE COFFEE');
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());

  -- 3. Compute Pulse Metrics
  with customer_visit_days as (
    select
      s.customer_id,
      (s.created_at at time zone v_tz)::date as visit_date
    from public.stamps as s
    where s.tenant_id = p_tenant
    group by s.customer_id, (s.created_at at time zone v_tz)::date
  ),
  ranked_visits as (
    select
      cvd.customer_id,
      cvd.visit_date,
      row_number() over (partition by cvd.customer_id order by cvd.visit_date asc) as visit_num
    from customer_visit_days as cvd
  ),
  customer_visit_summary as (
    select
      rv.customer_id,
      count(*)::integer as total_visit_days,
      min(rv.visit_date) as first_visit_date,
      min(case when rv.visit_num = 2 then rv.visit_date end) as second_visit_date
    from ranked_visits as rv
    group by rv.customer_id
  ),
  visit_intervals as (
    select
      cvd.customer_id,
      (cvd.visit_date - lag(cvd.visit_date) over (partition by cvd.customer_id order by cvd.visit_date asc))::integer as interval_days
    from customer_visit_days as cvd
  ),
  median_interval as (
    select
      round((pg_catalog.percentile_cont(0.5) within group (order by vi.interval_days))::numeric, 1) as median_days
    from visit_intervals as vi
    where vi.interval_days is not null
  ),
  pulse_calc as (
    select
      (select count(*)::integer from public.customer_cards where tenant_id = p_tenant) as total_cards,
      (select count(distinct customer_id)::integer from public.stamps where tenant_id = p_tenant and created_at >= v_now - interval '30 days') as active_members_30d,
      (select count(*)::integer from public.customer_cards where tenant_id = p_tenant and added_at >= v_now - interval '30 days') as new_cards_30d,
      coalesce(
        round(
          (count(case when cvs.second_visit_date is not null and cvs.second_visit_date - cvs.first_visit_date <= 30 then 1 end)::numeric
           / nullif(count(*)::numeric, 0)) * 100.0,
          1
        ),
        0.0
      ) as repeat_rate_30d_pct,
      coalesce(
        round(
          (count(case when cvs.second_visit_date is not null and cvs.second_visit_date - cvs.first_visit_date <= 14 then 1 end)::numeric
           / nullif(count(*)::numeric, 0)) * 100.0,
          1
        ),
        0.0
      ) as repeat_rate_14d_pct,
      (select mi.median_days from median_interval as mi) as median_days_between_visits,
      (select count(*)::integer from public.redemptions where tenant_id = p_tenant and created_at >= v_now - interval '30 days') as rewards_claimed_30d,
      (select count(*)::integer from public.redemptions where tenant_id = p_tenant) as rewards_claimed_total,
      (select count(*)::integer from public.card_balances where tenant_id = p_tenant and available_stamps >= v_threshold) as rewards_ready_count
    from customer_visit_summary as cvs
  )
  select pg_catalog.jsonb_build_object(
    'totalCards', coalesce(pc.total_cards, 0),
    'activeMembers30d', coalesce(pc.active_members_30d, 0),
    'newCards30d', coalesce(pc.new_cards_30d, 0),
    'repeatRate30dPct', coalesce(pc.repeat_rate_30d_pct, 0.0),
    'repeatRate14dPct', coalesce(pc.repeat_rate_14d_pct, 0.0),
    'medianDaysBetweenVisits', pc.median_days_between_visits,
    'rewardsClaimed30d', coalesce(pc.rewards_claimed_30d, 0),
    'rewardsClaimedTotal', coalesce(pc.rewards_claimed_total, 0),
    'rewardsReadyCount', coalesce(pc.rewards_ready_count, 0)
  )
  into v_pulse
  from (
    select * from pulse_calc
    union all
    select
      (select count(*)::integer from public.customer_cards where tenant_id = p_tenant) as total_cards,
      0 as active_members_30d,
      (select count(*)::integer from public.customer_cards where tenant_id = p_tenant and added_at >= v_now - interval '30 days') as new_cards_30d,
      0.0 as repeat_rate_30d_pct,
      0.0 as repeat_rate_14d_pct,
      null::numeric as median_days_between_visits,
      (select count(*)::integer from public.redemptions where tenant_id = p_tenant and created_at >= v_now - interval '30 days') as rewards_claimed_30d,
      (select count(*)::integer from public.redemptions where tenant_id = p_tenant) as rewards_claimed_total,
      (select count(*)::integer from public.card_balances where tenant_id = p_tenant and available_stamps >= v_threshold) as rewards_ready_count
    where not exists (select 1 from public.stamps where tenant_id = p_tenant)
  ) as pc
  limit 1;

  -- 4. Compute Retention Health Buckets
  with card_activity as (
    select
      cc.customer_id,
      coalesce(cb.last_stamped_at, cc.added_at) as last_activity,
      cb.last_stamped_at,
      coalesce(
        (select count(distinct (s.created_at at time zone v_tz)::date)
         from public.stamps as s
         where s.tenant_id = p_tenant and s.customer_id = cc.customer_id),
        0
      )::integer as visit_days
    from public.customer_cards as cc
    left join public.card_balances as cb on cb.tenant_id = cc.tenant_id and cb.customer_id = cc.customer_id
    where cc.tenant_id = p_tenant
  )
  select pg_catalog.jsonb_build_object(
    'activeRegulars', coalesce(count(case when ca.last_activity >= v_now - interval '14 days' and ca.visit_days >= 2 and ca.last_stamped_at >= v_now - interval '14 days' then 1 end), 0),
    'newFirstVisit', coalesce(count(case when ca.last_activity >= v_now - interval '14 days' and not (ca.visit_days >= 2 and ca.last_stamped_at >= v_now - interval '14 days') then 1 end), 0),
    'atRisk', coalesce(count(case when ca.last_activity < v_now - interval '14 days' and ca.last_activity >= v_now - interval '30 days' then 1 end), 0),
    'dormant', coalesce(count(case when ca.last_activity < v_now - interval '30 days' then 1 end), 0)
  )
  into v_retention_health
  from card_activity as ca;

  -- 5. Compute Card Funnel
  with first_redemptions as (
    select
      r.customer_id,
      min(r.created_at) as first_redeemed_at
    from public.redemptions as r
    where r.tenant_id = p_tenant
    group by r.customer_id
  ),
  redeemer_return as (
    select
      fr.customer_id,
      fr.first_redeemed_at,
      (select min(s.created_at) from public.stamps as s where s.tenant_id = p_tenant and s.customer_id = fr.customer_id) as first_stamp_at,
      exists (
        select 1 from public.stamps as s
        where s.tenant_id = p_tenant and s.customer_id = fr.customer_id and s.created_at > fr.first_redeemed_at
      ) as earned_after_redeem
    from first_redemptions as fr
  ),
  cards_agg as (
    select
      cc.customer_id,
      coalesce(cb.available_stamps, 0) as available_stamps,
      not coalesce(u.is_anonymous, true) as is_backed_up
    from public.customer_cards as cc
    left join public.card_balances as cb on cb.tenant_id = cc.tenant_id and cb.customer_id = cc.customer_id
    left join auth.users as u on u.id = cc.customer_id
    where cc.tenant_id = p_tenant
  ),
  funnel_stats as (
    select
      count(case when ca.available_stamps = 0 then 1 end)::integer as zero_stamps_count,
      count(case when ca.available_stamps >= 1 and ca.available_stamps < pg_catalog.ceil(v_threshold / 2.0) then 1 end)::integer as early_progress_count,
      count(case when ca.available_stamps >= pg_catalog.ceil(v_threshold / 2.0) and ca.available_stamps < v_threshold then 1 end)::integer as halfway_plus_count,
      count(case when ca.available_stamps >= v_threshold then 1 end)::integer as reward_ready_count,
      coalesce(
        round(
          (count(case when ca.is_backed_up then 1 end)::numeric / nullif(count(*)::numeric, 0)) * 100.0,
          1
        ),
        0.0
      ) as backed_up_rate_pct
    from cards_agg as ca
  ),
  redeemer_stats as (
    select
      coalesce(
        round(
          (count(case when rr.earned_after_redeem then 1 end)::numeric / nullif(count(*)::numeric, 0)) * 100.0,
          1
        ),
        0.0
      ) as second_card_return_pct,
      round(
        (pg_catalog.percentile_cont(0.5) within group (
          order by (extract(epoch from (rr.first_redeemed_at - rr.first_stamp_at)) / 86400.0)
        ))::numeric,
        1
      ) as median_days_to_reward
    from redeemer_return as rr
    where rr.first_stamp_at is not null and rr.first_redeemed_at >= rr.first_stamp_at
  )
  select pg_catalog.jsonb_build_object(
    'rewardThreshold', v_threshold,
    'rewardLabel', v_reward_label,
    'zeroStampsCount', coalesce(fs.zero_stamps_count, 0),
    'earlyProgressCount', coalesce(fs.early_progress_count, 0),
    'halfwayPlusCount', coalesce(fs.halfway_plus_count, 0),
    'rewardReadyCount', coalesce(fs.reward_ready_count, 0),
    'secondCardReturnPct', coalesce(rs.second_card_return_pct, 0.0),
    'medianDaysToReward', rs.median_days_to_reward,
    'backedUpRatePct', coalesce(fs.backed_up_rate_pct, 0.0)
  )
  into v_card_funnel
  from (
    select * from funnel_stats
    union all
    select 0, 0, 0, 0, 0.0
    where not exists (select 1 from public.customer_cards where tenant_id = p_tenant)
  ) as fs
  cross join (
    select * from redeemer_stats
    union all
    select 0.0, null::numeric
    where not exists (select 1 from public.redemptions where tenant_id = p_tenant)
  ) as rs
  limit 1;

  -- 6. Compute Acquisition Cohorts (up to 6 months in shop timezone, newest first)
  with customer_cohort_visits as (
    select
      s.customer_id,
      (s.created_at at time zone v_tz)::date as visit_date
    from public.stamps as s
    where s.tenant_id = p_tenant
    group by s.customer_id, (s.created_at at time zone v_tz)::date
  ),
  ranked_cohort_visits as (
    select
      ccv.customer_id,
      ccv.visit_date,
      row_number() over (partition by ccv.customer_id order by ccv.visit_date asc) as visit_num
    from customer_cohort_visits as ccv
  ),
  customer_first_second as (
    select
      rcv.customer_id,
      min(case when rcv.visit_num = 1 then rcv.visit_date end) as first_visit_date,
      min(case when rcv.visit_num = 2 then rcv.visit_date end) as second_visit_date
    from ranked_cohort_visits as rcv
    group by rcv.customer_id
  ),
  monthly_cohorts as (
    select
      pg_catalog.to_char(cfs.first_visit_date, 'YYYY-MM') as cohort_month,
      count(*)::integer as new_customers,
      coalesce(
        round(
          (count(case when cfs.second_visit_date is not null and cfs.second_visit_date - cfs.first_visit_date <= 14 then 1 end)::numeric
           / count(*)::numeric) * 100.0,
          1
        ),
        0.0
      ) as returned_14d_pct,
      coalesce(
        round(
          (count(case when cfs.second_visit_date is not null and cfs.second_visit_date - cfs.first_visit_date <= 30 then 1 end)::numeric
           / count(*)::numeric) * 100.0,
          1
        ),
        0.0
      ) as returned_30d_pct,
      coalesce(
        round(
          (count(case when cfs.second_visit_date is not null then 1 end)::numeric
           / count(*)::numeric) * 100.0,
          1
        ),
        0.0
      ) as returned_ever_pct
    from customer_first_second as cfs
    where cfs.first_visit_date is not null
    group by pg_catalog.to_char(cfs.first_visit_date, 'YYYY-MM')
    order by cohort_month desc
    limit 6
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'cohortMonth', mc.cohort_month,
        'newCustomers', mc.new_customers,
        'returned14dPct', mc.returned_14d_pct,
        'returned30dPct', mc.returned_30d_pct,
        'returnedEverPct', mc.returned_ever_pct
      )
      order by mc.cohort_month desc
    ),
    '[]'::jsonb
  )
  into v_cohorts
  from monthly_cohorts as mc;

  -- 7. Compute Top 10 Loyal Customers
  with top_candidates as (
    select
      cb.customer_id,
      cb.total_stamps,
      cb.available_stamps,
      cb.last_stamped_at,
      coalesce(
        (select count(*)::integer from public.redemptions as r where r.tenant_id = p_tenant and r.customer_id = cb.customer_id),
        0
      ) as rewards_claimed,
      not coalesce(u.is_anonymous, true) as is_backed_up,
      coalesce(
        nullif(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''),
        nullif(pg_catalog.btrim(u.raw_user_meta_data->>'display_name'), ''),
        case
          when not coalesce(u.is_anonymous, true) and u.email is not null
          then nullif(pg_catalog.btrim(pg_catalog.split_part(u.email, '@', 1)), '')
          else null
        end,
        'Guest (Unbacked)'
      ) as customer_name
    from public.card_balances as cb
    left join auth.users as u on u.id = cb.customer_id
    where cb.tenant_id = p_tenant
      and cb.total_stamps > 0
    order by
      cb.total_stamps desc,
      rewards_claimed desc,
      cb.last_stamped_at desc nulls last,
      cb.customer_id asc
    limit 10
  ),
  ranked_candidates as (
    select
      row_number() over (order by tc.total_stamps desc, tc.rewards_claimed desc, tc.last_stamped_at desc nulls last, tc.customer_id asc)::integer as rank,
      tc.*
    from top_candidates as tc
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rank', rc.rank,
        'customerId', rc.customer_id::text,
        'cardCode', pg_catalog.upper(pg_catalog.left(rc.customer_id::text, 8)),
        'customerName', rc.customer_name,
        'isBackedUp', rc.is_backed_up,
        'totalStamps', rc.total_stamps,
        'availableStamps', rc.available_stamps,
        'rewardsClaimed', rc.rewards_claimed,
        'lastStampedAt', rc.last_stamped_at
      )
      order by rc.rank asc
    ),
    '[]'::jsonb
  )
  into v_top_customers
  from ranked_candidates as rc;

  -- 8. Return composite payload
  return pg_catalog.jsonb_build_object(
    'result', 'ok',
    'timezone', v_tz,
    'pulse', v_pulse,
    'retentionHealth', v_retention_health,
    'cardFunnel', v_card_funnel,
    'cohorts', v_cohorts,
    'topCustomers', v_top_customers
  );
end;
$$;

revoke all on function public.get_owner_analytics(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.get_owner_analytics(uuid, uuid, timestamptz) to service_role;
