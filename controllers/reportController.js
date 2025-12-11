import { supabaseUser,supabaseAdmin } from '../supabaseClient.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

// Flask API configuration
const FLASK_API_URL = 'http://localhost:5001'; // Update with your Flask server URL
const cbct_report_generated = `${FLASK_API_URL}/cbct-report-generated`;
const pano_report_generated = `${FLASK_API_URL}/pano-report-generated`;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'reports');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    
    // Handle .nii.gz files specially
    if (file.originalname.toLowerCase().endsWith('.nii.gz')) {
      cb(null, file.fieldname + '-' + uniqueSuffix + '.nii.gz');
    } else {
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 700 * 1024 * 1024 // 700MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('File filter checking:', file.originalname);
    console.log('File mimetype:', file.mimetype);
    
    // Allow medical imaging formats and common document formats
    const allowedTypes = /dcm|dicom|nii|gz|png|jpg|jpeg|tiff|tif|pdf|doc|docx|xls|xlsx|txt|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    
    // For .nii.gz files, check if the filename ends with .nii.gz
    const isNiiGz = file.originalname.toLowerCase().endsWith('.nii.gz');
    
    console.log('File extension:', path.extname(file.originalname).toLowerCase());
    console.log('Extname test result:', extname);
    console.log('Is NII.GZ:', isNiiGz);
    
    if (extname || isNiiGz) {
      console.log('File accepted:', file.originalname);
      return cb(null, true);
    } else {
      console.log('File rejected:', file.originalname);
      cb(new Error(`File type not allowed: ${file.originalname}. Only medical imaging files (.dcm, .dicom, .nii, .nii.gz, .png, .jpg, .jpeg, .tiff, .tif) and common document formats are allowed!`));
    }
  }
});

