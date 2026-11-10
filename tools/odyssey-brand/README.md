# ODYSSEY brand tools

Generates the ODYSSEY logo assets. Not part of the app build (excluded in the root `tsconfig.json`).

| Path | What |
|---|---|
| `lib/brand/odyssey/` (app) | Tokens, verbatim logo path data, `composeLogo`, `colourwayForBackground`. Single source of truth. |
| `components/brand/OdysseyLogo.tsx` (app) | Web logo component used on platform screens. |
| `public/brand/odyssey/` (app) | Generated SVG masters, loyalty lockups, icons, preview sheet, `STATUS.md`. |
| `tests/unit/odyssey-brand/` (app) | Vitest: geometry, approved-artwork hash, master equivalence, contrast, sizing. |
| `native/OdysseyLogo.native.tsx` | React Native twin of the component (react-native-svg), for a future native app. |
| `reference/masters/` | The supplied ODYSSEY vector masters (v1.0). Tests compare against these. |
| `scripts/` | Extract path data, outline the descriptor (Poppins Medium), generate assets. |

```bash
cd tools/odyssey-brand
npm install
npm run outline     # only if descriptor wording changes
npm run generate    # rewrites public/brand/odyssey/
```

Never hand-edit `public/brand/odyssey/` or `lib/brand/odyssey/logoPaths.ts`; the approved path data is hashed in tests.
