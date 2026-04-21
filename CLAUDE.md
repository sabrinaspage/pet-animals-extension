# Project context for Claude Code

I'm working on a Chrome extension called "Pet the Animals" that detects animals in images on any webpage and swaps the cursor to a petting hand when hovering over them.

## Architecture

- **Manifest V3** Chrome extension
- **Content script** (`src/content.js`): uses `IntersectionObserver` to detect when `<img>` elements enter the viewport (+200px rootMargin). When an image becomes visible, loads it into an `OffscreenCanvas`, extracts `ImageData`, and sends it to the service worker via `chrome.runtime.sendMessage`. Caches detection results per image src in a `WeakMap`. On hover, checks cursor position against bounding boxes and toggles a CSS class (`__pet-animals-hand`) that swaps the cursor to an inlined data-URI PNG.
- **Service worker** (`src/service_worker.js`): runs TensorFlow.js + COCO-SSD (lite_mobilenet_v2 base). Currently uses the **CPU backend** (`@tensorflow/tfjs-backend-cpu`). Listens for `DETECT` messages, runs `model.detect()`, filters to animal classes (cat, dog, bird, horse, sheep, cow, elephant, bear, zebra, giraffe) above 0.55 confidence, returns bounding boxes.
- **Build** : esbuild bundles both entry points to `dist/` as IIFE, format targeting chrome110. `public/` (manifest, css, icons) is copied to `dist/` by `build.mjs`.

## Key decisions and why

- **Why TFJS runs in the service worker, not the content script** : MV3 content script CSP forbids `eval()` and `new Function()`. TFJS uses those internally for kernel codegen. Service workers have a different CSP that tolerates it.
- **Why CPU backend** : WebGL isn't available in service workers (no canvas/GPU context). Copied from Google's tfjs-examples/chrome-extension reference.
- **Why IntersectionObserver instead of on-hover** : first hover had a 1-3s lag while detection ran. Viewport-triggered detection warms up images before the user reaches them.
- **Cursor PNG is inlined as data URI** in `content.css` because content-script CSS relative URLs resolve against the _page's_ origin, not the extension's. Learned the hard way.

## File layout

```
src/
  content.js           # hover binding, IntersectionObserver, canvas extraction
  service_worker.js    # TFJS + COCO-SSD, DETECT handler
public/
  manifest.json
  content.css          # cursor rule with data-URI PNG
  icons/hand.svg
  icons/hand.png
build.mjs              # esbuild config
package.json
```

## Known limitations

- CORS: images from servers without `Access-Control-Allow-Origin` can't be scanned; silently falls back to normal cursor.
- COCO-SSD is trained on photos only — fails on illustrations, paintings, cartoons, anime.
- CPU inference is ~200–800ms per image.

## What I want to do next

**Performance notes**

- CPU inference is ~200–800ms per image. Slow because the service worker can't access WebGL/GPU — only CPU is available there. WASM backend (`@tensorflow/tfjs-backend-wasm`) would be 2-4x faster and is a ~10-line swap (not yet done). Offscreen document API would unlock WebGL for ~10x speedup but is a bigger architectural change.
- **Service worker lifecycle is the real performance killer.** Chrome kills MV3 service workers after ~30s idle. When the user hovers an image after sitting idle, Chrome spins up a fresh worker, which means re-running the init: reload TFJS, re-fetch model weights (from browser cache, but still unpack), re-init backend. That's 30+ seconds before detection even runs. Observed: first hover took a few seconds, second hover after waiting ~30s took 35 seconds. Classic symptom.
- Possible fixes, in order of effort:
  1. v0.5's viewport scanning may keep the worker busier and naturally avoid idle death. Test this first.
  2. Keepalive pattern (periodic self-messaging or `chrome.alarms`) to prevent Chrome from killing the worker. Officially discouraged but widely used.
  3. Cache model weights in IndexedDB so re-init skips network entirely.
  4. WASM backend — faster init AND faster inference.

#### Why CPU instead of WASM

I originally copied Google's tfjs-examples/chrome-extension reference, which uses the CPU backend. Should have led with WASM. No good reason for CPU other than "one less dependency file." WASM is the right default.

#### Why the model fails on illustrations

COCO-SSD is trained on photographs only. Paintings, line drawings, anime, cartoons — all fail. The model learned photo-realistic textures, not abstract visual shorthand. Would need a different model (CLIP-based, OWL-ViT, or fine-tuned on art) to fix.
