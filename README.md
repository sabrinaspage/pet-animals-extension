# Pet the Animals 🖐️🐾

Chrome extension. Hover over an animal in any image on any webpage — your cursor becomes a petting hand.

Built with TensorFlow.js + COCO-SSD running entirely in the browser. Detects cats, dogs, birds, horses, sheep, cows, elephants, bears, zebras, and giraffes.

## Install from source

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked** and select the `dist/` folder

## How it works

- Content script listens for hover on `<img>` elements
- On first hover, the image is drawn to a canvas and its pixels are sent to the extension's service worker
- The service worker runs COCO-SSD (object detection, ~27MB model, cached after first load) and returns bounding boxes for any animals it finds
- When the cursor is inside a bounding box, a CSS class swaps the cursor to a hand

ML has to run in the service worker — content scripts can't execute the dynamic code generation TensorFlow.js uses (Manifest V3 Content Security Policy blocks it).

## File layout

```
src/
  content.js           hover binding, canvas extraction, cursor toggling
  service_worker.js    TFJS + COCO-SSD, handles DETECT messages
public/
  manifest.json        extension manifest
  content.css          cursor rule (hand PNG inlined as data URI)
  icons/hand.svg       cursor source art
  icons/hand.png       32x32 rendered cursor
build.mjs              esbuild bundling + public/ copy
```

## Known limitations

- **CORS**: some images won't scan because their server doesn't allow cross-origin canvas reads. These silently fall back to the normal cursor.
- **Model coverage**: COCO-SSD only knows 10 mammal/bird classes. Hamsters, reptiles, fish, etc. aren't detected.
- **First hover is slow**: ~1–3 seconds while the model loads. Subsequent images are fast.

## Note

The `package-lock.json` pins TensorFlow.js to 4.22.0, which is known to work inside an MV3 service worker. Other versions have not been tested; if you upgrade, verify the service worker still boots (look for CSP / `eval` errors in `chrome://extensions` → "Service worker").
