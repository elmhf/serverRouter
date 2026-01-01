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
                    name: path + item.name, // Store full path to identify folder structure
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
        const clinicStats = {}; // Map: clinicId -> { totalSize, reportSize, fileSize ... }

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

            // Aggregate clinic usage
            // Assumption: Top-level folders in 'file' and 'report' buckets are Clinic IDs
            if (bucket.name.toLowerCase().includes('file') || bucket.name.toLowerCase().includes('report') || bucket.name.toLowerCase().includes('doc')) {
                stats.allFiles.forEach(file => {
                    // Extract top-level folder
                    const parts = file.name.split('/');
                    if (parts.length > 1) {
                        const clinicId = parts[0];

                        if (!clinicStats[clinicId]) {
                            clinicStats[clinicId] = {
                                clinicId,
                                totalSize: 0,
                                reportSize: 0,
                                fileSize: 0,
                                reportCount: 0,
                                fileCount: 0
                            };
                        }

                        clinicStats[clinicId].totalSize += file.rawSize;

                        if (bucket.name.toLowerCase().includes('report') || bucket.name.toLowerCase().includes('doc')) {
                            clinicStats[clinicId].reportSize += file.rawSize;
                            clinicStats[clinicId].reportCount++;
                        } else {
                            clinicStats[clinicId].fileSize += file.rawSize;
                            clinicStats[clinicId].fileCount++;
                        }
                    }
                });
            }
        }

        // 3. Post-process buckets
        bucketStats.forEach(b => {
            b.percentage = totalSizeBytes > 0 ? Math.round((b.rawSize / totalSizeBytes) * 100) : 0;
        });

        // 4. Enrich with Clinic Details
        const clinicIds = Object.keys(clinicStats);
        let clinicDetailsMap = {};

        if (clinicIds.length > 0) {
            const { data: clinics, error: clinicsError } = await supabaseAdmin
                .from('clinics')
                .select('id, clinic_name, email, logo_url')
                .in('id', clinicIds);

            if (!clinicsError && clinics) {
                clinics.forEach(c => {
                    clinicDetailsMap[c.id] = c;
                });
            }
        }

        // 5. Format Clinic Usage
        const clinicUsage = Object.values(clinicStats)
            .sort((a, b) => b.totalSize - a.totalSize) // Sort by usage desc
            .map(c => {
                const details = clinicDetailsMap[c.clinicId] || {};
                return {
                    id: c.clinicId,
                    name: details.clinic_name || 'Unknown Clinic',
                    email: details.email || '-',
                    logoUrl: details.logo_url || null,
                    totalSize: formatBytes(c.totalSize),
                    reportSize: formatBytes(c.reportSize),
                    fileSize: formatBytes(c.fileSize),
                    reportCount: c.reportCount,
                    fileCount: c.fileCount,
                    rawTotalSize: c.totalSize
                };
            });

        res.json({
            totalSize: formatBytes(totalSizeBytes),
            totalSizeGB: (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2),
            totalFiles,
            buckets: bucketStats,
            clinicUsage
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

export const downloadFile = async (req, res) => {
    try {
        const { bucketName } = req.params;
        const { filePath } = req.query;

        if (!bucketName || !filePath) {
            return res.status(400).json({ error: 'Bucket name and file path are required' });
        }

        const { data, error } = await supabaseAdmin
            .storage
            .from(bucketName)
            .download(filePath);

        if (error) {
            console.error('Error downloading file:', error);
            return res.status(500).json({ error: 'Failed to download file' });
        }

        // data is a Blob (in browser-like env) or ArrayBuffer/Buffer depending on supabase-js version in Node.
        // In Node, supabase-js v2 usually returns a Blob. We need to convert to ArrayBuffer -> Buffer.
        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filePath.split('/').pop()}"`);
        res.send(buffer);

    } catch (error) {
        console.error('downloadFile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteFile = async (req, res) => {
    try {
        const { bucketName } = req.params;
        const { filePath } = req.body;

        if (!bucketName || !filePath) {
            return res.status(400).json({ error: 'Bucket name and file path are required' });
        }

        const { data, error } = await supabaseAdmin
            .storage
            .from(bucketName)
            .remove([filePath]);

        if (error) {
            console.error('Error deleting file:', error);
            return res.status(500).json({ error: 'Failed to delete file' });
        }

        res.json({ message: 'File deleted successfully', data });

    } catch (error) {
        console.error('deleteFile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const uploadFile = async (req, res) => {
    try {
        const { bucketName } = req.params;
        const file = req.file;
        const { path } = req.body; // Optional folder path

        if (!bucketName || !file) {
            return res.status(400).json({ error: 'Bucket name and file are required' });
        }

        // Construct full path
        // path might be "folder/" or "folder/subfolder/"
        // file.originalname is the file name
        // Supabase expects "folder/filename.ext" or just "filename.ext"
        const filePath = path ? `${path}${file.originalname}` : file.originalname;

        const { data, error } = await supabaseAdmin
            .storage
            .from(bucketName)
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (error) {
            console.error('Error uploading file:', error);
            return res.status(500).json({ error: 'Failed to upload file' });
        }

        res.json({ message: 'File uploaded successfully', data });

    } catch (error) {
        console.error('uploadFile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createBucket = async (req, res) => {
    try {
        const { name, public: isPublic } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Bucket name is required' });
        }

        // Validate name format (only lowercase, numbers, dashes)
        const nameRegex = /^[a-z0-9-]+$/;
        if (!nameRegex.test(name)) {
            return res.status(400).json({ error: 'Bucket name must only contain lowercase letters, numbers, and dashes.' });
        }

        const { data, error } = await supabaseAdmin
            .storage
            .createBucket(name, {
                public: isPublic,
                fileSizeLimit: null, // Optional: set limit
                allowedMimeTypes: null // Optional: restriction
            });

        if (error) {
            console.error('Error creating bucket:', error);
            // Handle specific error codes if needed (e.g. duplicate)
            return res.status(500).json({ error: error.message || 'Failed to create bucket' });
        }

        res.json({ message: 'Bucket created successfully', data });

    } catch (error) {
        console.error('createBucket error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteBucket = async (req, res) => {
    try {
        const { bucketName } = req.params;
        if (!bucketName) {
            return res.status(400).json({ error: 'Bucket name is required' });
        }

        const { data, error } = await supabaseAdmin
            .storage
            .deleteBucket(bucketName);

        if (error) {
            console.error('Error deleting bucket:', error);
            return res.status(500).json({ error: error.message || 'Failed to delete bucket' });
        }

        res.json({ message: 'Bucket deleted successfully', data });
    } catch (error) {
        console.error('deleteBucket error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const emptyBucket = async (req, res) => {
    try {
        const { bucketName } = req.params;
        if (!bucketName) {
            return res.status(400).json({ error: 'Bucket name is required' });
        }

        const { data, error } = await supabaseAdmin
            .storage
            .emptyBucket(bucketName);

        if (error) {
            console.error('Error emptying bucket:', error);
            return res.status(500).json({ error: error.message || 'Failed to empty bucket' });
        }

        res.json({ message: 'Bucket emptied successfully', data });
    } catch (error) {
        console.error('emptyBucket error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
