import { PageIntro, SubTabs } from '@/components/console/ui';
import { ROUTES } from '@/lib/contracts';

/** "My Card" groups the reward and the card's look: the two things owners think of as "my card". */
export function MyCardHeader({ slug, current }: { slug: string; current: 'reward' | 'look' }) {
  const tabs = [
    { name: 'Reward', href: ROUTES.staff.settings(slug) },
    { name: 'Look & feel', href: ROUTES.staff.cardLook(slug) },
  ];
  return (
    <div className="space-y-5">
      <PageIntro
        title="My Card"
        description="Set the reward and make the card look like your shop. Changes show on customers' phones straight away."
      />
      <SubTabs tabs={tabs} current={current === 'reward' ? tabs[0]!.href : tabs[1]!.href} />
    </div>
  );
}
