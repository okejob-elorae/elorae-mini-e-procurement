export type ThemeBaseColorName = 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone';
export type ThemeColorName =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'amber'
  | 'blue'
  | 'cyan'
  | 'emerald'
  | 'fuchsia'
  | 'green'
  | 'indigo'
  | 'lime'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'rose'
  | 'sky'
  | 'teal'
  | 'violet'
  | 'yellow';

export type ThemeBaseColorOption = {
  name: ThemeBaseColorName;
  label: string;
  primary: string;
};

export type ThemeColorOption = {
  name: ThemeColorName;
  label: string;
  primary: string;
};

export const DEFAULT_THEME_PRIMARY_COLOR = '#334155';
export const DEFAULT_THEME_BASE_COLOR: ThemeBaseColorName = 'slate';

export const TAILWIND_BASE_COLOR_OPTIONS: ThemeBaseColorOption[] = [
  { name: 'slate', label: 'Slate', primary: '#334155' },
  { name: 'gray', label: 'Gray', primary: '#374151' },
  { name: 'zinc', label: 'Zinc', primary: '#3f3f46' },
  { name: 'neutral', label: 'Neutral', primary: '#404040' },
  { name: 'stone', label: 'Stone', primary: '#44403c' },
];

export const TAILWIND_THEME_COLOR_OPTIONS: ThemeColorOption[] = [
  { name: 'slate', label: 'Slate', primary: '#334155' },
  { name: 'gray', label: 'Gray', primary: '#374151' },
  { name: 'zinc', label: 'Zinc', primary: '#3f3f46' },
  { name: 'neutral', label: 'Neutral', primary: '#404040' },
  { name: 'stone', label: 'Stone', primary: '#44403c' },
  { name: 'amber', label: 'Amber', primary: '#d97706' },
  { name: 'blue', label: 'Blue', primary: '#2563eb' },
  { name: 'cyan', label: 'Cyan', primary: '#0891b2' },
  { name: 'emerald', label: 'Emerald', primary: '#059669' },
  { name: 'fuchsia', label: 'Fuchsia', primary: '#c026d3' },
  { name: 'green', label: 'Green', primary: '#16a34a' },
  { name: 'indigo', label: 'Indigo', primary: '#4f46e5' },
  { name: 'lime', label: 'Lime', primary: '#65a30d' },
  { name: 'orange', label: 'Orange', primary: '#ea580c' },
  { name: 'pink', label: 'Pink', primary: '#db2777' },
  { name: 'purple', label: 'Purple', primary: '#9333ea' },
  { name: 'red', label: 'Red', primary: '#dc2626' },
  { name: 'rose', label: 'Rose', primary: '#e11d48' },
  { name: 'sky', label: 'Sky', primary: '#0284c7' },
  { name: 'teal', label: 'Teal', primary: '#0d9488' },
  { name: 'violet', label: 'Violet', primary: '#7c3aed' },
  { name: 'yellow', label: 'Yellow', primary: '#ca8a04' },
];

const ALLOWED_COLORS = new Set(
  [...TAILWIND_BASE_COLOR_OPTIONS, ...TAILWIND_THEME_COLOR_OPTIONS].map((option) =>
    option.primary.toLowerCase()
  )
);

export function isAllowedThemePrimaryColor(color: string): boolean {
  return ALLOWED_COLORS.has(color.trim().toLowerCase());
}

const ALLOWED_BASE_NAMES = new Set(
  TAILWIND_BASE_COLOR_OPTIONS.map((option) => option.name)
);

export function isAllowedThemeBaseColorName(value: string): value is ThemeBaseColorName {
  return ALLOWED_BASE_NAMES.has(value as ThemeBaseColorName);
}

export function getThemeBaseColorOption(name: ThemeBaseColorName): ThemeBaseColorOption {
  const found = TAILWIND_BASE_COLOR_OPTIONS.find((option) => option.name === name);
  return found ?? TAILWIND_BASE_COLOR_OPTIONS[0];
}
