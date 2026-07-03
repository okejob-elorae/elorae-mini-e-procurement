import type { LucideIcon } from "lucide-react";
import {
  Circle,
  Cloud,
  Flame,
  Flower2,
  Gem,
  Heart,
  Leaf,
  Snowflake,
  Sparkles,
  Zap,
} from "lucide-react";
import { DEFAULT_FILTER_OPTIONS } from "@elorae/db/pantone";

export type FilterDimension = keyof typeof DEFAULT_FILTER_OPTIONS;

export type FilterChipConfig = {
  value: string;
  labelKey: string;
  icon?: LucideIcon;
  hueSwatch?: string;
  hueBorder?: boolean;
};

export type FilterSectionConfig = {
  key: FilterDimension;
  letter: string;
  titleKey: string;
  subtitleKey: string;
  paired?: boolean;
  chips: FilterChipConfig[];
};

const TONE_ICONS: Record<string, LucideIcon> = {
  Pastel: Flower2,
  "Earth Tone": Leaf,
  "Jewel Tone": Gem,
  Neutral: Heart,
  "Vivid/Neon": Zap,
  "Muted/Dusty": Cloud,
  Monochrome: Circle,
  Metallic: Sparkles,
};

const HUE_SWATCHES: Record<string, { color: string; border?: boolean }> = {
  Red: { color: "#E53935" },
  Pink: { color: "#EC407A" },
  Orange: { color: "#FB8C00" },
  Yellow: { color: "#FDD835" },
  Green: { color: "#43A047" },
  "Teal/Cyan": { color: "#00ACC1" },
  Blue: { color: "#1E88E5" },
  Purple: { color: "#8E24AA" },
  Brown: { color: "#6D4C41" },
  White: { color: "#FFFFFF", border: true },
  Black: { color: "#212121" },
  Gray: { color: "#9E9E9E" },
  Gold: { color: "#D4AF37" },
};

const TEMP_ICONS: Record<string, LucideIcon> = {
  Warm: Flame,
  Cool: Snowflake,
  Neutral: Circle,
};

export const FILTER_OPTION_LABEL_KEYS: Record<FilterDimension, Record<string, string>> = {
  tone: {
    Pastel: "pastel",
    "Earth Tone": "earthTone",
    "Jewel Tone": "jewelTone",
    Neutral: "neutral",
    "Vivid/Neon": "vividNeon",
    "Muted/Dusty": "mutedDusty",
    Monochrome: "monochrome",
    Metallic: "metallic",
  },
  hue: {
    Red: "red",
    Pink: "pink",
    Orange: "orange",
    Yellow: "yellow",
    Green: "green",
    "Teal/Cyan": "tealCyan",
    Blue: "blue",
    Purple: "purple",
    Brown: "brown",
    White: "white",
    Black: "black",
    Gray: "gray",
    Gold: "gold",
  },
  temperature: {
    Warm: "warm",
    Cool: "cool",
    Neutral: "neutral",
  },
  tint: {
    Tint: "tint",
    Shade: "shade",
    Pure: "pure",
  },
};

function chipLabelKey(dim: FilterDimension, value: string): string {
  return FILTER_OPTION_LABEL_KEYS[dim][value] ?? value;
}

export const FILTER_SECTIONS: FilterSectionConfig[] = [
  {
    key: "tone",
    letter: "A",
    titleKey: "filterSectionToneTitle",
    subtitleKey: "filterSectionToneSubtitle",
    chips: DEFAULT_FILTER_OPTIONS.tone.map((value) => ({
      value,
      labelKey: chipLabelKey("tone", value),
      icon: TONE_ICONS[value],
    })),
  },
  {
    key: "hue",
    letter: "B",
    titleKey: "filterSectionHueTitle",
    subtitleKey: "filterSectionHueSubtitle",
    chips: DEFAULT_FILTER_OPTIONS.hue.map((value) => {
      const swatch = HUE_SWATCHES[value];
      return {
        value,
        labelKey: chipLabelKey("hue", value),
        hueSwatch: swatch?.color,
        hueBorder: swatch?.border,
      };
    }),
  },
  {
    key: "temperature",
    letter: "C",
    titleKey: "filterSectionTemperatureTitle",
    subtitleKey: "filterSectionTemperatureSubtitle",
    paired: true,
    chips: DEFAULT_FILTER_OPTIONS.temperature.map((value) => ({
      value,
      labelKey: chipLabelKey("temperature", value),
      icon: TEMP_ICONS[value],
    })),
  },
  {
    key: "tint",
    letter: "D",
    titleKey: "filterSectionTintTitle",
    subtitleKey: "filterSectionTintSubtitle",
    paired: true,
    chips: DEFAULT_FILTER_OPTIONS.tint.map((value) => ({
      value,
      labelKey: chipLabelKey("tint", value),
    })),
  },
];
