import { DEFAULT_STAMP_ICON, type StampIconId } from '@/lib/contracts';

/** Human label for each icon, used by the brand settings picker. */
export const STAMP_ICON_LABELS: Record<StampIconId, string> = {
  cup: 'Coffee cup',
  star: 'Star',
  heart: 'Heart',
  scissors: 'Scissors',
  paw: 'Paw',
  leaf: 'Leaf',
  utensils: 'Fork & knife',
  bag: 'Shopping bag',
  sparkles: 'Sparkles',
  gift: 'Gift',
};

/** Line glyphs on a 24x24 grid, drawn with currentColor strokes. */
function Glyph({ icon }: { icon: StampIconId }) {
  switch (icon) {
    case 'star':
      return <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />;
    case 'heart':
      return <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6C20.5 15 12 20.5 12 20.5Z" />;
    case 'scissors':
      return (
        <>
          <circle cx="6" cy="6.5" r="2.5" />
          <circle cx="6" cy="17.5" r="2.5" />
          <path d="M8 8 20 18M8 16 20 6" />
        </>
      );
    case 'paw':
      return (
        <>
          <ellipse cx="6.5" cy="11" rx="1.8" ry="2.4" />
          <ellipse cx="10" cy="6.8" rx="1.8" ry="2.4" />
          <ellipse cx="14" cy="6.8" rx="1.8" ry="2.4" />
          <ellipse cx="17.5" cy="11" rx="1.8" ry="2.4" />
          <path d="M12 12.5c-3 0-5.5 2.7-5.5 5 0 1.6 1.4 2.3 2.9 2.1 1-.1 1.7-.5 2.6-.5s1.6.4 2.6.5c1.5.2 2.9-.5 2.9-2.1 0-2.3-2.5-5-5.5-5Z" />
        </>
      );
    case 'leaf':
      return (
        <>
          <path d="M5 19c0-8 4-13.5 14-14 .3 9.5-4.6 14-12.5 14" />
          <path d="M5 19c2.5-4.5 5.5-7.5 9-9.5" />
        </>
      );
    case 'utensils':
      return (
        <>
          <path d="M7 3v7a2 2 0 0 0 2 2m0 0V21M9 12a2 2 0 0 0 2-2V3M7 3v7" />
          <path d="M17 21V3c-2.5 1.5-3.5 5-3.5 8.5H17" />
        </>
      );
    case 'bag':
      return (
        <>
          <path d="M5 8h14l-1 12H6L5 8Z" />
          <path d="M9 10V7a3 3 0 0 1 6 0v3" />
        </>
      );
    case 'sparkles':
      return (
        <>
          <path d="M10 4.5 11.8 10l5.5 1.8L11.8 13.6 10 19l-1.8-5.4L2.7 11.8 8.2 10 10 4.5Z" />
          <path d="M18 3v4M16 5h4M18.5 16v4M16.5 18h4" />
        </>
      );
    case 'gift':
      return (
        <>
          <rect x="3.5" y="8" width="17" height="4" rx="1" />
          <path d="M5 12v8h14v-8M12 8v12" />
          <path d="M12 8c-1-3.5-5-4.5-5-2.2C7 7.2 9 8 12 8Zm0 0c1-3.5 5-4.5 5-2.2C17 7.2 15 8 12 8Z" />
        </>
      );
    case 'cup':
    default:
      // Takeaway cup with a coffee bean on the sleeve, matching the printed loyalty card.
      return (
        <>
          <path d="M8.5 4 9.3 2.5h5.4l.8 1.5" />
          <rect x="5" y="4" width="14" height="3" rx="1" />
          <path d="M6.5 7 8 21h8l1.5-14" />
          <ellipse cx="12" cy="14" rx="2.2" ry="2.8" transform="rotate(30 12 14)" />
          <path d="M10.9 15.9c.9-.7 1.3-2.5 2.2-3.8" />
        </>
      );
  }
}

export interface StampIconProps {
  icon?: StampIconId;
  className?: string;
}

/** One shop-selectable stamp glyph. Decorative: the slot's aria-label carries the meaning. */
export function StampIcon({ icon = DEFAULT_STAMP_ICON, className }: StampIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <Glyph icon={icon} />
    </svg>
  );
}
