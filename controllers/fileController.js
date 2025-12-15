import { supabaseAdmin } from '../supabaseClient.js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 1024, // 1GB max file size
    }
});

// Middleware for file upload
export const uploadMiddleware = upload.single('file');

// Generate signed URL for direct upload from frontend
export const generateUploadUrl = async (req, res) => {
    console.log('\n🔑 ========== GENERATING UPLOAD URL ==========');

    const userId = req.user?.id;
    const { patient_id, clinic_id, file_name, file_type } = req.body;

    console.log('📋 Request Info:');
    console.log('   User ID:', userId);
    console.log('   Clinic ID:', clinic_id);
    console.log('   Patient ID:', patient_id || 'N/A');
    console.log('   File Name:', file_name);
    console.log('   File Type:', file_type);

    // Validate required fields
    if (!clinic_id || !file_name || !file_type) {
        console.log('❌ Missing required fields');
        return res.status(400).json({ error: 'Clinic ID, file name, and file type are required' });
    }

    try {
        console.log('\n🔐 Step 1: Checking user membership...');
        // 1. Check if user is a member of this clinic
        const { data: userMembership, error: membershipError } = await supabaseAdmin
            .from('user_clinic_roles')
            .select('role')
            .eq('user_id', userId)
            .eq('clinic_id', clinic_id)
            .maybeSingle();

        if (membershipError) {
            console.error('❌ Membership check error:', membershipError);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!userMembership) {
            console.log('❌ User is not a member of this clinic');
            return res.status(403).json({
                error: 'You must be a member of this clinic to upload files'
            });
        }

        console.log('✅ User membership confirmed. Role:', userMembership.role);

        // 2. If patient_id is provided, verify patient belongs to this clinic
        if (patient_id) {
            console.log('\n🏥 Step 2: Verifying patient in clinic...');
            const { data: patient, error: patientError } = await supabaseAdmin
                .from('patients')
                .select('id')
                .eq('id', patient_id)
                .eq('clinic_id', clinic_id)
                .maybeSingle();

            if (patientError || !patient) {
                console.log('❌ Patient not found in clinic');
                return res.status(404).json({ error: 'Patient not found in this clinic' });
            }
            console.log('✅ Patient verified');
        }

        // 3. Generate file path and ID
        console.log('\n📂 Step 3: Generating file path...');
        const fileId = uuidv4();
        const fileExtension = file_name.split('.').pop();
        const bucketName = 'files';

        // Build storage path
        let filePath;
        if (patient_id) {
            filePath = `${clinic_id}/${patient_id}/${fileId}.${fileExtension}`;
        } else {
            filePath = `${clinic_id}/${fileId}.${fileExtension}`;
        }

        console.log('   File ID:', fileId);
        console.log('   Bucket:', bucketName);
        console.log('   Path:', filePath);

        // 4. Create signed URL for upload (valid for 1 hour)
        console.log('\n🔗 Step 4: Creating signed upload URL...');
        const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
            .from(bucketName)
            .createSignedUploadUrl(filePath);

        if (signedUrlError) {
            console.error('❌ Signed URL creation error:', signedUrlError);
            return res.status(500).json({ error: 'Failed to create upload URL', details: signedUrlError });
        }

        console.log('✅ Signed URL created successfully');
        console.log('   Token:', signedUrlData.token);
        console.log('   URL:', signedUrlData.signedUrl);

        console.log('\n✅ ========== UPLOAD URL GENERATED ==========\n');

        // Return the signed URL and file info
        res.status(200).json({
            message: 'Upload URL generated successfully',
            uploadUrl: signedUrlData.signedUrl,
            token: signedUrlData.token,
            file: {
                id: fileId,
                file_path: filePath,
                bucket_name: bucketName,
                file_name: file_name,
                file_type: file_type,
                patient_id: patient_id || null,
                clinic_id: clinic_id
            }
        });

    } catch (err) {
        console.error('\n❌ ========== UNEXPECTED ERROR ==========');
        console.error(err);
        console.error('=========================================\n');
        res.status(500).json({ error: err.message });
    }
};

