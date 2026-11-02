import Image from 'next/image';
import { BRAND_THEME, SHOP_CONFIG } from '@/lib/config';
import { GetCardButton } from '@/components/card/GetCardButton';

interface StartPageProps {
  searchParams: Promise<{ t?: string | string[] | undefined }>;
}

export default async function StartPage({ searchParams }: StartPageProps) {
  const resolvedParams = await searchParams;
  const rawT = resolvedParams?.t;
  const tValue = Array.isArray(rawT) ? rawT[0] : rawT;
  const tagId = typeof tValue === 'string' && tValue.trim().length > 0 ? tValue.trim() : null;

  return (
    <main
      aria-label={`${SHOP_CONFIG.name} Onboarding`}
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-6 sm:py-10"
    >
      {/* Top Header Accent */}
      <div className="w-full max-w-[390px] flex items-center justify-between text-[10px] font-mono tracking-widest text-plug-muted uppercase px-1 pb-3">
        <span>NFC TAP DETECTED</span>
        <span>ONBOARDING</span>
      </div>

      {/* Main Streetwear Onboarding Shell */}
      <section
        aria-label="Tap Onboarding Container"
        className="w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-2xl p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md relative overflow-hidden flex flex-col items-center text-center"
      >
        {/* Subtle decorative corner tick */}
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 w-12 h-12 overflow-hidden pointer-events-none"
        >
          <div className="bg-white text-black font-mono font-bold text-[8px] py-1 text-center transform rotate-45 translate-x-3 -translate-y-1 w-16">
            TCP
          </div>
        </div>

        {/* Circular Brand Logo */}
        <div className="relative w-20 h-20 rounded-full p-1 bg-plug-elevated border border-plug-border shadow-inner">
          <Image
            src={BRAND_THEME.assets.logoCircleDark}
            alt={`${SHOP_CONFIG.name} circular logo`}
            width={76}
            height={76}
            priority
            className="rounded-full object-contain"
          />
        </div>

        {/* Headline */}
        <h1 className="font-display text-2xl sm:text-3xl font-black uppercase tracking-wider text-white mt-3">
          CLAIM YOUR FIRST STAMP
        </h1>

        <p className="text-xs uppercase tracking-widest text-plug-muted font-medium mt-1">
          {SHOP_CONFIG.tagline}
        </p>

        {/* Tag Status Indicator */}
        <div className="mt-4 flex flex-col items-center gap-1">
          {tagId !== null ? (
            <>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white text-black font-mono text-xs font-black uppercase tracking-wider shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                <span
                  className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
                  aria-hidden="true"
                />
                <span>NFC TAP DETECTED</span>
              </div>
              <span className="font-mono text-[10px] text-plug-muted tracking-widest uppercase">
                TAG #{tagId.slice(0, 10).toUpperCase()}
              </span>
            </>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-plug-elevated border border-plug-border text-plug-muted font-mono text-xs uppercase tracking-wider">
              <span>START YOUR LOYALTY CARD</span>
            </div>
          )}
        </div>

        {/* Mascot Illustration */}
        <div className="my-5 relative w-32 h-32 flex items-center justify-center p-2 rounded-2xl bg-plug-elevated/40 border border-plug-border/50">
          <Image
            src={BRAND_THEME.assets.mascotFull}
            alt={`${SHOP_CONFIG.name} mascot`}
            width={112}
            height={112}
            priority
            className="object-contain"
          />
        </div>

        {/* Explanatory Copy */}
        <p className="font-sans text-xs text-neutral-300 leading-relaxed mb-3">
          {tagId !== null
            ? 'NFC tap verified! Activate your card below to claim your stamp and start collecting rewards.'
            : 'Get your digital loyalty card in one click. No password, no app install required.'}
        </p>

        {/* Provisioning CTA Button */}
        <div className="w-full mt-1">
          <GetCardButton mode="start" tagId={tagId} />
        </div>
      </section>

      {/* Streetwear Footer */}
      <footer className="w-full max-w-[390px] text-center text-[10px] font-mono tracking-widest text-plug-muted uppercase pt-4">
        <span>THE CAFFEINE PLUG &copy; 2026 // STREETWEAR LOYALTY</span>
      </footer>
    </main>
  );
}
