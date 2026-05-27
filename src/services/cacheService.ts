import Redis from "ioredis";
import { createLogger } from '../common/logging/logger.js';
import { cacheConfig } from '../config/runtimeConfig.js';

const logger = createLogger('services.cache');

const redisClient = new Redis(cacheConfig.redisUrl, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
});

const MAX_REQUEST_SIZE = 1024 * 1024;
const METADATA_OVERHEAD = 100;
const DEFAULT_CACHE_TTL_HOURS = cacheConfig.defaultTtlHours;

const UNDEFINED_MARKER = "__redis__undefined__";

const getEffectiveTtlInHours = (ttlInHours?: number): number => (
    ttlInHours && Number.isFinite(ttlInHours) && ttlInHours > 0
        ? ttlInHours
        : DEFAULT_CACHE_TTL_HOURS
);

const getSafeChunkSize = (key: string): number => {
    const chunkKeySize = Buffer.byteLength(`${key}:chunk0000`, 'utf-8');
    return MAX_REQUEST_SIZE - chunkKeySize - METADATA_OVERHEAD;
};

const splitUtf8StringByByteSize = (value: string, maxBytes: number): string[] => {
    const chunks: string[] = [];
    let currentChunk = '';
    let currentChunkBytes = 0;

    for (const char of value) {
        const charBytes = Buffer.byteLength(char, 'utf-8');

        if (charBytes > maxBytes) {
            throw new Error('A single character is larger than the Redis chunk size');
        }

        if (currentChunk && currentChunkBytes + charBytes > maxBytes) {
            chunks.push(currentChunk);
            currentChunk = '';
            currentChunkBytes = 0;
        }

        currentChunk += char;
        currentChunkBytes += charBytes;
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
};

const executePipelineWithRetry = async (
    pipeline: ReturnType<typeof redisClient.multi>,
    retries = 3,
): Promise<[Error | null, unknown][]> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const results = await pipeline.exec();
            if (!results) throw new Error('Pipeline execution failed');

            results.forEach(([err], index) => {
                if (err) {
                    logger.error('redis pipeline command failed', { commandIndex: index, error: err });
                    throw err;
                }
            });
            return results;
        } catch (error) {
            if (attempt === retries) throw error;
            logger.warn('redis pipeline failed, retrying', { attempt, error });
        }
    }

    throw new Error('Pipeline execution failed');
};

const serializeData = (data: unknown): string => {
    return JSON.stringify(data, (_, value) =>
        value === undefined ? UNDEFINED_MARKER : value
    );
};

const deserializeData = <T = unknown>(dataString: string): T => {
    return JSON.parse(dataString, (_, value) =>
        value === UNDEFINED_MARKER ? undefined : value
    ) as T;
};

const getChunkKeys = (key: string, totalChunks: number): string[] => (
    Array.from({ length: totalChunks }, (_, index) => `${key}:chunk${index.toString().padStart(4, '0')}`)
);

const parseChunkMetadata = (metadata: string | null): number | null => {
    if (!metadata) {
        return null;
    }

    try {
        const parsed = JSON.parse(metadata);
        const totalChunks = Number.parseInt(String(parsed.totalChunks ?? ''), 10);
        return Number.isFinite(totalChunks) && totalChunks > 0 ? totalChunks : null;
    } catch {
        return null;
    }
};

export const deleteCachedData = async (key: string): Promise<void> => {
    try {
        const metadata = await redisClient.get(`${key}:metadata`);
        const totalChunks = parseChunkMetadata(metadata);
        const pipeline = redisClient.multi();

        pipeline.del(key);
        pipeline.del(`${key}:metadata`);

        if (totalChunks) {
            for (const chunkKey of getChunkKeys(key, totalChunks)) {
                pipeline.del(chunkKey);
            }
        }

        await executePipelineWithRetry(pipeline);
    } catch (error) {
        logger.error('delete cache failed', { key, error });
        throw error;
    }
};

const setCachedData = async (
    key: string,
    data: unknown,
    ttlInHours?: number,
): Promise<void> => {
    try {
        await deleteCachedData(key);

        const effectiveTtlInHours = getEffectiveTtlInHours(ttlInHours);
        const ttlInSeconds = effectiveTtlInHours * 3600;
        const dataString = serializeData(data);
        const safeChunkSize = getSafeChunkSize(key);

        if (Buffer.byteLength(dataString, 'utf-8') <= safeChunkSize) {
            await redisClient.set(key, dataString, 'EX', ttlInSeconds);
            return;
        }

        const chunks = splitUtf8StringByByteSize(dataString, safeChunkSize);

        logger.debug('saving chunked cache value', { key, chunkCount: chunks.length });

        const pipeline = redisClient.multi();
        pipeline.set(`${key}:metadata`, JSON.stringify({ totalChunks: chunks.length }), 'EX', ttlInSeconds);

        for (let i = 0; i < chunks.length; i++) {
            const chunkKey = `${key}:chunk${i.toString().padStart(4, '0')}`;
            pipeline.set(chunkKey, chunks[i], 'EX', ttlInSeconds);
        }

        await executePipelineWithRetry(pipeline);
        logger.debug('chunked cache value saved', { key, chunkCount: chunks.length });
    } catch (error) {
        logger.error('set cache failed', { key, error });
        throw error;
    }
};

export const getCachedData = async <T>(key: string): Promise<T | null> => {
    try {
        const metadata = await redisClient.get(`${key}:metadata`);
        const totalChunks = parseChunkMetadata(metadata);

        if (!totalChunks) {
            const data = await redisClient.get(key);
            return data ? deserializeData<T>(data) : null;
        }

        const pipeline = redisClient.multi();
        for (const chunkKey of getChunkKeys(key, totalChunks)) {
            pipeline.get(chunkKey);
        }

        const results = await pipeline.exec();
        if (!results) throw new Error('Pipeline execution failed');

        const chunks: string[] = [];
        let missingChunkCount = 0;
        results.forEach(([err, result]) => {
            if (err) throw err;
            if (typeof result !== 'string') {
                missingChunkCount += 1;
                return;
            }

            chunks.push(result);
        });

        if (missingChunkCount > 0) {
            logger.warn('chunked cache value missing redis chunks', { key, missingChunkCount });
            await deleteCachedData(key);
            return null;
        }

        return deserializeData<T>(chunks.join(''));
    } catch (error) {
        logger.error('get cache failed', { key, error });
        throw error;
    }
};

export const replaceCachedData = async <T>(
    key: string,
    data: T,
    ttlInHours?: number,
): Promise<void> => {
    try {
        await setCachedData(key, data, ttlInHours);
    } catch (error) {
        logger.error('replace cache failed', { key, error });
        throw error;
    }
};
