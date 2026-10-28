/**
 * Color input: text field + native color picker + live preview, kept in sync,
 * with clear validation messages. The text field accepts every format the
 * parser supports; the native picker (which only understands #rrggbb) edits
 * the RGB part and preserves any alpha already typed.
 */

import { debounce } from '../../../shared/helpers.js';
import { toColorPickerValue, toHex } from '../../../services/color-normalizer.js';
import { NAMED_COLORS } from '../../../shared/named-colors.js';
import { validateColorInput } from '../../../shared/validators.js';
import { icon } from '../../components/icons.js';

const hex2 = (n) => n.toString(16).padStart(2, '0');

/** Offer the CSS color names (red, green, darkblue ...) as autocomplete suggestions. */
function fillNameSuggestions(textInput) {
  const listId = textInput.getAttribute('list');
  const datalist = listId ? document.getElementById(listId) : null;
  if (!datalist || datalist.childElementCount > 0) return;
  datalist.replaceChildren(
    ...Object.entries(NAMED_COLORS).map(([name, hex]) => {
      const option = document.createElement('option');
      option.value = name;
      option.label = `${name}  ${hex}`;
      return option;
    }),
  );
}

/**
 * @param {object} config
 * @param {HTMLInputElement} config.textInput
 * @param {HTMLInputElement} config.picker
 * @param {HTMLElement} config.preview
 * @param {HTMLElement} config.errorEl
 * @param {HTMLElement} config.helpEl
 * @param {HTMLElement} config.pickerIcon
 * @param {(result: object) => void} [config.onChange]
 * @param {() => void} [config.onSubmit]
 */
export function createColorInput({ textInput, picker, preview, errorEl, helpEl, pickerIcon, onChange, onSubmit }) {
  const defaultHelp = helpEl.textContent.trim();
  let result = validateColorInput(textInput.value);
  pickerIcon.append(icon('eyedropper', { size: 15 }));
  fillNameSuggestions(textInput);

  const showErrorSoon = debounce(() => showValidity(true), 350);

  function showValidity(withError) {
    const invalid = !result.ok && textInput.value.trim() !== '';
    textInput.setAttribute('aria-invalid', String(invalid));
    preview.dataset.state = result.ok ? 'valid' : 'invalid';

    if (result.ok) {
      const { r, g, b, a } = result.color;
      preview.style.setProperty('--swatch', `rgba(${r}, ${g}, ${b}, ${a / 255})`);
      picker.value = toColorPickerValue(result.color);
      errorEl.hidden = true;
      helpEl.textContent = `${result.name ? `${result.name}  ·  ` : ''}${result.hex}  ·  ${result.rgb}  ·  alpha ${result.alpha}`;
      helpEl.classList.add('field-help--normalized');
    } else {
      preview.style.removeProperty('--swatch');
      helpEl.textContent = defaultHelp;
      helpEl.classList.remove('field-help--normalized');
      errorEl.hidden = !withError; // shown only when requested (blur / Find / debounce)
      errorEl.textContent = result.error;
    }
  }

  function update({ immediateError = false } = {}) {
    result = validateColorInput(textInput.value);
    if (result.ok) {
      showErrorSoon.cancel();
      showValidity(false);
    } else if (immediateError) {
      showErrorSoon.cancel();
      showValidity(true);
    } else {
      showValidity(false); // hold the message back while the user is still typing
      showErrorSoon();
    }
    onChange?.(result);
  }

  textInput.addEventListener('input', () => update());
  textInput.addEventListener('blur', () => update({ immediateError: true }));
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit?.();
    }
  });

  picker.addEventListener('input', () => {
    const rgb = picker.value; // always #rrggbb
    const alpha = result.ok && result.color.a < 255 ? hex2(result.color.a) : '';
    textInput.value = `${rgb}${alpha}`;
    update({ immediateError: true });
  });

  update({ immediateError: false });

  return {
    /** Current validation result ({ ok, color, hex, rgb, alpha } | { ok: false, error }). */
    getResult: () => result,
    /** Re-validate and surface any error immediately (used on Find). */
    validateNow() {
      update({ immediateError: true });
      return result;
    },
    setValue(text) {
      textInput.value = text;
      update({ immediateError: true });
    },
    focus: () => textInput.focus(),
    getHex: () => (result.ok ? toHex(result.color) : ''),
    setDisabled(disabled) {
      textInput.disabled = disabled;
      picker.disabled = disabled;
    },
  };
}
