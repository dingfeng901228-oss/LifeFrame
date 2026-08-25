import exifr from 'exifr';

export type PhotoExif = {
  takenAt?: string; // ISO 8601 UTC timestamp
  lat?: number; // decimal degrees
  lng?: number; // decimal degrees
  make?: string;
  model?: string;
};

const EXIF_PICK = [
  'DateTimeOriginal',
  'CreateDate',
  'GPSLatitude',
  'GPSLongitude',
  'Make',
  'Model',
];

/**
 * Extract a small set of EXIF fields (takenAt + GPS + camera) from a browser
 * File, Node Blob, or ArrayBuffer. Safe to call from the browser.
 * Returns {} on error or when no EXIF is present.
 */
export async function extractExif(
  file: File | Blob | ArrayBuffer,
): Promise<PhotoExif> {
  try {
    const raw = (await exifr.parse(file, { pick: EXIF_PICK })) as
      | {
          DateTimeOriginal?: Date;
          CreateDate?: Date;
          GPSLatitude?: number;
          GPSLongitude?: number;
          Make?: string;
          Model?: string;
        }
      | undefined;
    if (!raw) return {};

    const taken = raw.DateTimeOriginal ?? raw.CreateDate;
    const takenAt =
      taken instanceof Date && !Number.isNaN(taken.getTime())
        ? taken.toISOString()
        : undefined;

    return {
      takenAt,
      lat: typeof raw.GPSLatitude === 'number' ? raw.GPSLatitude : undefined,
      lng: typeof raw.GPSLongitude === 'number' ? raw.GPSLongitude : undefined,
      make: typeof raw.Make === 'string' ? raw.Make : undefined,
      model: typeof raw.Model === 'string' ? raw.Model : undefined,
    };
  } catch {
    return {};
  }
}
