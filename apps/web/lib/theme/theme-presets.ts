export const DEFAULT_THEME_PRIMARY_COLOR = '#334155';

/**
 * Named starting points for the account theme.
 *
 * Every preset is a real Pantone TCX colour, not an invented hex. That keeps
 * the feature honest to what this product is — a garment ERP whose whole colour
 * vocabulary is Pantone — and means the full picker and the presets speak the
 * same language: picking "Ultra Violet" and searching 18-3838 by hand give the
 * identical result.
 *
 * Chosen at L* 37–58 with real chroma: light enough that white text on the
 * accent stays legible, saturated enough to survive being the only colour on a
 * mostly neutral screen. Pale Pantones make lovely surfaces and unreadable
 * buttons, which is why none are offered here.
 *
 * Deliberately absent: a plain green and a plain amber as *accent* colours.
 * Green means settled and amber means needs-attention throughout the app, and
 * an accent sharing those hues makes a status column unreadable at a glance.
 * Viridis and Golden Ochre sit far enough from those semantics to be safe.
 */
export type ThemePreset = {
  id: string;
  /** Pantone's own name — shown as the theme name. */
  name: string;
  tcx: string;
  hex: string;
  /** Key under `settings.themePresets` describing where this family is used. */
  noteKey: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'ultra-violet',
    name: 'Ultra Violet',
    tcx: '18-3838',
    hex: '#5f4b8b',
    noteKey: 'noteViolet',
  },
  {
    id: 'victoria-blue',
    name: 'Victoria Blue',
    tcx: '18-4148',
    hex: '#08589d',
    noteKey: 'noteBlue',
  },
  {
    id: 'viridis',
    name: 'Viridis',
    tcx: '17-5734',
    hex: '#00846b',
    noteKey: 'noteTeal',
  },
  {
    id: 'bottle-green',
    name: 'Bottle Green',
    tcx: '17-5722',
    hex: '#427d6d',
    noteKey: 'noteBotanical',
  },
  {
    id: 'dahlia-mauve',
    name: 'Dahlia Mauve',
    tcx: '17-2617',
    hex: '#a64f82',
    noteKey: 'noteRose',
  },
  {
    id: 'golden-ochre',
    name: 'Golden Ochre',
    tcx: '16-1346',
    hex: '#c77943',
    noteKey: 'noteWarm',
  },
  {
    id: 'iron-gate',
    name: 'Iron Gate',
    tcx: '19-3910',
    hex: '#4e5055',
    noteKey: 'noteNeutral',
  },
];
