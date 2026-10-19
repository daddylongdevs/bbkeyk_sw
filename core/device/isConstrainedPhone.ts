/**
 * Phones that should stay on the original textures and a 1× canvas.
 * Padding NPOT Spine pages up to the next power of two (often 4096²) plus a
 * mip chain exhausts GPU memory on some handsets and the tab dies.
 */
export function isConstrainedPhone(): boolean {
	try {
		const ua = navigator.userAgent || '';
		if (/ipad/i.test(ua)) return false;
		const iPhone = /iphone|ipod/i.test(ua);
		const android = /android/i.test(ua);
		const otherMobile = /iemobile|blackberry|opera mini|mobile/i.test(ua);
		if (!(iPhone || android || otherMobile)) return false;
		// Android tablets usually omit "Mobile" and have the memory for hi-res.
		if (android && !/mobile/i.test(ua)) {
			const cssMax = Math.max(Number(window.innerWidth) || 0, Number(window.innerHeight) || 0);
			if (cssMax >= 1000) return false;
		}
		return true;
	} catch {
		return false;
	}
}
