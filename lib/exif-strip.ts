import piexif from 'piexifjs';

export type StripMode = 'gps' | 'all';

/**
 * Client-side EXIF stripper for uploaded photos.
 *
 * Why client-side: the upload flow signs an R2 PUT URL and the
 * browser PUTs the original file directly to R2 (server never
 * sees the file body). Server-side stripping would require an
 * extra R2 GET → process → PUT roundtrip (extra cost + race
 * window). Stripping in the browser means the file that lands
 * in R2 was never in our hands with sensitive metadata intact.
 *
 * What gets stripped by default: only the GPS IFD entries
 * (lat / lng / altitude / GPS timestamp / direction / etc.).
 * Camera make / model and capture timestamp are preserved —
 * they're useful for UI display and not personally identifying
 * on their own. Pass `mode: 'all'` to strip every EXIF segment
 * (0th, Exif, GPS, Interop, 1st, thumbnail).
 *
 * Format handling:
 *   - image/jpeg / image/jpg : processed via piexifjs.
 *   - everything else (PNG, HEIC, WebP, etc.): pass-through.
 *     PNG can technically embed GPS via XMP / tEXt but it's
 *     rare in consumer photos; we leave those alone rather than
 *     risk corrupting the file.
 *
 * Failure handling: if piexifjs throws (corrupt JPEG, no EXIF
 * segment, encoding edge case) the ORIGINAL bytes are returned
 * untouched — better to upload than to fail the user's batch.
 * The error is logged via console.warn so admin can spot
 * patterns.
 */
export async function stripExifFromFile(
  file: File,
  mode: StripMode = 'gps',
): Promise<File> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/jpg') {
    return file;
  }
  try {
    const buf = await file.arrayBuffer();
    const jpegBinary = arrayBufferToBinaryString(buf);

    let exifObj: ReturnType<typeof piexif.load>;
    try {
      exifObj = piexif.load(jpegBinary);
    } catch {
      // No EXIF segment — nothing to strip, return the original.
      return file;
    }

    if (mode === 'all') {
      exifObj['0th'] = {};
      exifObj.Exif = {};
      exifObj.GPS = {};
      exifObj.Interop = {};
      exifObj['1st'] = {};
      // piexifjs @types declares thumbnail as `string | undefined`
      // (not nullable). undefined == "no embedded thumbnail" per
      // piexifjs dump / insert semantics.
      exifObj.thumbnail = undefined;
    } else {
      // Default 'gps' — only clear the GPS IFD. Camera make /
      // model + capture timestamp survive so the upload form /
      // admin metadata still shows them.
      exifObj.GPS = {};
    }

    const newExif = piexif.dump(exifObj);
    const newJpegBinary = piexif.insert(newExif, jpegBinary);
    const newBuf = binaryStringToArrayBuffer(newJpegBinary);

    return new File([newBuf], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch (err) {
    console.warn(
      '[exif-strip] failed for',
      file.name,
      err instanceof Error ? err.message : String(err),
    );
    return file;
  }
}

// piexifjs takes a binary string ("\xff\xd8..."). We build it
// in chunks so large JPEGs (10+ MB from modern phones) don't
// trip the V8 argument-count limit when passed to String.fromCharCode.
function arrayBufferToBinaryString(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return binary;
}

function binaryStringToArrayBuffer(binary: string): ArrayBuffer {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
