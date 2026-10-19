import type { ContentSection } from '../ContentSection';
import { HELP_RTP_TITLE } from '../../../../backend/LocalizationData';

function formatRtpDisplay(raw: string): string {
	const text = raw.trim();
	if (!text) {
		return text;
	}
	if (/%/.test(text)) {
		return text;
	}
	if (/^\d+(\.\d+)?$/.test(text)) {
		return `${text}%`;
	}
	return text;
}

const FALLBACK_RTP_TEXT = '97%';

export function getRtpContent(
    gameAPI?: { getRtp: () => string | null } | null,
): ContentSection {
    const fromApi = gameAPI?.getRtp() ?? null;
    const value = fromApi != null ? formatRtpDisplay(fromApi) : FALLBACK_RTP_TEXT;
    return {
        Header: {
            opts: { padding: { top: 12, bottom: 12 } },
            key: HELP_RTP_TITLE,
            value: 'RTP',
        },
        Content: [{ Text: { opts: { padding: 2 }, value } }],
    };
}
