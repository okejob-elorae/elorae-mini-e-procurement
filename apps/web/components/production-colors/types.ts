export type PantoneSwatch = {
  tcx: string;
  name: string;
  hex: string;
  groupName?: string | null;
  isFavorite?: boolean;
};

export type PantoneMatch = {
  name: string;
  tcx: string;
  hex: string;
  deltaE: number;
  isFavorite?: boolean;
};

export type PantoneDetail = {
  tcx: string;
  name: string;
  hex: string;
  rgb: string;
  rgbString: string;
  groupName: string | null;
  gradient: string[];
  similar: PantoneMatch[];
  isFavorite: boolean;
};