// Helper function to call Flask API for medical file processing
const callFlaskUploadAPI = async (filePath, clinicId, patientId, reportType, reportId) => {
  try {
    console.log('🔄 Calling Flask API for medical file processing...');
    console.log('📋 Parameters:', { clinicId, patientId, reportType, reportId });
    
    // Create FormData for multipart/form-data request
    const formData = new FormData();
    
    // Add the file
    const fileStream = fs.createReadStream(filePath);
    formData.append('file', fileStream, {
      filename: path.basename(filePath),
      contentType: 'application/octet-stream'
    });
    
    // Add required parameters
    formData.append('clinic_id', clinicId);
    formData.append('patient_id', patientId);
    formData.append('report_type', reportType.toLowerCase());
    formData.append('report_id', reportId);
    
    // Determine which Flask endpoint to use based on report type
    const flaskEndpoint = reportType.toLowerCase() === 'pano' ? pano_report_generated : cbct_report_generated;
    
    // Make request to Flask API
    const response = await fetch(flaskEndpoint, {
      method: 'POST',
      body: formData,
      headers: {
        ...formData.getHeaders()
      },
      timeout: 600000 // 10 minutes timeout for large files
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
      throw new Error(`Flask API error: ${responseData.error || response.statusText}`);
    }
    
    console.log('✅ Flask API call successful:', responseData);
    return {
      success: true,
      data: responseData,
      flask_processing: responseData.processing_result,
      supabase_upload: responseData.supabase_info
    };
    
  } catch (error) {
    console.error('❌ Flask API call failed:', error);
    return {
      success: false,
      error: error.message,
      details: error.stack
    };
  }
};

// Helper function to update report status with Flask processing results
const updateReportWithFlaskResults = async (reportId, flaskResults) => {
  try {
    let updateData = {};
    
    if (flaskResults.success) {
      updateData.status = 'completed';
      updateData.processing_info = {
        flask_success: true,
        processing_result: flaskResults.flask_processing,
        supabase_upload: flaskResults.supabase_upload,
        processed_at: new Date().toISOString()
      };
    } else {
      updateData.status = 'failed';
      updateData.processing_info = {
        flask_success: false,
        error: flaskResults.error,
        failed_at: new Date().toISOString()
      };
    }
    
    const { error } = await supabaseUser
      .from('report_ai')
      .update(updateData)
      .eq('report_id', reportId);
    
    if (error) {
      console.error('❌ Failed to update report with Flask results:', error);
    } else {
      console.log('✅ Report updated with Flask results');
    }
    
  } catch (error) {
    console.error('❌ Error updating report:', error);
  }
};

// ✅ Create AI Report with File Upload and Flask Integration
export const createReport = async (req, res) => {
  console.log('Creating report...');
  
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('File upload error:', err);
      console.error('Error details:', {
        code: err.code,
        field: err.field,
        message: err.message
      });
      return res.status(400).json({ 
        success: false,
        error: err.message,
        status: 'error',
        details: {
          code: err.code,
          field: err.field
        }
      });
    }

    const { 
      patient_id, 
      report_type, 
      status = 'pending'
    } = req.body;
    
    console.log('Report data:', req.body);
    console.log('Uploaded file:', req.file);
    
    const userId = req.user?.id;
    console.log('User ID:', userId);
    
    if (!patient_id) {
      return res.status(400).json({ 
        success: false,
        error: 'Patient ID is required',
        status: 'error'
      });
    }
    
    if (!report_type) {
      return res.status(400).json({ 
        success: false,
        error: 'Report type is required',
        status: 'error'
      });
    }

    try {
      // 1. Get patient to verify it exists and get clinic_id
      const { data: patient, error: patientError } = await supabaseUser
        .from('patients')
        .select('clinic_id')
        .eq('id', patient_id)
        .single();
        
      if (patientError) {
        console.error('Patient fetch error:', patientError);
        return res.status(404).json({ 
          success: false,
          error: 'Patient not found',
          status: 'error'
        });
      }

      const clinicId = patient.clinic_id;

      // 2. Check if user is a member of this clinic
      const { data: userMembership, error: membershipError } = await supabaseUser
        .from('user_clinic_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('clinic_id', clinicId)
        .maybeSingle();
        
      if (membershipError) {
        console.error('Membership check error:', membershipError);
        return res.status(500).json({ 
          success: false,
          error: 'Database error',
          status: 'error'
        });
      }

      if (!userMembership) {
        return res.status(403).json({ 
          success: false,
          error: 'You must be a member of this clinic to create reports',
          status: 'error'
        });
      }

      // 3. Create the AI report
      const { data: report, error: reportError } = await supabaseUser
        .from('report_ai')
        .insert({
          patient_id,
          raport_type: report_type,
          status: 'processing' // Set to processing initially
        })
        .select()
        .single();

      if (reportError) {
        console.error('Report creation error:', reportError);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to create report',
          status: 'error'
        });
      }

      console.log('Report created successfully:', report);
      
      // 4. Get patient details for response
      const { data: patientDetails, error: patientDetailsError } = await supabaseUser
        .from('patients')
        .select('first_name, last_name')
        .eq('id', patient_id)
        .single();

      if (patientDetailsError) {
        console.error('Patient details fetch error:', patientDetailsError);
      }

      // 5. Send immediate response to client
      const responseData = {
        success: true,
        message: 'AI Report created successfully',
        status: 'success',
        report: {
          id: report.report_id,
          created_at: report.created_at,
          last_upload: report.last_upload,
          raport_type: report.raport_type,
          patient_id: report.patient_id,
          status: report.status,
        },
        patient: {
          id: patient_id,
          name: patientDetails ? `${patientDetails.first_name} ${patientDetails.last_name}` : 'Unknown Patient'
        },
        userRole: userMembership.role,
        uploadedFile: req.file ? {
          filename: req.file.filename,
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        } : null,
        processing: {
          flask_api_called: false,
          message: 'File processing started in background'
        }
      };

      res.status(201).json(responseData);

      // 6. Process file in background using Flask API if file was uploaded
      if (req.file && isMedicalImagingFile(req.file.originalname)) {
        console.log('🚀 Starting background processing with Flask API...');
        
        // Call Flask API asynchronously
        setImmediate(async () => {
          try {
            const flaskResults = await callFlaskUploadAPI(
              req.file.path,
              clinicId,
              patient_id,
              report_type,
              report.report_id
            );
            
            // Update report with Flask results
            await updateReportWithFlaskResults(report.report_id, flaskResults);
            
            // Clean up local file after processing
            if (fs.existsSync(req.file.path)) {
              fs.unlinkSync(req.file.path);
              console.log('🗑️ Local file cleaned up:', req.file.path);
            }
            
          } catch (error) {
            console.error('❌ Background processing failed:', error);
            
            // Update report status to failed
            await updateReportWithFlaskResults(report.report_id, {
              success: false,
              error: error.message
            });
          }
        });
      } else {
        // For non-medical files, use the existing logic
        if (report.raport_type === 'cbct') {
          setTimeout(() => {
            try {
              generateCbctReport({ report_id: report.report_id, uploadedFile: req.file });
            } catch (err) {
              console.error('Error calling generateCbctReport:', err);
            }
          }, 0);
        } else if (report.raport_type === 'pano') {
          setTimeout(() => {
            try {
              generatePanoReport({ report_id: report.report_id, uploadedFile: req.file });
            } catch (err) {
              console.error('Error calling generatePanoReport:', err);
            }
          }, 0);
        } else if (report.raport_type === '3dmodel') {
          setTimeout(() => {
            try {
              generate3dModelReport({ report_id: report.report_id });
            } catch (err) {
              console.error('Error calling generate3dModelReport:', err);
            }
          }, 0);
        }
      }

    } catch (err) {
      console.error('Unexpected error:', err);
      res.status(500).json({ 
        success: false,
        error: err.message,
        status: 'error'
      });
    }
  });
};

// Helper function to check if file is a medical imaging file
const isMedicalImagingFile = (filename) => {
  const medicalExtensions = ['.nii', '.nii.gz', '.dcm', '.dicom', '.ima'];
  const lowerFilename = filename.toLowerCase();
  return medicalExtensions.some(ext => lowerFilename.endsWith(ext));
};

// Helper function to get Flask API status
export const getFlaskApiStatus = async (req, res) => {
  try {
    const response = await fetch(`${FLASK_API_URL}/slices-count`, {
      method: 'GET',
      timeout: 5000
    });
    
    if (response.ok) {
      const data = await response.json();
      res.json({
        success: true,
        flask_api_status: 'online',
        flask_url: FLASK_API_URL,
        data
      });
    } else {
      throw new Error(`Flask API returned ${response.status}`);
    }
  } catch (error) {
    res.status(503).json({
      success: false,
      flask_api_status: 'offline',
      flask_url: FLASK_API_URL,
      error: error.message
    });
  }
};

