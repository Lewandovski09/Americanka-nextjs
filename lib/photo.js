// Client-side photo preparation, shared by registration and profile.
//
// A photo straight from a phone is 3–20 MB, may be rotated by EXIF, and
// may be in a format the browser can decode but not display (HEIC from
// iPhones is the common one). Re-drawing it through a canvas fixes all
// three at once: the result is always an upright JPEG of at most
// PHOTO_MAX_DIM px, around 200 KB.
//
// Reading the file with FileReader instead — which is what registration
// used to do — passes HEIC through untouched, so the preview stays
// blank, and uploads the full multi-megabyte original.

export const PHOTO_MAX_DIM = 1024;

export async function toJpegDataUrl(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = objectUrl;
    });

    const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