// Confirm upload and save metadata to database
export const confirmUpload = async (req, res) => {
    console.log('\n✅ ========== CONFIRMING UPLOAD ==========');

    const userId = req.user?.id;
    const {
        file_id,
        id, // Check for 'id' as well
        file_path,
        bucket_name,
        file_name,
        file_type,
        size, // Extract size
        patient_id,
        clinic_id,
        metadata
    } = req.body;

    // Resolve ID
    const resolvedFileId = file_id || id;

    console.log('📋 File Info:');
    console.log('   File ID:', resolvedFileId);
    console.log('   File Path:', file_path);
    console.log('   Bucket:', bucket_name);
    console.log('   Clinic ID:', clinic_id);
    console.log('   Size:', size);

    // Validate required fields
    if (!resolvedFileId || !file_path || !bucket_name || !clinic_id) {
        console.log('❌ Missing required fields');
        return res.status(400).json({ error: 'Missing required fields (file_id, file_path, bucket_name, clinic_id)' });
    }

    try {
        // 1. Verify file was actually uploaded to storage
        console.log('\n🔍 Step 1: Verifying file in storage...');
        const folderPath = file_path.substring(0, file_path.lastIndexOf('/'));
        const fileName = file_path.split('/').pop();

        const { data: filesInStorage, error: checkError } = await supabaseAdmin.storage
            .from(bucket_name)
            .list(folderPath, {
                search: fileName
            });

        if (checkError) {
            console.error('❌ Storage check error:', checkError);
            return res.status(500).json({ error: 'Failed to verify file in storage' });
        }

        // Find exact match (to avoid partial matches on similar filenames)
        const uploadedFile = filesInStorage?.find(f => f.name === fileName);

        if (!uploadedFile) {
            console.error('❌ File not found in storage');
            return res.status(404).json({ error: 'File not found in storage' });
        }

        console.log('✅ File exists in storage:', uploadedFile);

        // 2. Parse metadata if provided
        let parsedMetadata = {};
        if (metadata) {
            try {
                parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
                console.log('📝 Metadata parsed:', parsedMetadata);
            } catch (e) {
                console.error('⚠️  Metadata parse error:', e);
                parsedMetadata = {};
            }
        }

        // 🔒 Securely populate metadata from storage (Authoritative source)
        if (uploadedFile.metadata) {
            parsedMetadata.size = uploadedFile.metadata.size;
            parsedMetadata.mimetype = uploadedFile.metadata.mimetype;
            parsedMetadata.lastModified = uploadedFile.updated_at || uploadedFile.created_at;
        }

        // Fallback/Ensure type is set
        if (!parsedMetadata.type) {
            parsedMetadata.type = parsedMetadata.mimetype || file_type;
        }

        // Ensure size is handled if for some reason storage metadata was empty (unlikely)
        if (!parsedMetadata.size && size) {
            parsedMetadata.size = parseInt(size);
        }

        // 3. Save file metadata to database
        console.log('\n💾 Step 2: Saving metadata to database...');
        const insertData = {
            id: resolvedFileId,
            file_type: file_type,
            file_name: file_name,
            bucket_name: bucket_name,
            file_path: file_path,
            metadata: parsedMetadata,
            patient_id: patient_id || null,
            clinic_id: clinic_id
        };
        console.log('   Insert data:', insertData);

        const { data: fileRecord, error: dbError } = await supabaseAdmin
            .from('files')
            .insert([insertData])
            .select()
            .single();

        if (dbError) {
            console.error('❌ Database insert error:', dbError);
            return res.status(500).json({ error: 'Failed to save file metadata', details: dbError });
        }

        console.log('✅ File record saved to database');
        console.log('   Record ID:', fileRecord.id);

        // 4. Get public URL
        console.log('\n🔗 Step 3: Generating public URL...');
        const { data: publicUrlData } = supabaseAdmin.storage
            .from(bucket_name)
            .getPublicUrl(file_path);

        console.log('   Public URL:', publicUrlData?.publicUrl);
        console.log('\n✅ ========== UPLOAD CONFIRMED ==========\n');

        res.status(201).json({
            message: 'File upload confirmed successfully',
            file: {
                id: fileRecord.id,
                file_name: fileRecord.file_name,
                file_type: fileRecord.file_type,
                file_path: fileRecord.file_path,
                bucket_name: fileRecord.bucket_name,
                url: publicUrlData?.publicUrl || null,
                created_at: fileRecord.created_at,
                patient_id: fileRecord.patient_id,
                clinic_id: fileRecord.clinic_id,
                metadata: fileRecord.metadata
            }
        });

    } catch (err) {
        console.error('\n❌ ========== UNEXPECTED ERROR ==========');
        console.error(err);
        console.error('=========================================\n');
        res.status(500).json({ error: err.message });
    }
};

