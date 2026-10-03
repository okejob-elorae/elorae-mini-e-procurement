import { DAFTAR_FONT } from '@/lib/theme/fonts';
import {
  BASE_TOKEN_MAP_DARK,
  BASE_TOKEN_MAP_LIGHT,
} from '@/lib/theme/theme-color';
import { DEFAULT_THEME_PRIMARY_COLOR } from '@/lib/theme/theme-presets';
import { DEFAULT_UI_THEME, UI_THEME_STORAGE_KEY, UI_THEMES } from '@/lib/theme/ui-themes';
import {
  DEVICE_THEME_FONT_KEY,
  DEVICE_THEME_PALETTE_KEY,
  DEVICE_THEME_PANTONE_KEY,
  DEVICE_THEME_PRIMARY_KEY,
} from '@/lib/theme/theme-storage';

/**
 * Inline script applied in <head> before React hydrates.
 * Reads device theme cache from localStorage and sets CSS variables immediately.
 */
export function getThemeInitScript(): string {
  const lightDefault = JSON.stringify(BASE_TOKEN_MAP_LIGHT.slate);
  const darkDefault = JSON.stringify(BASE_TOKEN_MAP_DARK.slate);
  const defaultPrimary = JSON.stringify(DEFAULT_THEME_PRIMARY_COLOR);
  const primaryKey = JSON.stringify(DEVICE_THEME_PRIMARY_KEY);
  const pantoneKey = JSON.stringify(DEVICE_THEME_PANTONE_KEY);
  const paletteKey = JSON.stringify(DEVICE_THEME_PALETTE_KEY);
  const uiThemeKey = JSON.stringify(UI_THEME_STORAGE_KEY);
  const uiThemeIds = JSON.stringify(UI_THEMES.map((t) => t.id));
  const uiThemeDefault = JSON.stringify(DEFAULT_UI_THEME);
  const fontKey = JSON.stringify(DEVICE_THEME_FONT_KEY);
  /*
   * Peta id → variabel CSS, dibangkitkan dari daftar yang sama yang dipakai
   * layar pengaturan. Menulis ulang petanya di sini akan menyimpang diam-diam:
   * huruf baru muncul di pilihan, diklik, dan tidak mengubah apa pun.
   */
  const fontVars = JSON.stringify(
    Object.fromEntries(DAFTAR_FONT.map((f) => [f.id, f.variabel])),
  );

  return `(function(){try{
var LIGHT_DEF=${lightDefault};
var DARK_DEF=${darkDefault};
var DEF_P=${defaultPrimary};
var PK=${primaryKey};
var TK=${pantoneKey};
var PLK=${paletteKey};
var UIK=${uiThemeKey};
var FK=${fontKey};
var FV=${fontVars};
var UI_IDS=${uiThemeIds};
var UI_DEF=${uiThemeDefault};
function lum(h){var n=h.replace('#','');var r=parseInt(n.slice(0,2),16),g=parseInt(n.slice(2,4),16),b=parseInt(n.slice(4,6),16);var c=[r,g,b].map(function(v){var s=v/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
function normHex(v){if(!v||typeof v!=='string')return null;var t=v.trim().toLowerCase();if(t.charAt(0)!=='#')t='#'+t;if(!/^#[0-9a-f]{6}$/.test(t))return null;return t;}
function isDark(){try{var th=localStorage.getItem('theme');if(th==='dark')return true;if(th==='light')return false;}catch(e){}return document.documentElement.classList.contains('dark')||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);}
function applyPrimary(hex){var fg=lum(hex)>0.5?'#111827':'#f9fafb';var s=document.documentElement.style;s.setProperty('--primary',hex);s.setProperty('--ring',hex);s.setProperty('--sidebar-primary',hex);s.setProperty('--primary-foreground',fg);s.setProperty('--sidebar-primary-foreground',fg);}
function applyPalette(t){if(!t)return;var s=document.documentElement.style;s.setProperty('--background',t.background);s.setProperty('--foreground',t.foreground);s.setProperty('--card',t.card);s.setProperty('--card-foreground',t.cardForeground);s.setProperty('--popover',t.popover);s.setProperty('--popover-foreground',t.popoverForeground);s.setProperty('--secondary',t.secondary);s.setProperty('--secondary-foreground',t.secondaryForeground);s.setProperty('--muted',t.muted);s.setProperty('--muted-foreground',t.mutedForeground);s.setProperty('--accent',t.accent);s.setProperty('--accent-foreground',t.accentForeground);s.setProperty('--border',t.border);s.setProperty('--input',t.input);}
try{var ui=localStorage.getItem(UIK);document.documentElement.setAttribute('data-ui-theme',UI_IDS.indexOf(ui)>=0?ui:UI_DEF);}catch(e){document.documentElement.setAttribute('data-ui-theme',UI_DEF);}
/*
 * Huruf dipasang PALING AWAL. Warna yang telat sepersekian detik nyaris tidak
 * terlihat; huruf yang telat menggeser SELURUH tata letak saat berganti, dan
 * itu terbaca sebagai halaman yang rusak.
 */
try{var fid=localStorage.getItem(FK);if(fid&&FV[fid]){document.documentElement.style.setProperty('--font-app-sans','var('+FV[fid]+')');}}catch(e){}

var dark=isDark();
var tcx=null;var primaryRaw=null;var paletteRaw=null;
try{tcx=localStorage.getItem(TK);primaryRaw=localStorage.getItem(PK);paletteRaw=localStorage.getItem(PLK);}catch(e){}
var palette=null;
if(paletteRaw){try{palette=JSON.parse(paletteRaw);}catch(e){}}
var pHex=normHex(primaryRaw);
if(!pHex||pHex===normHex(DEF_P)||!palette){
applyPalette(dark?DARK_DEF:LIGHT_DEF);
var defP=normHex(DEF_P)||DEF_P;
applyPrimary(defP);
}else{
var tokens=palette&&(dark?palette.dark:palette.light);
if(tokens)applyPalette(tokens);
else applyPalette(dark?DARK_DEF:LIGHT_DEF);
applyPrimary(pHex);
}
}catch(e){}})();`;
}
