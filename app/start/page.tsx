import { GetCardButton } from '@/components/card/GetCardButton';
import { OnboardingCard } from '@/components/card/OnboardingCard';

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
      pageLabel="Loyalty card onboarding"
      instagramHandle={null}
      title={tagId !== null ? 'Claim your first stamp' : 'Get your loyalty card'}
      lines={
        tagId !== null
          ? ['Your tap worked.', 'Make your card to add the shop and claim your stamp.']
          : ['No app download. No form.', 'Collect stamps and earn rewards at your favourite shops.']
      }
    >
      <GetCardButton mode="start" tagId={tagId} />
    </OnboardingCard>
  );
}
