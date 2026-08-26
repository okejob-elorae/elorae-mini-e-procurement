/**
 * Full interface themes — shape as well as colour.
 *
 * The Pantone picker already handles the accent. What it cannot express is the
 * rest of what makes two products feel different: how tightly rows pack, how
 * round the corners are, whether cards float or sit flat, how loud a column
 * heading is. Those live here, as CSS custom properties applied to <html> via
 * data-ui-theme, so one attribute changes every screen.
 *
 * Each theme also names a recommended Pantone seed, so choosing one is a single
 * decision rather than "now go pick a colour to match". The accent stays
 * independently overridable afterwards — the two systems compose rather than
 * fight.
 */
export type UIThemeId = 'padat' | 'seimbang' | 'lapang' | 'studio';

export type UITheme = {
  id: UIThemeId;
  /** Key under `settings.uiThemes` for the name. */
  nameKey: string;
  /** Key under `settings.uiThemes` for the one-line "who is this for". */
  noteKey: string;
  /** Recommended accent, applied together with the shape. Real Pantone TCX. */
  seed: { tcx: string; name: string; hex: string };
};

export const UI_THEMES: UITheme[] = [
  {
    id: 'padat',
    nameKey: 'padatName',
    noteKey: 'padatNote',
    seed: { tcx: '19-3910', name: 'Iron Gate', hex: '#4e5055' },
  },
  {
    id: 'seimbang',
    nameKey: 'seimbangName',
    noteKey: 'seimbangNote',
    seed: { tcx: '18-3838', name: 'Ultra Violet', hex: '#5f4b8b' },
  },
  {
    id: 'lapang',
    nameKey: 'lapangName',
    noteKey: 'lapangNote',
    seed: { tcx: '16-1346', name: 'Golden Ochre', hex: '#c77943' },
  },
  {
    id: 'studio',
    nameKey: 'studioName',
    noteKey: 'studioNote',
    seed: { tcx: '18-4148', name: 'Victoria Blue', hex: '#08589d' },
  },
];

export const DEFAULT_UI_THEME: UIThemeId = 'seimbang';

export const UI_THEME_STORAGE_KEY = 'elorae:ui-theme';

export function isUIThemeId(value: unknown): value is UIThemeId {
  return UI_THEMES.some((theme) => theme.id === value);
}

/**
 * Applied immediately on selection so the whole app repaints before anything is
 * saved — a theme you cannot see before committing to is a theme nobody picks.
 */
export function applyUITheme(id: UIThemeId): void {
  document.documentElement.setAttribute('data-ui-theme', id);
}

export function readStoredUITheme(): UIThemeId {
  try {
    const raw = localStorage.getItem(UI_THEME_STORAGE_KEY);
    return isUIThemeId(raw) ? raw : DEFAULT_UI_THEME;
  } catch {
    return DEFAULT_UI_THEME;
  }
}

export function storeUITheme(id: UIThemeId): void {
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, id);
  } catch {
    /* Private mode or a full quota: the theme still applies for this session. */
  }
}
