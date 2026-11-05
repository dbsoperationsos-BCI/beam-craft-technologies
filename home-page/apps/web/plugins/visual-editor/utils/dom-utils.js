import { FIXED_CONTEXT_SELECTOR, ELEMENT_TYPE_MAP } from "../constants/selectors.js";

/**
 * Logical type of an element for the hover tooltip: `text`, `button`, `image`,
 * or `block` otherwise. Edit targets (`data-edit-id` / `data-edit-assisted-id`)
 * that are not button/image tags are `text`.
 * @param {HTMLElement} element
 * @returns {string}
 */
export function getElementType(element) {
	const tag = element?.tagName?.toLowerCase();
	const hasEditId = element?.hasAttribute?.('data-edit-id') || element?.hasAttribute?.('data-edit-assisted-id');

	for (const [type, tags] of Object.entries(ELEMENT_TYPE_MAP)) {
		if (tags.some(candidate => candidate.toLowerCase() === tag)) {
			if (!hasEditId && type === 'text') return 'block';
			return type;
		}
	}

	if (hasEditId) return 'text';

	return 'block';
}


/**
 * The app's mount point, which roots every structural walk so the editor's own
 * body-level surfaces (panels, markers, outlines) are never traversed.
 * @returns {HTMLElement}
 */
export function getAppRoot() {
	return document.getElementById('root') || document.body;
}


/**
 * True when the element sits inside a fixed/sticky ancestor, meaning overlays
 * must use viewport (fixed) positioning instead of document coordinates.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isInFixedContext(element) {
	return !!element.closest(FIXED_CONTEXT_SELECTOR);
}

/**
 * Host-page modal dialogs that are currently open and visible. Mounted-but-closed
 * dialogs are skipped so a dismissed modal never keeps blocking the page.
 * @returns {HTMLElement[]}
 */
export function getOpenModals() {
	return Array.from(document.querySelectorAll('[role="dialog"]')).filter(
		(modal) => modal.getAttribute('data-state') !== 'closed' && modal.checkVisibility?.() !== false,
	);
}

const HOST_ISOLATED_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'keyup'];

/**
 * Prevents host-page libraries (Radix DismissableLayer, FocusScope, etc.) from
 * seeing pointer and keyboard events that originate inside the editor's floating UI.
 * @param {HTMLElement} element
 */
export function isolateEditorUiEvents(element) {
	for (const eventName of HOST_ISOLATED_EVENTS) {
		element.addEventListener(eventName, (event) => event.stopPropagation());
	}
}
