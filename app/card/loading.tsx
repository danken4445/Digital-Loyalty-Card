export default function CardLoading() {
  return (
    <main
      aria-label="Loading The Caffeine Plug Loyalty Card"
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-6 sm:py-10"
    >
      {/* Top Header Label */}
      <div className="w-full max-w-[390px] flex items-center justify-between text-[10px] font-mono tracking-widest text-plug-muted uppercase px-1 pb-3">
        <span>NFC LOYALTY CARD</span>
        <span className="text-white animate-pulse">LOADING PASS...</span>
      </div>

      {/* Skeleton Card Shell */}
      <section
        role="status"
        aria-busy="true"
        aria-label="Loading your loyalty card"
        className="w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-2xl p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md relative overflow-hidden animate-pulse"
      >
        {/* Subtle decorative corner tick */}
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 w-12 h-12 overflow-hidden pointer-events-none"
        >
          <div className="bg-white/10 text-transparent font-mono text-[8px] py-1 text-center transform rotate-45 translate-x-3 -translate-y-1 w-16">
            TCP
          </div>
        </div>

        {/* Card Header & Brand Information Skeleton */}
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-plug-elevated border border-plug-border" />
          <div className="w-44 h-7 bg-plug-elevated rounded-md mt-4" />
          <div className="w-52 h-3.5 bg-plug-elevated/70 rounded-md mt-2" />
          <div className="w-28 h-5 bg-plug-elevated rounded-full mt-3" />
        </div>

        {/* Stamp Progress & Grid Skeleton */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2 px-0.5">
            <div className="w-24 h-3 bg-plug-elevated rounded" />
            <div className="w-16 h-3 bg-plug-elevated rounded" />
          </div>

          <div className="w-full h-2 rounded-full bg-plug-elevated border border-plug-border mb-3" />

          <div className="grid grid-cols-5 gap-2.5">
            {Array.from({ length: 10 }, (_, index) => (
              <div
                key={index}
                className="aspect-square rounded-full bg-plug-elevated/80 border border-plug-border"
              />
            ))}
          </div>
        </div>

        {/* Card Footer Details Skeleton */}
        <div className="mt-6 pt-4 border-t border-plug-border flex flex-col items-center gap-2">
          <div className="w-32 h-4 bg-plug-elevated rounded" />
          <div className="w-48 h-3 bg-plug-elevated/70 rounded" />
          <div className="w-40 h-3 bg-plug-elevated/50 rounded" />
        </div>
      </section>

      {/* Streetwear Footer */}
      <footer className="w-full max-w-[390px] text-center text-[10px] font-mono tracking-widest text-plug-muted uppercase pt-4">
        <span>THE CAFFEINE PLUG &copy; 2026</span>
      </footer>
    </main>
  );
}