// Get files for a clinic or patient with pagination and search methods (POST for body params)
// Get all files for a clinic or patient (NO pagination by default, optional via params)
export const getFiles = async (req, res) => {
    const userId = req.user?.id;
    let { patient_id, clinic_id, search, page = 1, limit } = req.body;

    try {
        /* ==============================
           1️⃣ Resolve clinic_id from patient
        ============================== */
        if (patient_id && !clinic_id) {
            const { data: patient, error: patientError } = await supabaseAdmin
                .from('patients')
                .select('clinic_id')
                .eq('id', patient_id)
                .single();

            if (patientError || !patient) {
                return res.status(404).json({ error: 'Patient not found' });
            }

            clinic_id = patient.clinic_id;
        }

        if (!clinic_id) {
            return res.status(400).json({
                error: 'Clinic ID is required (or valid Patient ID)'
            });
        }

        /* ==============================
           2️⃣ Check user membership
        ============================== */
        const { data: userMembership, error: membershipError } = await supabaseAdmin
            .from('user_clinic_roles')
            .select('role')
            .eq('user_id', userId)
            .eq('clinic_id', clinic_id)
            .maybeSingle();

        if (membershipError) {
            console.error('Membership error:', membershipError);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!userMembership) {
            return res.status(403).json({
                error: 'You must be a member of this clinic'
            });
        }

        /* ==============================
           3️⃣ Build files query
        ============================== */
        /* ==============================
           3️⃣ Build files query
        ============================== */
        // Get total count first for pagination metadata
        let queryBuilder = supabaseAdmin
            .from('files')
            .select('*', { count: 'exact', head: false }) // Just build the query
            .eq('clinic_id', clinic_id);

        if (patient_id) {
            queryBuilder = queryBuilder.eq('patient_id', patient_id);
        }

        if (search) {
            queryBuilder = queryBuilder.ilike('file_name', `%${search}%`);
        }

        // --- Execute Query with optional pagination ---
        let query = supabaseAdmin
            .from('files')
            .select('*', { count: 'exact' })
            .eq('clinic_id', clinic_id);

        // Re-apply filters to actual query
        if (patient_id) query = query.eq('patient_id', patient_id);
        if (search) query = query.ilike('file_name', `%${search}%`);

        // Apply pagination ONLY if limit is provided and valid
        if (limit && parseInt(limit) > 0) {
            const from = (page - 1) * parseInt(limit);
            const to = from + parseInt(limit) - 1;
            query = query.range(from, to);
        }

        const { data: files, count, error: filesError } = await query
            .order('created_at', { ascending: false });

        if (filesError) {
            console.error('Files fetch error:', filesError);
            return res.status(500).json({ error: 'Failed to fetch files' });
        }

        /* ==============================
           4️⃣ Generate signed URLs
        ============================== */
        const MAX_FILE_SIZE = 1 * 1024 * 1024;
        const filesWithUrls = await Promise.all(
            files.map(async (file) => {

                // 🔹 الحجم من metadata (يلزم يكون مسجّل وقت الرفع)
                const fileSize = file.metadata?.size;

                // ❌ كان الحجم أكبر من 50MB
                if (fileSize && fileSize > MAX_FILE_SIZE) {
                    return {
                        ...file,
                        file_path: null,
                        url: null,
                        blocked: true,
                        reason: 'FILE_TOO_LARGE'
                    };
                }

                // ✅ حجم مقبول → نولّد Signed URL
                const { data, error } = await supabaseAdmin
                    .storage
                    .from(file.bucket_name)
                    .createSignedUrl(file.file_path, 60 * 60);

                if (error) {
                    console.error('Signed URL error:', error);
                    return {
                        ...file,
                        url: null
                    };
                }

                return {
                    ...file,
                    url: data.signedUrl,
                    blocked: false
                };
            })
        );

        /* ==============================
           5️⃣ Response
        ============================== */
        return res.json({
            message: 'Files retrieved successfully',
            count: count, // ✅ Top-level count exposed
            files: filesWithUrls,
            pagination: limit ? {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit))
            } : {
                total: count,
                page: 1,
                limit: count, // All items
                totalPages: 1
            }
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: err.message });
    }
};