// Helper function to clear Flask cache
export const clearFlaskCache = async (req, res) => {
  try {
    const response = await fetch(`${FLASK_API_URL}/clear-cache`, {
      method: 'POST',
      timeout: 10000
    });
    
    const data = await response.json();
    
    if (response.ok) {
      res.json({
        success: true,
        message: 'Flask cache cleared successfully',
        data
      });
    } else {
      throw new Error(data.error || 'Failed to clear cache');
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ✅ Generate Pano Report with Flask API Integration
export const generatePanoReportWithFlask = async (req, res) => {
  console.log('🔄 Generating Pano Report with Flask API...');
  
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('File upload error:', err);
      return res.status(400).json({ 
        success: false,
        error: err.message,
        status: 'error'
      });
    }

    const { 
      patient_id, 
      report_id,
      clinic_id
    } = req.body;
    
    console.log('Pano report data:', req.body);
    console.log('Uploaded file:', req.file);
    
    const userId = req.user?.id;
    console.log('User ID:', userId);
    
    if (!patient_id) {
      return res.status(400).json({ 
        success: false,
        error: 'Patient ID is required',
        status: 'error'
      });
    }
    
    if (!report_id) {
      return res.status(400).json({ 
        success: false,
        error: 'Report ID is required',
        status: 'error'
      });
    }

    if (!clinic_id) {
      return res.status(400).json({ 
        success: false,
        error: 'Clinic ID is required',
        status: 'error'
      });
    }

    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'Image file is required (JPG or PNG)',
        status: 'error'
      });
    }

    // Check if file is JPG or PNG
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ 
        success: false,
        error: 'Only JPG and PNG image files are allowed',
        status: 'error'
      });
    }

    try {
      // 1. Check if user is a member of this clinic
      const { data: userMembership, error: membershipError } = await supabaseUser
        .from('user_clinic_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('clinic_id', clinic_id)
        .maybeSingle();
        
      if (membershipError) {
        console.error('Membership check error:', membershipError);
        return res.status(500).json({ 
          success: false,
          error: 'Database error',
          status: 'error'
        });
      }

      if (!userMembership) {
        return res.status(403).json({ 
          success: false,
          error: 'You must be a member of this clinic to generate pano reports',
          status: 'error'
        });
      }

      // 2. Verify report exists and is of type 'pano'
      const { data: report, error: reportError } = await supabaseUser
        .from('report_ai')
        .select('raport_type, status')
        .eq('report_id', report_id)
        .eq('patient_id', patient_id)
        .single();

      if (reportError || !report) {
        console.error('Report fetch error:', reportError);
        return res.status(404).json({ 
          success: false,
          error: 'Report not found',
          status: 'error'
        });
      }

      if (report.raport_type !== 'pano') {
        return res.status(400).json({ 
          success: false,
          error: 'Report must be of type "pano"',
          status: 'error'
        });
      }

      // 3. Update report status to processing
      const { error: updateError } = await supabaseUser
        .from('report_ai')
        .update({ 
          status: 'processing',
          last_upload: new Date().toISOString()
        })
        .eq('report_id', report_id);

      if (updateError) {
        console.error('Report status update error:', updateError);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to update report status',
          status: 'error'
        });
      }

      // 4. Send immediate response to client
      const responseData = {
        success: true,
        message: 'Pano report generation started',
        status: 'success',
        report: {
          id: report_id,
          patient_id,
          clinic_id,
          raport_type: 'pano',
          status: 'processing'
        },
        uploadedFile: {
          filename: req.file.filename,
          originalname: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        },
        processing: {
          flask_api_called: false,
          message: 'Image processing started in background'
        }
      };

      res.status(200).json(responseData);

      // 5. Process image in background using Flask API
      console.log('🚀 Starting background pano processing with Flask API...');
      
      setImmediate(async () => {
        try {
          const flaskResults = await callFlaskUploadAPI(
            req.file.path,
            clinic_id,
            patient_id,
            'pano',
            report_id
          );
          
          // Update report with Flask results
          await updateReportWithFlaskResults(report_id, flaskResults);
          
          // Clean up local file after processing
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log('🗑️ Local file cleaned up:', req.file.path);
          }
          
        } catch (error) {
          console.error('❌ Background pano processing failed:', error);
          
          // Update report status to failed
          await updateReportWithFlaskResults(report_id, {
            success: false,
            error: error.message
          });
        }
      });

    } catch (err) {
      console.error('Unexpected error:', err);
      res.status(500).json({ 
        success: false,
        error: err.message,
        status: 'error'
      });
    }
  });
};

