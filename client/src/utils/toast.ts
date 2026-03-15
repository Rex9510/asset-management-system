/**
 * Simple toast notification utility.
 * In a production app, this would integrate with a UI library's toast system.
 * For now, it uses a lightweight DOM-based approach.
 */

let toastContainer: HTMLDivElement | null = null;

function getToastContainer(): HTMLDivElement {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showErrorToast(message: string, duration = 3000): void {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText =
    'background:#ff4d4f;color:#fff;padding:8px 16px;border-radius:8px;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.15);pointer-events:auto;opacity:0;transition:opacity 0.3s;';
  container.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  // Auto remove
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}