// Delete file
export const deleteFile = async (req, res) => {
    console.log('\n🗑️ ========== DELETING FILE ==========');
    const userId = req.user?.id;
    // Extract parameters from body (as requested)
    const { fileId } = req.body;
    console.log('📋 Request Info:', req.body);
    console.log('   User ID:', userId);
    console.log('   File ID:', fileId);

    if (!fileId) {
        console.log('❌ File ID is required');
        return res.status(400).json({ error: 'File ID is required' });
    }

    try {
        // 1. Get file details
        console.log('\n🔍 Step 1: Getting file details...');
        const { data: file, error: fileError } = await supabaseAdmin
            .from('files')
            .select('*')
            .eq('id', fileId)
            .single();

        if (fileError || !file) {
            console.error('❌ File not found:', fileError);
            return res.status(404).json({ error: 'File not found' });
        }
        console.log('✅ File found:', file.file_name);
        console.log('   Bucket:', file.bucket_name);
        console.log('   Path:', file.file_path);

        // 2. Check if user is a member of the clinic
        console.log('\nabcd Step 2: Checking permissions...');

        const { data: userMembership, error: membershipError } = await supabaseAdmin
            .from('user_clinic_roles')
            .select('role')
            .eq('user_id', userId)
            .eq('clinic_id', file.clinic_id)
            .maybeSingle();

        if (membershipError) {
            console.error('Membership check error:', membershipError);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!userMembership) {
            console.log('❌ Permission denied');
            return res.status(403).json({
                error: 'You do not have permission to delete this file'
            });
        }
        console.log('✅ Permission granted');

        // 3. Delete file from storage
        console.log('\n🗑️ Step 3: Deleting from storage...');
        const { error: storageError } = await supabaseAdmin.storage
            .from(file.bucket_name)
            .remove([file.file_path]);

        if (storageError) {
            console.error('⚠️ Storage delete error (continuing...):', storageError);
        } else {
            console.log('✅ Deleted from storage');
        }

        // 4. Delete file record from database
        console.log('\n💾 Step 4: Deleting from database...');
        const { error: deleteError } = await supabaseAdmin
            .from('files')
            .delete()
            .eq('id', fileId);

        if (deleteError) {
            console.error('❌ Database delete error:', deleteError);
            return res.status(500).json({ error: 'Failed to delete file record' });
        }

        console.log('✅ File record deleted');
        console.log('\n✅ ========== FILE DELETED ==========\n');

        res.json({
            message: 'File deleted successfully',
            deletedFile: {
                id: fileId,
                name: file.file_name
            }
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: err.message });
    }
};