// ✅ Delete AI Report (keeping original logic)
export const deleteReport = async (req, res) => {
  const { report_id } = req.body;
  const userId = req.user?.id;

  if (!report_id) {
    return res.status(400).json({ 
      success: false,
      error: 'Report ID is required',
      status: 'error'
    });
  }

  try {
    // 1. Get report to verify it exists and get patient_id
    const { data: report, error: reportError } = await supabaseUser
      .from('report_ai')
      .select('patient_id, raport_type')
      .eq('report_id', report_id)
      .single();

    if (reportError) {
      console.error('Report fetch error:', reportError);
      return res.status(404).json({ 
        success: false,
        error: 'Report not found',
        status: 'error'
      });
    }

    // 2. Get patient to get clinic_id
    const { data: patient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id')
      .eq('id', report.patient_id)
      .single();

    if (patientError) {
      console.error('Patient fetch error:', patientError);
      return res.status(404).json({ 
        success: false,
        error: 'Patient not found',
        status: 'error'
      });
    }

    const clinicId = patient.clinic_id;

    // 3. Check if user is a member of this clinic
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ 
        success: false,
        error: 'Database error',
        status: 'error'
      });
    }

    if (!userMembership) {
      return res.status(403).json({ 
        success: false,
        error: 'You must be a member of this clinic to delete reports',
        status: 'error'
      });
    }

    // 4. Delete the report from database
    const { error: deleteError } = await supabaseUser
      .from('report_ai')
      .delete()
      .eq('report_id', report_id);

    if (deleteError) {
      console.error('Report deletion error:', deleteError);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to delete report',
        status: 'error'
      });
    }

    // 5. Delete files from Supabase storage if they exist (Updated path structure)
    try {
      const folderPath = `${clinicId}/${report.patient_id}/${report.raport_type}/${report_id}`;
      const { data: files, error: listError } = await supabaseAdmin.storage
        .from('reports')
        .list(folderPath, {
          limit: 100,
          offset: 0
        });

      if (!listError && files && files.length > 0) {
        const filePaths = files.map(file => `${folderPath}/${file.name}`);
        const { error: deleteFilesError } = await supabaseAdmin.storage
          .from('reports')
          .remove(filePaths);
        
        if (deleteFilesError) {
          console.error('Storage files deletion error:', deleteFilesError);
        } else {
          console.log('Storage files deleted successfully');
        }
      }

      // Also try to delete from the 'slices' bucket if it exists (Flask API uploads)
      try {
        const slicesPath = `${clinicId}/${report.patient_id}/${report.raport_type}/${report_id}`;
        const { data: sliceFiles, error: sliceListError } = await supabaseAdmin.storage
          .from('slices')
          .list(slicesPath, {
            limit: 1000,
            offset: 0
          });

        if (!sliceListError && sliceFiles && sliceFiles.length > 0) {
          // Delete all views (axial, coronal, sagittal)
          const viewsToDelete = ['axial', 'coronal', 'sagittal'];
          for (const view of viewsToDelete) {
            const { data: viewFiles, error: viewListError } = await supabaseAdmin.storage
              .from('slices')
              .list(`${slicesPath}/${view}`, {
                limit: 1000,
                offset: 0
              });

            if (!viewListError && viewFiles && viewFiles.length > 0) {
              const viewFilePaths = viewFiles.map(file => `${slicesPath}/${view}/${file.name}`);
              const { error: deleteViewFilesError } = await supabaseAdmin.storage
                .from('slices')
                .remove(viewFilePaths);
              
              if (deleteViewFilesError) {
                console.error(`Slice files deletion error for ${view}:`, deleteViewFilesError);
              } else {
                console.log(`Slice files deleted successfully for ${view}`);
              }
            }
          }
        }
      } catch (sliceError) {
        console.error('Slice files deletion error:', sliceError);
      }

    } catch (fileError) {
      console.error('File deletion error:', fileError);
      // Don't fail the request if file deletion fails
    }

    res.json({
      success: true,
      message: 'Report deleted successfully',
      status: 'success',
      deletedReportId: report_id
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ 
      success: false,
      error: err.message,
      status: 'error'
    });
  }
}; 

// ✅ Update Report Status with WebSocket Notification (keeping original logic)
export const updateReportStatus = async (req, res) => {
  const { report_id, new_status } = req.body;
  const userId = req.user?.id;

  if (!report_id) {
    return res.status(400).json({ 
      success: false,
      error: 'Report ID is required',
      status: 'error'
    });
  }

  if (!new_status) {
    return res.status(400).json({ 
      success: false,
      error: 'New status is required',
      status: 'error'
    });
  }

  // Validate status values
  const validStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
  if (!validStatuses.includes(new_status)) {
    return res.status(400).json({ 
      success: false,
      error: `Invalid status. Valid statuses are: ${validStatuses.join(', ')}`,
      status: 'error'
    });
  }

  try {
    // 1. Get current report to check status and get patient info
    const { data: currentReport, error: reportError } = await supabaseUser
      .from('report_ai')
      .select('status, patient_id')
      .eq('report_id', report_id)
      .single();

    if (reportError) {
      console.error('Report fetch error:', reportError);
      return res.status(404).json({ 
        success: false,
        error: 'Report not found',
        status: 'error'
      });
    }

    // Check if status is actually changing
    if (currentReport.status === new_status) {
      return res.status(400).json({ 
        success: false,
        error: 'Report status is already set to this value',
        status: 'error'
      });
    }

    // 2. Get patient to get clinic_id
    const { data: patient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id, first_name, last_name')
      .eq('id', currentReport.patient_id)
      .single();

    if (patientError) {
      console.error('Patient fetch error:', patientError);
      return res.status(404).json({ 
        success: false,
        error: 'Patient not found',
        status: 'error'
      });
    }

    const clinicId = patient.clinic_id;

    // 3. Check if user is a member of this clinic
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ 
        success: false,
        error: 'Database error',
        status: 'error'
      });
    }

    if (!userMembership) {
      return res.status(403).json({ 
        success: false,
        error: 'You must be a member of this clinic to update reports',
        status: 'error'
      });
    }

    // 4. Update the report status
    const { data: updatedReport, error: updateError } = await supabaseUser
      .from('report_ai')
      .update({ 
        status: new_status,
        last_upload: new Date().toISOString()
      })
      .eq('report_id', report_id)
      .select()
      .single();

    if (updateError) {
      console.error('Report status update error:', updateError);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to update report status',
        status: 'error'
      });
    }

    res.json({
      success: true,
      message: 'Report status updated successfully',
      status: 'success',
      report: {
        id: updatedReport.report_id,
        status: updatedReport.status,
        last_upload: updatedReport.last_upload
      },
      statusChange: {
        from: currentReport.status,
        to: new_status
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ 
      success: false,
      error: err.message,
      status: 'error'
    });
  }
};

