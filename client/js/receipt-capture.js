// =============================================
// receipt-capture.js - In-System Camera Receipt Capture
//
// Self-contained modal: live camera preview -> capture -> review
// (Submit Receipt / Take Photo Again) -> client-side compression.
// File-picker fallback for desktop admins and scanned PDFs.
//
// API: ReceiptCapture.open() -> Promise<{ blob, name, size } | null>
//   Resolves null when the user cancels. Nothing is stored server-side
//   here; the caller uploads the returned Blob with its request.
// =============================================

const ReceiptCapture = (() => {

  const MAX_EDGE       = 1600;  // px, long edge after capture
  const RETRY_EDGE     = 1200;  // px, second pass if still too big
  const TARGET_BYTES   = 400 * 1024;
  const QUALITY_FIRST  = 0.7;
  const QUALITY_RETRY  = 0.5;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  let _els        = null;
  let _stream     = null;
  let _captured   = null; // canvas with the frozen frame
  let _resolver   = null;
  let _resolved   = false;

  function ensureModal() {
    if (_els) return;

    const wrap = document.createElement('div');
    wrap.className = 'receipt-capture-overlay hidden';
    wrap.innerHTML = `
      <div class="receipt-capture-modal" role="dialog" aria-label="Capture receipt">
        <div class="receipt-capture-head">
          <h3><iconify-icon icon="solar:camera-minimalistic-linear"></iconify-icon> Capture Receipt</h3>
          <button type="button" class="receipt-capture-close" data-rc="cancel" aria-label="Close">&times;</button>
        </div>

        <div class="receipt-capture-stage">
          <video class="receipt-capture-video" autoplay playsinline muted></video>
          <img class="receipt-capture-preview hidden" alt="Captured receipt preview" />
          <div class="receipt-capture-error hidden">
            <iconify-icon icon="solar:camera-minimalistic-linear" style="font-size:2rem"></iconify-icon>
            <p>Camera unavailable. You can still attach a photo or PDF file instead.</p>
          </div>
        </div>

        <div class="receipt-capture-actions">
          <button type="button" class="btn btn-primary" data-rc="capture" style="min-width:140px">
            <iconify-icon icon="solar:camera-minimalistic-linear"></iconify-icon> Capture
          </button>
          <button type="button" class="btn btn-primary hidden" data-rc="submit" style="min-width:140px">
            <iconify-icon icon="solar:check-circle-linear"></iconify-icon> Submit Receipt
          </button>
          <button type="button" class="btn btn-ghost hidden" data-rc="retake" style="min-width:140px">
            <iconify-icon icon="solar:refresh-linear"></iconify-icon> Take Photo Again
          </button>
          <label class="receipt-capture-file-label">
            or choose a file (image or PDF)
            <input type="file" data-rc="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden />
          </label>
        </div>

        <p class="receipt-capture-note">Photos are compressed automatically to keep storage lean.</p>
      </div>`;
    document.body.appendChild(wrap);

    _els = {
      overlay:  wrap,
      video:    wrap.querySelector('.receipt-capture-video'),
      preview:  wrap.querySelector('.receipt-capture-preview'),
      error:    wrap.querySelector('.receipt-capture-error'),
      capture:  wrap.querySelector('[data-rc="capture"]'),
      submit:   wrap.querySelector('[data-rc="submit"]'),
      retake:   wrap.querySelector('[data-rc="retake"]'),
      file:     wrap.querySelector('[data-rc="file"]'),
    };

    _els.capture.addEventListener('click', captureFrame);
    _els.submit.addEventListener('click', submitCaptured);
    _els.retake.addEventListener('click', retake);
    _els.file.addEventListener('change', onFileChosen);
    wrap.querySelector('[data-rc="cancel"]').addEventListener('click', () => close(null));
  }

  function resetStage() {
    _captured = null;
    _els.preview.classList.add('hidden');
    _els.preview.removeAttribute('src');
    _els.error.classList.add('hidden');
    _els.submit.classList.add('hidden');
    _els.retake.classList.add('hidden');
    _els.capture.classList.remove('hidden');
    _els.file.value = '';
  }

  async function startCamera() {
    stopStream();
    resetStage();
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      _els.video.srcObject = _stream;
      _els.video.classList.remove('hidden');
    } catch (err) {
      // No camera or permission denied - fall back to the file picker
      _els.video.classList.add('hidden');
      _els.error.classList.remove('hidden');
      _els.capture.classList.add('hidden');
    }
  }

  function stopStream() {
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
  }

  function captureFrame() {
    if (!_stream) return;
    const v = _els.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    _captured = canvas;

    // Freeze the frame for review
    _els.preview.src = canvas.toDataURL('image/jpeg', 0.8);
    _els.preview.classList.remove('hidden');
    _els.video.classList.add('hidden');
    _els.capture.classList.add('hidden');
    _els.submit.classList.remove('hidden');
    _els.retake.classList.remove('hidden');
  }

  function retake() {
    resetStage();
    if (_stream) {
      _els.video.classList.remove('hidden');
    } else {
      _els.error.classList.remove('hidden');
    }
  }

  function compressCanvas(canvas, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  async function compressCaptured() {
    let blob = await compressCanvas(_captured, QUALITY_FIRST);
    if (blob && blob.size > TARGET_BYTES) {
      const scale = RETRY_EDGE / Math.max(_captured.width, _captured.height);
      if (scale < 1) {
        const small = document.createElement('canvas');
        small.width  = Math.round(_captured.width * scale);
        small.height = Math.round(_captured.height * scale);
        small.getContext('2d').drawImage(_captured, 0, 0, small.width, small.height);
        _captured = small;
      }
      const retry = await compressCanvas(_captured, QUALITY_RETRY);
      if (retry && retry.size < blob.size) blob = retry;
    }
    return blob;
  }

  async function submitCaptured() {
    if (!_captured) return;
    _els.submit.disabled = true;
    try {
      const blob = await compressCaptured();
      if (blob) finish({ blob, name: `receipt-${Date.now()}.jpg`, size: blob.size });
    } finally {
      _els.submit.disabled = false;
    }
  }

  async function onFileChosen() {
    const file = _els.file.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      UI.toast('File exceeds the 5 MB limit.', 'error');
      _els.file.value = '';
      return;
    }

    if (file.type === 'application/pdf') {
      finish({ blob: file, name: file.name, size: file.size });
      return;
    }

    // Raster images go through the same compression as camera captures
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload  = () => resolve(image);
        image.onerror = () => reject(new Error('unreadable image'));
        image.src = url;
      });
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      _captured = canvas;

      const blob = await compressCaptured();
      if (blob) finish({ blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', size: blob.size });
    } catch {
      UI.toast('Could not read that image file.', 'error');
    } finally {
      URL.revokeObjectURL(url);
      _els.file.value = '';
    }
  }

  function finish(result) {
    if (_resolved) return;
    _resolved = true;
    stopStream();
    _els.overlay.classList.add('hidden');
    if (_resolver) _resolver(result);
  }

  function close(result) {
    if (_resolved) return;
    finish(result);
  }

  function open() {
    ensureModal();
    return new Promise(resolve => {
      _resolver = resolve;
      _resolved = false;
      _els.overlay.classList.remove('hidden');
      startCamera();
    });
  }

  return { open };
})();

// Module build (Vite): the page scripts are ES modules, so this namespace is
// published on window for the other scripts and the HTML to reach it.
window.ReceiptCapture = ReceiptCapture;
