/**
 * Palettes a developer or designer will recognise on sight.
 *
 * These are not invented hexes: each accent is the actual signature colour from
 * a palette that is widely used in editors and design work through 2025–2026.
 * Recognition is the point — "Nord" or "Catppuccin" tells someone what they are
 * getting far faster than a swatch does, and the name is why this list is worth
 * having next to the Pantone book rather than instead of it.
 *
 * The two groups answer different questions. Pantone is what the factory
 * already speaks: a colour you can hand to a dyer. These are what the software
 * world speaks. Neither replaces the other, which is why Settings offers both.
 *
 * Every accent here is mid-toned on purpose. The palette generator derives all
 * surfaces from the seed, so a very light or very dark seed produces either
 * washed-out buttons or unreadable ones — the same trap the Pantone hint on
 * this page walks people into by recommending soft colours.
 */
export type DeveloperPalette = {
  id: string;
  name: string;
  hex: string;
  /** Key under `settings.developerThemes` for the one-line origin note. */
  noteKey: string;
};

export const DEVELOPER_PALETTES: DeveloperPalette[] = [
  { id: 'nord', name: 'Nord', hex: '#5e81ac', noteKey: 'noteNord' },
  { id: 'catppuccin', name: 'Catppuccin', hex: '#8839ef', noteKey: 'noteCatppuccin' },
  { id: 'tokyo-night', name: 'Tokyo Night', hex: '#3d59a1', noteKey: 'noteTokyo' },
  { id: 'dracula', name: 'Dracula', hex: '#bd93f9', noteKey: 'noteDracula' },
  { id: 'rose-pine', name: 'Rosé Pine', hex: '#b4637a', noteKey: 'noteRosePine' },
  { id: 'gruvbox', name: 'Gruvbox', hex: '#d65d0e', noteKey: 'noteGruvbox' },
  { id: 'solarized', name: 'Solarized', hex: '#268bd2', noteKey: 'noteSolarized' },
  { id: 'one-dark', name: 'One Dark', hex: '#c678dd', noteKey: 'noteOneDark' },
];
