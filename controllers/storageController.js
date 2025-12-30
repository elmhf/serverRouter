import { supabaseAdmin } from '../supabaseClient.js';

// Helper to format bytes
const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

// Recursively calculate bucket stats
const getBucketDetailsRecursive = async (bucketName, path = '') => {
    let totalSize = 0;
    let fileCount = 0;
    let allFiles = [];

    const { data: items, error } = await supabaseAdmin.storage.from(bucketName).list(path, { limit: 500 }); // Reasonable chunk limit

    if (error || !items) return { totalSize, fileCount, allFiles };

    for (const item of items) {
        if (!item.id) {
            // It's a folder: Recurse
            // Avoid infinite loops by simple tree descent
            const subStats = await getBucketDetailsRecursive(bucketName, `${path}${item.name}/`);
            totalSize += subStats.totalSize;
            fileCount += subStats.fileCount;
            allFiles = [...allFiles, ...subStats.allFiles];
        } else {
            // It's a file
            if (item.name !== '.emptyFolderPlaceholder') {
                const size = item.metadata?.size || 0;
                totalSize += size;
                fileCount++;
                allFiles.push({
                    name: item.name,
                    bucket: bucketName,
                    size: formatBytes(size),
                    rawSize: size,
                    created_at: item.created_at,
                    rawDate: new Date(item.created_at)
                });
            }
        }
    }
    return { totalSize, fileCount, allFiles };
};

export const getStorageStats = async (req, res) => {
    try {
        // 1. List all buckets
        const { data: buckets, error: bucketsError } = await supabaseAdmin.storage.listBuckets();

        if (bucketsError) {
            console.error('Error fetching buckets:', bucketsError);
            return res.status(500).json({ error: 'Failed to fetch buckets' });
        }

        let totalSizeBytes = 0;
        let totalFiles = 0;
        const bucketStats = [];
        let allRecentFiles = [];

        // 2. Iterate buckets and recurse
        for (const bucket of buckets) {
            const stats = await getBucketDetailsRecursive(bucket.name);

            totalSizeBytes += stats.totalSize;
            totalFiles += stats.fileCount;

            // Determine UI props
            let uiType = bucket.public ? 'public' : 'private';
            let uiColor = 'bg-gray-400';
            if (bucket.name.includes('image') || bucket.name.includes('avatar')) uiColor = 'bg-emerald-500';
            else if (bucket.name.includes('doc') || bucket.name.includes('report')) uiColor = 'bg-indigo-500';
            else if (bucket.name.includes('backup')) uiColor = 'bg-amber-500';

            bucketStats.push({
                label: bucket.name,
                size: formatBytes(stats.totalSize),
                rawSize: stats.totalSize,
                count: stats.fileCount,
                percentage: 0,
                color: uiColor,
                type: uiType
            });

            // Aggregate recent files
            allRecentFiles = [...allRecentFiles, ...stats.allFiles];
        }

        // 3. Post-process
        bucketStats.forEach(b => {
            b.percentage = totalSizeBytes > 0 ? Math.round((b.rawSize / totalSizeBytes) * 100) : 0;
        });

        // Top 5 recent
        allRecentFiles.sort((a, b) => b.rawDate - a.rawDate);
        const recentFiles = allRecentFiles.slice(0, 5).map(f => ({
            name: f.name,
            bucket: f.bucket,
            size: f.size,
            date: f.rawDate.toLocaleString()
        }));

        res.json({
            totalSize: formatBytes(totalSizeBytes),
            totalSizeGB: (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2),
            totalFiles,
            buckets: bucketStats,
            recentFiles
        });

    } catch (error) {
        console.error('getStorageStats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getBucketContent = async (req, res) => {
    try {
        const { bucketName } = req.params;
        // Optional: Support query param ?path=folder/
        const path = req.query.path || '';

        if (!bucketName) {
            return res.status(400).json({ error: 'Bucket name is required' });
        }

        // Fetch files at current level
        const { data: items, error } = await supabaseAdmin
            .storage
            .from(bucketName)
            .list(path, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });

        if (error) {
            console.error(`Error fetching bucket ${bucketName}:`, error);
            return res.status(500).json({ error: 'Failed to fetch bucket content' });
        }

        // Let's formatting Items to properly show folders.

        const formattedFiles = items
            .filter(f => f.name !== '.emptyFolderPlaceholder')
            .map(f => {
                const isFolder = !f.id;
                return {
                    id: f.id || f.name, // Use name as ID for folders
                    name: f.name,
                    isFolder,
                    size: isFolder ? '-' : formatBytes(f.metadata?.size || 0),
                    rawSize: f.metadata?.size || 0,
                    type: isFolder ? 'Folder' : (f.metadata?.mimetype || 'unknown'),
                    created_at: f.created_at ? new Date(f.created_at).toLocaleString() : '-',
                    updated_at: f.updated_at ? new Date(f.updated_at).toLocaleString() : '-'
                };
            });

        // Let's run recursive stats for the header info

        const fullStats = await getBucketDetailsRecursive(bucketName);

        res.json({
            bucketName,
            currentPath: path,
            stats: {
                count: fullStats.fileCount,
                totalSize: formatBytes(fullStats.totalSize)
            },
            files: formattedFiles
        });

    } catch (error) {
        console.error('getBucketContent error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
