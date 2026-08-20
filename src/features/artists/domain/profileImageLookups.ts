import type { Artist, ExternalLink } from '../../../modules/models/models.js';
import { dedupeStrings } from '../../../common/utils/array.js';
import type { ArtistProfileImageLookup } from '../../../utils/types/taskTypes.js';
import { getExternalLinkUrlsByService } from '../../../utils/helpers/externalLinks.js';

type ArtistSummaryWithOptionalDiscogsUrls = {
    id: string;
    name?: string;
    discogsUrls?: unknown;
};

const normalizeDiscogsUrls = (discogsUrls: unknown): string[] | undefined => {
    if (!Array.isArray(discogsUrls)) {
        return undefined;
    }

    const normalized = dedupeStrings(
        discogsUrls
            .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
            .map((url) => url.trim()),
    );

    return normalized.length > 0 ? normalized : undefined;
};

const getDiscogsUrlsFromExternalLinks = (externalLinks: ExternalLink[] | undefined): string[] => {
    return getExternalLinkUrlsByService(externalLinks, 'discogs');
};

export const mapArtistSummaryToProfileImageLookup = (
    summary: ArtistSummaryWithOptionalDiscogsUrls,
): ArtistProfileImageLookup => ({
    artistId: summary.id,
    artistName: summary.name,
    discogsUrls: normalizeDiscogsUrls(summary.discogsUrls),
});

export const mapArtistToProfileImageLookup = (
    artistId: string,
    artist: Artist,
): ArtistProfileImageLookup => ({
    artistId,
    artistName: artist.name,
    discogsUrls: getDiscogsUrlsFromExternalLinks(artist.externalLinks),
});
