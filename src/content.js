// content.js
// No ML here. Binds mouseenter/mousemove/mouseleave on images, on first hover
// sends an ImageData to the service worker for detection, caches the result,
// and toggles a CSS class to swap the cursor inside detected bounding boxes.

(() => {
  console.debug('[pet-animals] content script loaded in', location.href,
    'has chrome.runtime:', !!chrome?.runtime?.sendMessage);
  const MIN_DIM = 80;               // skip icons, sprites, tracking pixels
  const CURSOR_CLASS = '__pet-animals-hand';

  // Per-image detection cache. Map<src, Promise<Array<{bbox, class, score}>>>
  const detections = new Map();

  // Fetch a same-origin or cross-origin image and draw it to a canvas so we can
  // pull ImageData. Requires the remote server to permit anonymous CORS reads;
  // otherwise the canvas is tainted and getImageData throws.
  function loadImageToCanvas(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          // Downscale very large images — COCO-SSD resizes internally to 300x300
          // anyway, so there's no accuracy win sending a 4000x3000 original.
          // Keep enough resolution to preserve aspect ratio detail.
          const MAX = 640;
          let { naturalWidth: w, naturalHeight: h } = img;
          if (Math.max(w, h) > MAX) {
            const scale = MAX / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = new OffscreenCanvas(w, h);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          resolve(imageData);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('image load failed: ' + src));
      img.src = src;
    });
  }

  async function detect(src) {
    if (detections.has(src)) return detections.get(src);

    const work = (async () => {
      let imageData;
      try {
        imageData = await loadImageToCanvas(src);
      } catch (err) {
        console.debug('[pet-animals] canvas load failed (likely CORS):', err.message);
        return [];
      }

      const payload = {
        type: 'DETECT',
        imageData: {
          data: Array.from(imageData.data),
          width: imageData.width,
          height: imageData.height,
        },
      };

      const resp = await (async () => {
        if (!chrome?.runtime?.sendMessage) {
          console.debug('[pet-animals] chrome.runtime unavailable in this context');
          return { ok: false };
        }
        try {
          return await chrome.runtime.sendMessage(payload);
        } catch (e) {
          console.debug('[pet-animals] worker message failed:', e.message);
          return { ok: false };
        }
      })();

      if (!resp?.ok) return [];

      return {
        animals: resp.animals,
        sourceWidth: imageData.width,
        sourceHeight: imageData.height,
      };
    })();

    detections.set(src, work);
    return work;
  }

  function isCursorOverAnimal(img, result, event) {
    if (!result || !result.animals || result.animals.length === 0) return false;
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / result.sourceWidth;
    const scaleY = rect.height / result.sourceHeight;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    for (const a of result.animals) {
      const [x, y, w, h] = a.bbox;
      if (
        localX >= x * scaleX &&
        localX <= (x + w) * scaleX &&
        localY >= y * scaleY &&
        localY <= (y + h) * scaleY
      ) {
        return true;
      }
    }
    return false;
  }

  function setCursor(img, on) {
    img.classList.toggle(CURSOR_CLASS, on);
  }

  const bound = new WeakSet();
  function bindImage(img) {
    if (bound.has(img)) return;
    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener('load', () => bindImage(img), { once: true });
      return;
    }
    if (img.naturalWidth < MIN_DIM || img.naturalHeight < MIN_DIM) return;
    bound.add(img);

    let resultPromise = null;
    const src = img.currentSrc || img.src;

    img.addEventListener('mouseenter', () => {
      if (!resultPromise) resultPromise = detect(src);
    });

    img.addEventListener('mousemove', async (event) => {
      if (!resultPromise) resultPromise = detect(src);
      const result = await resultPromise;
      if (!result || (Array.isArray(result) && result.length === 0)) return;
      setCursor(img, isCursorOverAnimal(img, result, event));
    });

    img.addEventListener('mouseleave', () => setCursor(img, false));
  }

  document.querySelectorAll('img').forEach(bindImage);

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') bindImage(node);
        else if (node.querySelectorAll) node.querySelectorAll('img').forEach(bindImage);
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
