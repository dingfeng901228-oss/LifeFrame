/**
 * Photo image URL helper.
 *
 * Frank #7243 Task 2: photos no longer expose their raw R2 URL
 * in <img src>. Every photo image now goes through the auth-gated
 * proxy at /api/photos/[key]/image, which:
 *   1. looks up the photo's visibility
 *   2. enforces session / ownership rules per visibility
 *   3. fetches the file from R2 with a short-lived signed URL
 *   4. streams it back with `X-Robots-Tag: noimageindex` so
 *      search engines don't index image content
 *
 * `size: '256'` requests the pre-generated 256x256 webp
 * thumbnail (smaller, faster — used in the gallery / admin
 * grid / cluster modals). `size: 'full'` returns the original
 * upload — used in the photo detail modal and the dedicated
 * /p/[key] page where the user expects to see the full image.
 *
 * Update this helper (not the call sites) if the proxy URL
 * structure changes.
 */
export type PhotoSize = 'full' | '256';

export function photoImageUrl(
  photo: { key: string },
  size: PhotoSize = 'full',
): string {
  const qs = size === '256' ? '?w=256' : '';
  return `/api/photos/${encodeURIComponent(photo.key)}/image${qs}`;
}