// ✅ Get AI Report Data (keeping original logic)
export const getReportData = async (req, res) => {
  const { report_id } = req.query;
  const userId = req.user?.id;

  if (!report_id) {
    return res.status(400).json({
      success: false,
      error: 'Report ID is required',
      status: 'error'
    });
  }

  try {
    // جلب بيانات التقرير كاملة
    const { data: report, error: reportError } = await supabaseUser
      .from('report_ai')
      .select('*, patient_id')
      .eq('report_id', report_id)
      .single();
    if (reportError || !report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
        status: 'error'
      });
    }
    // جلب العيادة من المريض
    const { data: patient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id')
      .eq('id', report.patient_id)
      .single();
    if (patientError || !patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found',
        status: 'error'
      });
    }
    const clinicId = patient.clinic_id;
    // التحقق من عضوية المستخدم في العيادة
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (membershipError) {
      return res.status(500).json({
        success: false,
        error: 'Database error',
        status: 'error'
      });
    }
    if (!userMembership) {
      return res.status(403).json({
        success: false,
        error: 'You must be a member of this clinic to view this report',
        status: 'error'
      });
    }
    
    // Generate URLs dynamically based on report type and ID (Updated path structure)
    const { report_url, data_url } = generateReportUrls(clinicId, report.patient_id, report.raport_type, report.report_id);
    
    // Add the generated URLs to the report object
    const reportWithUrls = {
      ...report,
      report_url,
      data_url
    };
    
    // إذا كان المستخدم عضو، أرجع بيانات التقرير
    res.json({
      success: true,
      status: 'success',
      report: reportWithUrls
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      status: 'error'
    });
  }
};

// Helper function to fetch JSON data from URL
const fetchJsonFromUrl = async (url) => {
  try {
    console.log('🌐 Fetching JSON from URL:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      // Add timeout
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('⚠️ Response is not JSON format:', contentType);
    }

    const jsonData = await response.json();
    console.log('✅ Successfully fetched JSON data');
    return jsonData;
    
  } catch (error) {
    console.error('💥 Failed to fetch JSON from URL:', error);
    throw new Error(`Failed to fetch data from URL: ${error.message}`);
  }
};

// Helper function to generate URLs based on clinic_id, patient_id, report type and ID (Updated path structure)
const generateReportUrls = (clinicId, patientId, reportType, reportId) => {
  const baseUrl = `https://ocsfmpiciulmcrejifwo.supabase.co/storage/v1/object/public/reports`;
  const data_url = `${baseUrl}/${clinicId}/${patientId}/${reportType}/${reportId}/`;
  let report_url = `${data_url}report.json`;
  return { report_url, data_url };
};

