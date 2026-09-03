/**
 * Photo image URL helper.
 *
 * Frank #7735: URLs now key on photos.id (UUID) — the user-visible
 * path never reveals the R2 object key. Every photo image still
 * goes through the auth-gated proxy at /api/photos/[id]/image,
 * which enforces canViewPhoto (closes the person-photo bypass that
 * existed on the legacy /api/photos/[key]/image endpoint) plus
 * private-ownership checks. R2 keys stay internal.
 *
 * `size: '256'` requests the pre-generated 256x256 webp thumbnail
 * (used in gallery / admin grid / cluster modals). `size: 'full'`
 * returns the original upload (used in /photos/[id] and the modal).
 */
export type PhotoSize = 'full' | '256';

export function photoImageUrl(
  photo: { id: string },
  size: PhotoSize = 'full',
): string {
  const qs = size === '256' ? '?w=256' : '';
  return `/api/photos/${photo.id}/image${qs}`;
}
