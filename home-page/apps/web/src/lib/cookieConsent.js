const CONSENT_COOKIE = 'cc_cookie';
const CONSENT_MAX_AGE_SECONDS = 182 * 24 * 60 * 60;
const CONSENT_EVENT = 'cc:onConsent';
const CONSENT_CHANGE_EVENT = 'cc:onChange';
const PREFERENCES_REQUESTED_EVENT = 'horizons:cookie-preferences-requested';

/**
 * Cookie categories the visitor chooses between. `Necessary` is always granted.
 * The store's Google Analytics stores cookies only with `Analytics`, its Meta Pixel
 * loads only with `Marketing`, and checkout lets Hostinger's own analytics
 * (Amplitude) use cookies only with `PlatformAnalytics`. Gate any script you add
 * the same way.
 */
export const CookieConsentCategory = {
	Necessary: 'necessary',
	Analytics: 'analytics',
	Marketing: 'marketing',
	PlatformAnalytics: 'platformAnalytics',
};

/** The categories the visitor accepted, or `null` before they have chosen. */
export function getConsentCategories() {
	if (typeof document === 'undefined') {
		return null;
	}

	const prefix = `${CONSENT_COOKIE}=`;
	const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));

	try {
		const categories = cookie ? JSON.parse(decodeURIComponent(cookie.slice(prefix.length))).categories : null;

		return Array.isArray(categories) ? categories : null;
	} catch {
		return null;
	}
}

export function hasConsentDecision() {
	return getConsentCategories() !== null;
}

export function isConsentGranted(category) {
	return !!getConsentCategories()?.includes(category);
}

/** Stores the visitor's choice and tells the platform's tracking about it. */
export function saveConsent({ analytics, marketing, platformAnalytics }) {
	const isFirstDecision = !hasConsentDecision();
	const categories = [
		CookieConsentCategory.Necessary,
		...(analytics ? [CookieConsentCategory.Analytics] : []),
		...(marketing ? [CookieConsentCategory.Marketing] : []),
		...(platformAnalytics ? [CookieConsentCategory.PlatformAnalytics] : []),
	];
	const value = encodeURIComponent(JSON.stringify({ categories, consentTimestamp: new Date().toISOString() }));

	document.cookie = `${CONSENT_COOKIE}=${value}; max-age=${CONSENT_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;
	window.dispatchEvent(new CustomEvent(isFirstDecision ? CONSENT_EVENT : CONSENT_CHANGE_EVENT, { detail: { categories } }));
}

export function acceptAllCookies() {
	saveConsent({ analytics: true, marketing: true, platformAnalytics: true });
}

export function rejectOptionalCookies() {
	saveConsent({ analytics: false, marketing: false, platformAnalytics: false });
}

/** Reopens the preferences for a "Cookie settings" link, typically in the footer. */
export function openCookiePreferences() {
	window.dispatchEvent(new Event(PREFERENCES_REQUESTED_EVENT));
}

/** Lets the banner react to `openCookiePreferences`. Returns the unsubscribe function. */
export function onCookiePreferencesRequested(callback) {
	window.addEventListener(PREFERENCES_REQUESTED_EVENT, callback);

	return () => window.removeEventListener(PREFERENCES_REQUESTED_EVENT, callback);
}