// ✅ Get AI Report Data (POST version) - Enhanced with JSON fetching (keeping original logic)
export const getReportDataPost = async (req, res) => {
  console.log('Fetching report data for POST request...-------------------------------');
  const { report_id, include_json_data = true } = req.body; // Add option to include JSON data

  if (!report_id) {
    return res.status(400).json({
      success: false,
      error: 'Report ID is required',
      status: 'error'
    });
  }

  try {
    // 1️⃣ Get report from database
    console.log('🔍 Fetching report from database...', report_id);
    const { data: report, error: reportError } = await supabaseUser
      .from('report_ai')
      .select('*')
      .eq('report_id', report_id)
      .single();

    if (reportError || !report) {
      console.error('❌ Report not found:', reportError?.message);
      return res.status(404).json({
        success: false,
        error: 'Report not found',
        status: 'error',
        details: reportError?.message
      });
    }

    console.log('✅ Report found:', report.report_id);

    // 2️⃣ Get patient info for clinic_id
    console.log('🔍 Fetching patient info...', report.patient_id);
    const { data: patient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id')
      .eq('id', report.patient_id)
      .single();

    if (patientError || !patient) {
      console.error('❌ Patient not found:', patientError?.message);
      return res.status(404).json({
        success: false,
        error: 'Patient not found',
        status: 'error',
        details: patientError?.message
      });
    }

    console.log('✅ Patient found, clinic_id:', patient.clinic_id);

    const clinicId = patient.clinic_id;

    // 3️⃣ Generate URLs dynamically (Updated path structure)
    const { report_url, data_url } = generateReportUrls(
      clinicId, 
      report.patient_id, 
      report.raport_type, 
      report.report_id
    );

    console.log('🔗 Generated URLs:', { report_url, data_url });

    // 4️⃣ Prepare base response with report data and URLs
    const reportWithUrls = {
      ...report,
      report_url,
      data_url,
      _meta: {
        fetched_at: new Date().toISOString(),
        clinic_id: clinicId,
        json_data_included: include_json_data
      }
    };

    // 5️⃣ If requested, fetch JSON data from report_url
    let jsonData = null;
    let jsonError = null;

    if (include_json_data) {
      try {
        console.log('📥 Attempting to fetch JSON data from report_url...');
        jsonData = await fetchJsonFromUrl(report_url);
        console.log('✅ JSON data fetched successfully');
        
        // Add some metadata about the fetched data
        reportWithUrls._meta.json_fetch_success = true;
        reportWithUrls._meta.json_data_size = JSON.stringify(jsonData).length;
        
      } catch (fetchError) {
        console.warn('⚠️ Failed to fetch JSON data (continuing without it):', fetchError.message);
        jsonError = fetchError.message;
        
        reportWithUrls._meta.json_fetch_success = false;
        reportWithUrls._meta.json_fetch_error = fetchError.message;
      }
    }

    // 6️⃣ Prepare final response
    const finalResponse = {
      success: true,
      status: 'success',
      report: reportWithUrls,
      // Include JSON data if successfully fetched
      ...(jsonData && { report_data: jsonData }),
      // Include error info if JSON fetch failed but continue with basic data
      ...(jsonError && { 
        json_fetch_warning: `Could not fetch JSON data: ${jsonError}`,
        json_available_at: report_url 
      })
    };

    console.log('✅ Sending response:', {
      has_report: !!finalResponse.report,
      has_json_data: !!finalResponse.report_data,
      json_error: !!jsonError
    });

    res.json(finalResponse);

  } catch (err) {
    console.error('💥 Unexpected error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      status: 'error',
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

// 🆕 Alternative version: Always fetch JSON data (simpler)
export const getReportDataWithJsonPost = async (req, res) => {
  console.log('Fetching report data WITH JSON for POST request...-------------------------------');
  const { report_id } = req.body;

  if (!report_id) {
    return res.status(400).json({
      success: false,
      error: 'Report ID is required',
      status: 'error'
    });
  }

  try {
    // Get report from database
    const { data: report, error: reportError } = await supabaseUser
      .from('report_ai')
      .select('*')
      .eq('report_id', report_id)
      .single();

    if (reportError || !report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
        status: 'error'
      });
    }

    // Get patient info
    const { data: patient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id')
      .eq('id', report.patient_id)
      .single();

    if (patientError || !patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found',
        status: 'error'
      });
    }

    // Generate URLs (Updated path structure)
    const { report_url, data_url } = generateReportUrls(
      patient.clinic_id, 
      report.patient_id, 
      report.raport_type, 
      report.report_id
    );

    // Add signed pano image URL if type is pano
    let pano_image_url = null;
    if (report.raport_type === 'pano') {
      const { data, error } = await supabaseAdmin
        .storage
        .from('reports')
        .createSignedUrl(`${patient.clinic_id}/${report.patient_id}/pano/${report.report_id}/original.png`, 60 * 1); 
        // 1 hour
        console.log('pano_image_url-----------------------------:', data?.signedUrl, error);
      pano_image_url = data?.signedUrl || null;
    }

    // Add signed cbct image URL if type is cbct
    let cbct_image_url = null;
    console.log(report.raport_type,'report.raport_type')
    if (report.raport_type === 'cbct') {
      console.log('CBCT Image URL-----------------------------:', `${patient.clinic_id}/${report.patient_id}/cbct/${report.report_id}/original.png`);
      const { data, error } = await supabaseAdmin
        .storage
        .from('reports')
        .createSignedUrl(`${patient.clinic_id}/${report.patient_id}/cbct/${report.report_id}/original.png`, 60 * 1); // 1 hour
      
      console.log("data",data)
      cbct_image_url = data?.signedUrl || null;
      console.log('CBCT Image URL-----------------------------:', cbct_image_url, error);
    }

    try {
      // Fetch JSON data
      console.log('📥 Fetching JSON data from:', report_url);
      const jsonData = await fetchJsonFromUrl(report_url);

      // Return combined data
      console.log('pano_image_urlpano_image_urlpano_image_url Data-----------------------------:', pano_image_url, cbct_image_url);
      res.json({
        success: true,
        status: 'success',
        report: {
          ...report,
          report_url,
          data_url,
          ...(pano_image_url && { pano_image_url }),
          ...(cbct_image_url && { cbct_image_url })
        },


        
        data: jsonData, // Main JSON data
        _meta: {
          metadata:report.metadata,
          fetched_at: new Date().toISOString(),
          clinic_id: patient.clinic_id,
          data_source: report_url
        }
      });

    } catch (fetchError) {
      // If JSON fetch fails, return report info with error
      console.error('💥 JSON fetch failed:', fetchError.message);
      
      res.status(206).yreza({ // 206 Partial Content
        success: true,
        status: 'partial_success',
        report: {
          ...report,
          report_url,
          data_url,
          ...(pano_image_url && { pano_image_url }),
          ...(cbct_image_url && { cbct_image_url })
        },
        data: null,
        error: `Could not fetch JSON data: ${fetchError.message}`,
        _meta: {
          metadata:report.metadata,
          fetched_at: new Date().toISOString(),
          clinic_id: patient.clinic_id,
          data_source: report_url,
          fetch_failed: true
        }
      });
    }

  } catch (err) {
    console.error('💥 Server error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      status: 'error',
      details: err.message
    });
  }
};

