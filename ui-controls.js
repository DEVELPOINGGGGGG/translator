/* AI Pro Suite shared UI controls: font sizing + close-safe history persistence */
(function () {
  const STORAGE_KEY = 'aiProFontScale';
  const FONT_OPTIONS = [
    { label: 'Small', value: '0.95' },
    { label: 'Normal', value: '1' },
    { label: 'Large', value: '1.12' },
    { label: 'XL', value: '1.25' },
    { label: 'MAX', value: '1.4' }
  ];

  function getSavedScale() {
    const saved = localStorage.getItem(STORAGE_KEY) || '1';
    return FONT_OPTIONS.some(option => option.value === saved) ? saved : '1';
  }

  function applyFontScale(value) {
    document.documentElement.style.setProperty('--app-font-scale', value);
    document.documentElement.dataset.fontScale = value;
    localStorage.setItem(STORAGE_KEY, value);
    document.querySelectorAll('.font-size-option').forEach(button => {
      button.classList.toggle('active', button.dataset.scale === value);
    });
  }

  function injectFontDock() {
    if (document.getElementById('fontSizeDock')) return;

    const dock = document.createElement('div');
    dock.id = 'fontSizeDock';
    dock.className = 'font-size-dock';
    dock.innerHTML = `
      <button class="font-size-toggle" type="button" aria-expanded="false" aria-controls="fontSizePanel" title="Change font size">
        <span class="font-size-icon">Aa</span>
      </button>
      <div class="font-size-panel" id="fontSizePanel" role="menu" aria-label="Choose font size">
        <div class="font-size-panel-title">Text size</div>
        <div class="font-size-options">
          ${FONT_OPTIONS.map(option => `<button class="font-size-option" type="button" data-scale="${option.value}" role="menuitem">${option.label}</button>`).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(dock);
    const toggle = dock.querySelector('.font-size-toggle');
    const panel = dock.querySelector('.font-size-panel');

    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const isOpen = dock.classList.toggle('active');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    panel.addEventListener('click', event => event.stopPropagation());
    dock.querySelectorAll('.font-size-option').forEach(button => {
      button.addEventListener('click', () => {
        applyFontScale(button.dataset.scale);
        dock.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', () => {
      dock.classList.remove('active');
      toggle.setAttribute('aria-expanded', 'false');
    });

    applyFontScale(getSavedScale());
  }

  function markHistoryCloseSnapshot() {
    try {
      const history = localStorage.getItem('aiHistory') || '[]';
      localStorage.setItem('aiHistoryClosedSnapshot', history);
      localStorage.setItem('aiHistoryClosedAt', new Date().toISOString());
    } catch (error) {
      console.warn('Could not create close-safe history snapshot', error);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyFontScale(getSavedScale());
    injectFontDock();
  });

  window.addEventListener('pagehide', markHistoryCloseSnapshot);
  window.addEventListener('beforeunload', markHistoryCloseSnapshot);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markHistoryCloseSnapshot();
  });
})();
