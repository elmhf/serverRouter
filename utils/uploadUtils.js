// utils/uploadUtils.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// إنشاء مجلد إذا لم يكن موجود
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// إعداد التخزين العام
const createStorage = (uploadPath, filenamePrefix = 'file') => {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const fullPath = path.join('uploads', uploadPath);
      ensureDirectoryExists(fullPath);
      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const extension = path.extname(file.originalname);
      cb(null, `${filenamePrefix}-${uniqueSuffix}${extension}`);
    }
  });
};

// مرشحات الملفات المختلفة
export const fileFilters = {
  // للصور فقط
  images: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/svg+xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم. استعمل: JPG, PNG, GIF, SVG'));
    }
  },

  // للمستندات
  documents: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم. استعمل: PDF, DOC, DOCX'));
    }
  },

  // للإمضاءات
  signatures: (req, file, cb) => {
    const allowedTypes = ['image/svg+xml', 'image/png', 'image/jpeg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم للإمضاء. استعمل: SVG, PNG, JPG'));
    }
  },

  // قبول أي نوع
  any: (req, file, cb) => {
    cb(null, true);
  }
};

// الدالة الأساسية لإنشاء multer upload
export const createUploader = (options = {}) => {
  const {
    uploadPath = 'general',           // مسار الحفظ
    filenamePrefix = 'file',          // بداية اسم الملف
    maxSize = 5 * 1024 * 1024,       // 5MB حد أقصى
    fileFilter = 'any',               // نوع الملفات المقبولة
    fieldName = 'file'                // اسم الحقل في FormData
  } = options;

  const storage = createStorage(uploadPath, filenamePrefix);
  
  const upload = multer({
    storage: storage,
    limits: {
      fileSize: maxSize,
    },
    fileFilter: fileFilters[fileFilter] || fileFilters.any
  });

  return {
    single: upload.single(fieldName),
    multiple: upload.array(fieldName, 10), // حد أقصى 10 ملفات
    fields: upload.fields
  };
};

// وظائف محددة للاستعمالات الشائعة
export const uploaders = {
  // للإمضاءات
  signature: createUploader({
    uploadPath: 'signatures',
    filenamePrefix: 'signature',
    maxSize: 2 * 1024 * 1024, // 2MB
    fileFilter: 'signatures',
    fieldName: 'signature'
  }),

  // للصور العامة
  image: createUploader({
    uploadPath: 'images',
    filenamePrefix: 'image',
    maxSize: 10 * 1024 * 1024, // 10MB
    fileFilter: 'images',
    fieldName: 'image'
  }),

  // للمستندات
  document: createUploader({
    uploadPath: 'documents',
    filenamePrefix: 'doc',
    maxSize: 20 * 1024 * 1024, // 20MB
    fileFilter: 'documents',
    fieldName: 'document'
  }),

  // للملفات العامة
  general: createUploader({
    uploadPath: 'general',
    filenamePrefix: 'file',
    maxSize: 50 * 1024 * 1024, // 50MB
    fileFilter: 'any',
    fieldName: 'file'
  })
};

// دالة مساعدة لحذف الملف
export const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('خطأ في حذف الملف:', error);
    return false;
  }
};

// دالة للحصول على URL الملف
export const getFileUrl = (req, filePath) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/${filePath.replace(/\\/g, '/')}`;
};

// تصدير افتراضي
export default {
  createUploader,
  uploaders,
  deleteFile,
  getFileUrl,
  fileFilters
};