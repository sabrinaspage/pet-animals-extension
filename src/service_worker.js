// service_worker.js
// Runs TFJS + COCO-SSD in the extension's background context (which tolerates
// the dynamic-codegen patterns TFJS uses — the content-script CSP does not).
//
// Protocol:
//   content -> worker: { type: 'DETECT', imageData: {data, width, height} }
//   worker  -> content: { ok: true, animals: [{bbox, class, score}, ...] }
//                   or: { ok: false, error: '...' }

import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// Service workers can be killed by Chrome after ~30s idle. The module-level
// `modelPromise` will be re-initialized on next wake-up. That's fine — model
// weights are cached by the browser so re-load is fast.
let modelPromise = null;

function getModel() {
  if (!modelPromise) {
    // Force CPU backend. WebGL isn't available in a service worker (no canvas
    // context / no document). lite_mobilenet_v2 is the smallest/fastest base.
    modelPromise = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      return cocoSsd.load({ base: 'lite_mobilenet_v2' });
    })();
  }
  return modelPromise;
}

const ANIMAL_CLASSES = new Set([
  'cat', 'dog', 'bird', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe'
]);

const MIN_SCORE = 0.55;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'DETECT') return false;

  (async () => {
    try {
      const { data, width, height } = msg.imageData;
      // Reconstruct ImageData from the transferred payload. Note that
      // chrome.runtime messages are structured-cloned; plain arrays survive
      // but typed arrays sometimes don't, so the content script passes the
      // underlying buffer and we wrap it here.
      const pixels = new Uint8ClampedArray(data);
      const imageData = new ImageData(pixels, width, height);

      const model = await getModel();
      const predictions = await model.detect(imageData);

      const animals = predictions
        .filter((p) => ANIMAL_CLASSES.has(p.class) && p.score >= MIN_SCORE)
        .map((p) => ({ bbox: p.bbox, class: p.class, score: p.score }));

      sendResponse({ ok: true, animals });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  // Return true to signal async sendResponse. Without this, the channel closes.
  return true;
});