// 🔧 Utility function for testing URL accessibility
export const testReportUrl = async (req, res) => {
  const { report_id } = req.body;
  
  if (!report_id) {
    return res.status(400).json({ error: 'Report ID is required' });
  }

  try {
    // Get report and patient info (same logic as above)
    const { data: report } = await supabaseUser
      .from('report_ai')
      .select('*')
      .eq('report_id', report_id)
      .single();

    const { data: patient } = await supabaseUser
      .from('patients')
      .select('clinic_id')
      .eq('id', report.patient_id)
      .single();

    const { report_url } = generateReportUrls(
      patient.clinic_id, 
      report.patient_id, 
      report.raport_type, 
      report.report_id
    );

    // Test URL accessibility
    try {
      const response = await fetch(report_url, { method: 'HEAD' });
      res.json({
        url: report_url,
        accessible: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries())
      });
    } catch (error) {
      res.json({
        url: report_url,
        accessible: false,
        error: error.message
      });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Updated legacy functions to maintain compatibility (keeping original logic but with updated paths)
export async function generateCbctReport(report_id) {
  // لازم نجيب patient_id و clinic_id من الداتا
  const { data: reportData } = await supabaseUser
    .from('report_ai')
    .select('patient_id')
    .eq('report_id', report_id.report_id)
    .single();
  const { data: patient } = await supabaseUser
    .from('patients')
    .select('clinic_id')
    .eq('id', reportData.patient_id)
    .single();
  
  // Updated path structure: clinic_id/patient_id/report_type/report_id
  const basePath = `${patient.clinic_id}/${reportData.patient_id}/cbct/${report_id.report_id}`;
  const views = ['axial', 'sagittal', 'coronal'];

  for (const view of views) {
    const folderPath = `${basePath}/${view}/.init`; // Supabase needs a file to create the folder
    const { error } = await supabaseAdmin.storage
      .from('reports')
      .upload(folderPath, new Blob(['Init']), {
        contentType: 'text/plain',
        upsert: false,
      });
    if (error && !error.message.includes('The resource already exists')) {
      console.error(`❌ Failed to create ${view} folder:`, error);
      return { success: false, error };
    } else {
      console.log(`✅ Created ${view} folder in ${basePath}`);
    }
  }

  // ✅ Upload actual cbct image from client if provided
  if (report_id.uploadedFile) {
    try {
      const cbctImagePath = `${basePath}/cbct.jpg`;
      const fileBuffer = fs.readFileSync(report_id.uploadedFile.path);
      const { error: cbctImageError } = await supabaseAdmin.storage
        .from('reports')
        .upload(cbctImagePath, fileBuffer, {
          contentType: report_id.uploadedFile.mimetype || 'image/jpeg',
          upsert: false,
        });
      if (cbctImageError && !cbctImageError.message.includes('The resource already exists')) {
        console.error(`❌ Failed to upload cbct image:`, cbctImageError);
        return { success: false, error: cbctImageError };
      } else {
        console.log(`✅ Uploaded cbct image from client to Supabase:`, cbctImagePath);
      }
    } catch (err) {
      console.error('Error uploading cbct image:', err);
      return { success: false, error: err };
    }
  }

  // اختيار ملف عشوائي من مجلد data ورفعه كـ reportData.json
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) throw new Error('No JSON files found in /data');
    const randomFile = files[Math.floor(Math.random() * files.length)];
    const randomFilePath = path.join(dataDir, randomFile);
    const fileContent = fs.readFileSync(randomFilePath);
    const reportDataPath = `${basePath}/reportData.json`;
    const { error: reportDataError } = await supabaseAdmin.storage
      .from('reports')
      .upload(reportDataPath, new Blob([fileContent]), {
        contentType: 'application/json',
        upsert: false,
      });
    if (reportDataError && !reportDataError.message.includes('The resource already exists')) {
      console.error(`❌ Failed to create reportData.json:`, reportDataError);
      return { success: false, error: reportDataError };
    } else {
      console.log(`✅ Created reportData.json in ${basePath} from random file: ${randomFile}`);
    }
  } catch (err) {
    console.error('Error selecting/uploading random report data:', err);
    return { success: false, error: err };
  }

  return { success: true }
}

export async function generatePanoReport(report_id) {
  const { data: reportData } = await supabaseUser
    .from('report_ai')
    .select('patient_id')
    .eq('report_id', report_id.report_id)
    .single();
  const { data: patient } = await supabaseUser
    .from('patients')
    .select('clinic_id')
    .eq('id', reportData.patient_id)
    .single();
  
  // Updated path structure: clinic_id/patient_id/report_type/report_id
  const basePath = `${patient.clinic_id}/${reportData.patient_id}/pano/${report_id.report_id}`;

  // ✅ Upload actual pano image from client if provided
  if (report_id.uploadedFile) {
    try {
      const panoPath = `${basePath}/pano.jpg`;
      const fileBuffer = fs.readFileSync(report_id.uploadedFile.path);
      const { error: panoError } = await supabaseAdmin.storage
        .from('reports')
        .upload(panoPath, fileBuffer, {
          contentType: report_id.uploadedFile.mimetype || 'image/jpeg',
          upsert: false,
        });
      if (panoError && !panoError.message.includes('The resource already exists')) {
        console.error(`❌ Failed to upload pano image:`, panoError);
        return { success: false, error: panoError };
      } else {
        console.log(`✅ Uploaded pano image from client to Supabase:`, panoPath);
      }
    } catch (err) {
      console.error('Error uploading pano image:', err);
      return { success: false, error: err };
    }
  }

  // اختيار ملف عشوائي من مجلد data ورفعه كـ reportData.json
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) throw new Error('No JSON files found in /data');
    const randomFile = files[Math.floor(Math.random() * files.length)];
    const randomFilePath = path.join(dataDir, randomFile);
    const fileContent = fs.readFileSync(randomFilePath);
    const reportDataPath = `${basePath}/reportData.json`;
    const { error: reportDataError } = await supabaseAdmin.storage
      .from('reports')
      .upload(reportDataPath, new Blob([fileContent]), {
        contentType: 'application/json',
        upsert: false,
      });
    if (reportDataError && !reportDataError.message.includes('The resource already exists')) {
      console.error(`❌ Failed to create reportData.json:`, reportDataError);
      return { success: false, error: reportDataError };
    } else {
      console.log(`✅ Created reportData.json in ${basePath} from random file: ${randomFile}`);
    }
  } catch (err) {
    console.error('Error selecting/uploading random report data:', err);
    return { success: false, error: err };
  }

  return { success: true };
}

