import {
  BASE_TOKEN_MAP_DARK,
  BASE_TOKEN_MAP_LIGHT,
} from '@/lib/theme/theme-color';
import {
  DEFAULT_THEME_BASE_COLOR,
  DEFAULT_THEME_PRIMARY_COLOR,
  TAILWIND_THEME_COLOR_OPTIONS,
} from '@/lib/theme/theme-presets';
import { DEVICE_THEME_BASE_KEY, DEVICE_THEME_PRIMARY_KEY } from '@/lib/theme/theme-storage';

const ALLOWED_PRIMARY = [
  ...new Set(TAILWIND_THEME_COLOR_OPTIONS.map((o) => o.primary.toLowerCase())),
];

/**
 * Inline script applied in <head> before React hydrates.
 * Reads device theme cache from localStorage and sets CSS variables immediately.
 */
export function getThemeInitScript(): string {
  const allowedPrimaryJson = JSON.stringify(ALLOWED_PRIMARY);
  const lightMapJson = JSON.stringify(BASE_TOKEN_MAP_LIGHT);
  const darkMapJson = JSON.stringify(BASE_TOKEN_MAP_DARK);
  const defaultPrimary = JSON.stringify(DEFAULT_THEME_PRIMARY_COLOR);
  const defaultBase = JSON.stringify(DEFAULT_THEME_BASE_COLOR);
  const primaryKey = JSON.stringify(DEVICE_THEME_PRIMARY_KEY);
  const baseKey = JSON.stringify(DEVICE_THEME_BASE_KEY);

  return `(function(){try{
var ALLOWED=${allowedPrimaryJson};
var LIGHT=${lightMapJson};
var DARK=${darkMapJson};
var DEF_P=${defaultPrimary};
var DEF_B=${defaultBase};
var PK=${primaryKey};
var BK=${baseKey};
function lum(h){var n=h.replace('#','');var r=parseInt(n.slice(0,2),16),g=parseInt(n.slice(2,4),16),b=parseInt(n.slice(4,6),16);var c=[r,g,b].map(function(v){var s=v/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
function normHex(v){if(!v||typeof v!=='string')return null;var t=v.trim().toLowerCase();if(t.charAt(0)!=='#')t='#'+t;if(!/^#[0-9a-f]{6}$/.test(t))return null;return t;}
function isDark(){try{var th=localStorage.getItem('theme');if(th==='dark')return true;if(th==='light')return false;}catch(e){}return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;}
function applyPrimary(hex){var fg=lum(hex)>0.5?'#111827':'#f9fafb';var s=document.documentElement.style;s.setProperty('--primary',hex);s.setProperty('--ring',hex);s.setProperty('--accent',hex);s.setProperty('--sidebar-primary',hex);s.setProperty('--primary-foreground',fg);s.setProperty('--accent-foreground',fg);s.setProperty('--sidebar-primary-foreground',fg);}
function applyBase(name,dark){var map=dark?DARK:LIGHT;var t=map[name]||map[DEF_B]||map.slate;if(!t)return;var s=document.documentElement.style;s.setProperty('--background',t.background);s.setProperty('--foreground',t.foreground);s.setProperty('--card',t.card);s.setProperty('--card-foreground',t.cardForeground);s.setProperty('--popover',t.popover);s.setProperty('--popover-foreground',t.popoverForeground);s.setProperty('--secondary',t.secondary);s.setProperty('--secondary-foreground',t.secondaryForeground);s.setProperty('--muted',t.muted);s.setProperty('--muted-foreground',t.mutedForeground);s.setProperty('--accent',t.accent);s.setProperty('--accent-foreground',t.accentForeground);s.setProperty('--border',t.border);s.setProperty('--input',t.input);}
var dark=isDark();
var baseRaw=null;var primaryRaw=null;
try{baseRaw=localStorage.getItem(BK);primaryRaw=localStorage.getItem(PK);}catch(e){}
var bases=['slate','gray','zinc','neutral','stone'];
var base=DEF_B;
if(baseRaw&&bases.indexOf(baseRaw)>=0)base=baseRaw;
applyBase(base,dark);
var primary=normHex(primaryRaw);
if(primary&&ALLOWED.indexOf(primary)>=0)applyPrimary(primary);
}catch(e){}})();`;
}
