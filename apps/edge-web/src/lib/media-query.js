import { onBeforeUnmount, ref } from 'vue';

/**
 * PFI-18 (RFC 024): "até 768 px" is a phone. The page reads the same media
 * query the browser does, so a window resized across it changes the layout
 * without a reload and without touching what is typed.
 */
export const PHONE_QUERY = '(max-width: 768px)';

/**
 * Whether the screen is a phone, kept in step with the media query. The
 * listener is removed with the component that asked for it.
 *
 * @returns {import('vue').Ref<boolean>}
 */
export function usePhone() {
  const query = globalThis.matchMedia?.(PHONE_QUERY);
  const isPhone = ref(Boolean(query?.matches));
  if (!query) return isPhone;
  /** @param {MediaQueryListEvent} event */
  const update = (event) => {
    isPhone.value = event.matches;
  };
  query.addEventListener('change', update);
  onBeforeUnmount(() => query.removeEventListener('change', update));
  return isPhone;
}