export async function generate3dModelReport(report_id) {
  const { data: reportData } = await supabaseUser
    .from('report_ai')
    .select('patient_id')
    .eq('report_id', report_id.report_id)
    .single();
  const { data: patient } = await supabaseUser
    .from('patients')
    .select('clinic_id')
    .eq('id', reportData.patient_id)
    .single();
  
  // Updated path structure: clinic_id/patient_id/report_type/report_id
  const basePath = `${patient.clinic_id}/${reportData.patient_id}/3dmodel/${report_id.report_id}`;
  
  // أنشئ ملفات وهمية frame_0.jpg, frame_1.jpg
  const framePaths = [
    `${basePath}/frame_0.jpg`,
    `${basePath}/frame_1.jpg`
  ];
  for (const framePath of framePaths) {
    const { error } = await supabaseAdmin.storage
      .from('reports')
      .upload(framePath, new Blob(['Init']), {
        contentType: 'image/jpeg',
        upsert: false,
      });
    if (error && !error.message.includes('The resource already exists')) {
      console.error(`❌ Failed to create file:`, framePath, error);
      return { success: false, error };
    } else {
      console.log(`✅ Created file in ${basePath}: ${framePath}`);
    }
  }

  // اختيار ملف عشوائي من مجلد data ورفعه كـ reportData.json
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) throw new Error('No JSON files found in /data');
    const randomFile = files[Math.floor(Math.random() * files.length)];
    const randomFilePath = path.join(dataDir, randomFile);
    const fileContent = fs.readFileSync(randomFilePath);
    const reportDataPath = `${basePath}/reportData.json`;
    const { error: reportDataError } = await supabaseAdmin.storage
      .from('reports')
      .upload(reportDataPath, new Blob([fileContent]), {
        contentType: 'application/json',
        upsert: false,
      });
    if (reportDataError && !reportDataError.message.includes('The resource already exists')) {
      console.error(`❌ Failed to create reportData.json:`, reportDataError);
      return { success: false, error: reportDataError };
    } else {
      console.log(`✅ Created reportData.json in ${basePath} from random file: ${randomFile}`);
    }
  } catch (err) {
    console.error('Error selecting/uploading random report data:', err);
    return { success: false, error: err };
  }

  return { success: true };
}// ✅ Update Report Data JSON in Storage
export const updateReportData = async (req, res) => {
  console.log(' 👌👌👌👌👌👌👌👌👌Updating report data...');
    const { report_id, report_data } = req.body;
    const userId = req.user?.id;

    if (!report_id) {
        return res.status(400).json({
            success: false, 
            message: 'Report ID is required',
            error: 'Report ID is required',
            status: 'error'
        });
    }

    if (!report_data) {
        return res.status(400).json({
            success: false, 
            message: 'Report data is required',
            error: 'Report data is required',
            status: 'error'
        });
    }

    try {
        // 1. Get report to verify it exists and get patient_id and report type
        const { data: report, error: reportError } = await supabaseUser
            .from('report_ai')
            .select('patient_id, raport_type')
            .eq('report_id', report_id)
            .single();

        if (reportError || !report) {
            console.error('Report fetch error:', reportError);
            return res.status(404).json({
                success: false,
                message: 'Report not found',
                error: 'Report not found',
                status: 'error'
            });
        }

        // 2. Get patient to get clinic_id
        const { data: patient, error: patientError } = await supabaseUser
            .from('patients')
            .select('clinic_id')
            .eq('id', report.patient_id)
            .single();

        if (patientError || !patient) {
            console.error('Patient fetch error:', patientError);
            return res.status(404).json({
                success: false,
                message: 'Patient not found',
                error: 'Patient not found',
                status: 'error'
            });
        }

        const clinicId = patient.clinic_id;

        // 3. Check if user is a member of this clinic
        const { data: userMembership, error: membershipError } = await supabaseUser
            .from('user_clinic_roles')
            .select('role')
            .eq('user_id', userId)
            .eq('clinic_id', clinicId)
            .maybeSingle();

        if (membershipError) {
            console.error('Membership check error:', membershipError);
            return res.status(500).json({
                success: false,
                message: 'Database error',
                error: 'Database error',
                status: 'error'
            });
        }

        if (!userMembership) {
          
            return res.status(403).json({
                success: false,
                message: 'You must be a member of this clinic to update reports',
                error: 'You must be a member of this clinic to update reports',
                status: 'error'
            });
        }

        // 4. Upload/Update the report.json file in Supabase storage
        const reportPath = `${clinicId}/${report.patient_id}/${report.raport_type}/${report_id}/report.json`;

        console.log('📤 Uploading report data to storage:', reportPath);

        // Convert report_data to JSON string
        console.log('Report data: ************* ', report_data);
        const jsonContent = JSON.stringify(report_data, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('reports')
            .upload(reportPath, blob, {
                contentType: 'application/json',
                upsert: true // This will overwrite if the file already exists
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return res.status(500).json({
                success: false,
                error: 'Failed to upload report data to storage',
                status: 'error',
                details: uploadError.message
            });
        }

        console.log('✅ Report data uploaded successfully:', uploadData);

        // 5. Update the report's last_upload timestamp
        const { error: updateError } = await supabaseUser
            .from('report_ai')
            .update({
                last_upload: new Date().toISOString()
            })
            .eq('report_id', report_id);

        if (updateError) {
            console.error('Report timestamp update error:', updateError);
            // Don't fail the request if timestamp update fails
        }

        // 6. Generate the public URL for the uploaded file
        const { data: publicUrlData } = supabaseAdmin.storage
            .from('reports')
            .getPublicUrl(reportPath);

        res.json({
            success: true,
            message: 'Report data updated successfully',
            status: 'success',
            report: {
                id: report_id,
                patient_id: report.patient_id,
                clinic_id: clinicId,
                raport_type: report.raport_type,
                storage_path: reportPath,
                public_url: publicUrlData.publicUrl
            }
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({
            success: false,
            error: err.message,
            status: 'error'
        });
    }
};
