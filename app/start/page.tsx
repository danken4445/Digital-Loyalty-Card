import { GetCardButton } from '@/components/card/GetCardButton';
import { OnboardingCard } from '@/components/card/OnboardingCard';
import { SHOP_CONFIG } from '@/lib/config';

interface StartPageProps {
  searchParams: Promise<{ t?: string | string[] | undefined }>;
}

export default async function StartPage({ searchParams }: StartPageProps) {
  const resolvedParams = await searchParams;
  const rawT = resolvedParams?.t;
  const tValue = Array.isArray(rawT) ? rawT[0] : rawT;
  const tagId = typeof tValue === 'string' && tValue.trim().length > 0 ? tValue.trim() : null;

  // Arrived from an NFC tap: the stamp is waiting. Arrived directly: just make the card.
  return (
    <OnboardingCard
      pageLabel={`${SHOP_CONFIG.name} Onboarding`}
      title={tagId !== null ? 'Claim your first stamp' : 'Get your loyalty card'}
      lines={
        tagId !== null
          ? ['Your tap worked.', 'Make your card and the stamp goes straight on it.']
          : ['No app download. No form.', 'Collect 10 stamps for a free coffee.']
      }
    >
      <GetCardButton mode="start" tagId={tagId} />
    </OnboardingCard>
  );
}
