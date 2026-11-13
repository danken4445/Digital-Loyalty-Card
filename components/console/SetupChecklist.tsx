import Link from 'next/link';
import type { SetupProgress } from '@/lib/console/setup-progress';

function Tick({ done }: { done: boolean }) {
  return done ? (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-plug-black">
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : (
    <span className="h-7 w-7 shrink-0 rounded-full border-2 border-neutral-600" aria-hidden="true" />
  );
}

/** "Get your shop ready" card shown on Home until the required steps are done. */
export function SetupChecklist({ progress }: { progress: SetupProgress }) {
  const pct = Math.round((progress.requiredDoneCount / progress.requiredCount) * 100);

  return (
    <section
      aria-label="Get your shop ready"
      className="rounded-3xl border border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-transparent p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Get your shop ready</h2>
          <p className="mt-1 text-sm text-neutral-300">
            {progress.requiredDoneCount} of {progress.requiredCount} done. It takes about 10 minutes.
          </p>
        </div>
        {progress.nextStep && (
          <Link
            href={progress.nextStep.href}
            className="inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-plug-black hover:bg-neutral-200"
          >
            {progress.doneCount === 0 ? 'Start setup' : 'Continue setup'} →
          </Link>
        )}
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Setup progress"
      >
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ol className="mt-5 space-y-1">
        {progress.steps.map((step) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className="group flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5"
            >
              <Tick done={step.done} />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-base font-medium ${step.done ? 'text-neutral-400 line-through' : 'text-white'}`}
                >
                  {step.title}
                  {step.optional && (
                    <span className="ml-2 rounded-full border border-neutral-700 px-2 py-0.5 align-middle text-xs font-normal text-neutral-400 no-underline">
                      Optional
                    </span>
                  )}
                </span>
                {!step.done && <span className="block text-sm text-plug-muted">{step.description}</span>}
              </span>
              {!step.done && (
                <span className="text-plug-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                  →
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
