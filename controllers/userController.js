import { supabaseUser, supabaseAdmin } from '../supabaseClient.js';
import { getFileUrl } from '../utils/uploadUtils.js';
import fs from 'fs';
import path from 'path';
// ✅ Get user profile
export const getUserProfile = async (req, res) => {
  const userId = req.user.id; // من التوكن
  try {
    // Get user profile data
    const { data: userData, error: userError } = await supabaseUser
      .from('user')
      .select('*')
      .eq('user_id', userId) // لازم تستعمل user_id (uuid) مش id (int)
      .single();

    if (userError) throw userError;

    // Get user's roles in all clinics
    const { data: clinicRoles, error: rolesError } = await supabaseUser
      .from('user_clinic_roles')
      .select(`
        clinic_id,
        role,
        status,
        clinics (
          id,
          clinic_name
        )
      `)
      .eq('user_id', userId);

    if (rolesError) {
      console.error('Error fetching clinic roles:', rolesError);
      // Don't fail the request if roles fetch fails, just log it
    }

    // Transform clinic roles into the desired format
    const rolesByClinic = {};
    if (clinicRoles) {
      clinicRoles.forEach(clinicRole => {
        if (clinicRole.clinics) {
          rolesByClinic[clinicRole.clinics.id] = clinicRole.role;
        }
      });
    }

    // Combine user data with clinic roles
    const responseData = {
      ...userData,
      rolesByClinic
    };

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Update user profile
export const updateUserProfile = async (req, res) => {
  const userId = req.params.userId;
  const { full_name, phone, address } = req.body;

  try {
    const { data, error } = await supabaseUser
      .from('users')
      .update({ full_name, phone, address })
      .eq('id', userId)
      .select();

    if (error) throw error;

    res.json({ message: 'Profile updated', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Delete own account
export const deleteOwnAccount = async (req, res) => {
  const userId = req.params.userId;

  try {
    const { error } = await supabaseUser
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    res.json({ message: 'User account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Change user password (table users uniquement, pas Auth)
export const changePassword = async (req, res) => {
  console.log("req.user");
  console.log(req.user);
  console.log("req.body");
  const userId = req.user.id;
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    console.log("oldPassword || !newPassword");
    return res.status(400).json({ error: 'Old and new password are required.' });
  }

  try {
    console.log("try");
    // Vérifier l'ancien mot de passe (en clair)
    const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('password')
      .eq('user_id', userId)
      .single();
    if (userError || !user) {
      console.log("userError || !user","userError",userError,"user",user);
      return res.status(404).json({ error: 'User not found.' });
    }
    if (user.password !== oldPassword) {
      console.log("user.password !== oldPassword");
      return res.status(401).json({ error: 'Old password is incorrect.' });

    }
    console.log("user.password === oldPassword");
    // Mettre à jour le mot de passe dans la table user
        // Mettre à jour le mot de passe dans Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          password: newPassword
        });
        
    const { error: dbError } = await supabaseUser
      .from('user')
      .update({ password: newPassword })
      .eq('user_id', userId);
    if (dbError) {
      console.log("error", dbError);
      return res.status(500).json({ error: 'Failed to update password in DB.' });
    }

    if (authError) {
      return res.status(500).json({ error: 'Failed to update password in Auth.' });
    }
    res.json({ message: 'Password updated in users table and Auth.' });
  } catch (err) {

    res.status(500).json({ error: err.message });
  }
};

// ✅ Change user name only
export const changeName = async (req, res) => {
  const userId = req.user.id;
  // Accepte les deux formats pour compatibilité
  const firstName = req.body.firstName || req.body.first_name;
  const lastName = req.body.lastName || req.body.last_name;

  if (!firstName && !lastName) {
    return res.status(400).json({ error: 'First name or last name is required.' });
  }
  console.log("firstName", firstName);
  console.log("lastName", lastName);
  try {
    // Mettre à jour le nom dans Supabase Auth (snake_case)
  

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId,   {
      user_metadata: {
        first_name: firstName,
        last_name: lastName
      }
    });
    if (authError) {

      return res.status(500).json({ error: 'Failed to update name in Auth.' });
    }

    // Mettre à jour le nom dans la table user (camelCase)
    const updateUserData = {};
    if (firstName) updateUserData.firstName = firstName;
    if (lastName) updateUserData.lastName = lastName;
    const { error: dbError } = await supabaseUser
      .from('user')
      .update(updateUserData)
      .eq('user_id', userId);
    if (dbError) {

      return res.status(500).json({ error: 'Failed to update name in DB.' });
    }
    res.json({ message: 'Name updated in users table and Auth.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const changeSignature = async (req, res) => {
  try {
    console.log('معلومات الملف:', req.file);
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'لازم تبعث ملف الإمضاء' 
      });
    }

    // 1. Get old signature path from DB
    const { data: userData, error: userFetchError } = await supabaseUser
      .from('user')
      .select('personalSignature')
      .eq('user_id', req.user.id)
      .single();
    if (userFetchError) {
      console.error('خطأ في جلب بيانات المستخدم:', userFetchError);
    }

    // 2. Remove old signature from Supabase storage if exists
    if (userData && userData.personalSignature) {
      try {
        // Extract file name from public URL
        const urlParts = userData.personalSignature.split('/');
        const fileName = urlParts[urlParts.length - 1];
        if (fileName) {
          const { error: removeError } = await supabaseAdmin.storage
            .from('signatures')
            .remove([fileName]);
          if (removeError) {
            console.error('خطأ في حذف الإمضاء القديم من التخزين:', removeError);
          }
        }
      } catch (removeCatchError) {
        console.error('خطأ أثناء محاولة حذف الإمضاء القديم:', removeCatchError);
      }
    }

    // 3. Read file buffer
    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const fileExt = path.extname(req.file.originalname);
    const supabaseFileName = `signature-${req.user.id}-${Date.now()}${fileExt}`;

    // 4. Upload to Supabase Storage (bucket: 'signatures')
    const { data, error } = await supabaseAdmin.storage
      .from('signatures')
      .upload(supabaseFileName, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('خطأ في رفع الملف إلى Supabase:', error);
      return res.status(500).json({
        success: false,
        message: 'خطأ في رفع الإمضاء إلى التخزين'
      });
    }

    // 5. Get public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('signatures')
      .getPublicUrl(supabaseFileName);

    // 6. Clean up local file
    fs.unlinkSync(filePath);

    // 7. Update user table with signature path
    const { error: updateError } = await supabaseUser
      .from('user')
      .update({ personalSignature: publicUrlData.publicUrl })
      .eq('user_id', req.user.id);
    if (updateError) {
      console.error('خطأ في تحديث جدول المستخدم:', updateError);
      return res.status(500).json({
        success: false,
        message: 'تم رفع الإمضاء لكن فشل حفظ الرابط في قاعدة البيانات'
      });
    }

    res.json({
      success: true,
      message: 'الإمضاء اتغيرت بنجاح',
      signatureUrl: publicUrlData.publicUrl
    });
  } catch (error) {
    console.error('خطأ في تغيير الإمضاء:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في السيرفر'
    });
  }
};

export const changeProfilePhoto = async (req, res) => {
  console.log("*******************************",req.user);
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'لازم تبعث صورة البروفايل'
      });
    }

    // 1. Get old profile photo path from DB
    const { data: userData, error: userFetchError } = await supabaseUser
      .from('user')
      .select('profilePhotoUrl')
      .eq('user_id', req.user.id)
      .single();
    if (userFetchError) {
      console.error('خطأ في جلب بيانات المستخدم:', userFetchError);
    }

    // 2. Remove old profile photo from Supabase storage if exists
    if (userData && userData.profilePhotoUrl) {
      try {
        const urlParts = userData.profilePhotoUrl.split('/');
        const fileName = urlParts[urlParts.length - 1];
        if (fileName) {
          const { error: removeError } = await supabaseAdmin.storage
            .from('profile-photos')
            .remove([fileName]);
          if (removeError) {
            console.error('خطأ في حذف صورة البروفايل القديمة من التخزين:', removeError);
          }
        }
      } catch (removeCatchError) {
        console.error('خطأ أثناء محاولة حذف صورة البروفايل القديمة:', removeCatchError);
      }
    }

    // 3. Read file buffer
    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const fileExt = path.extname(req.file.originalname);
    const supabaseFileName = `profile-${req.user.id}-${Date.now()}${fileExt}`;

    // 4. Upload to Supabase Storage (bucket: 'profile-photos')
    const { data, error } = await supabaseAdmin.storage
      .from('profile-photos')
      .upload(supabaseFileName, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('خطأ في رفع صورة البروفايل إلى Supabase:', error);
      return res.status(500).json({
        success: false,
        message: 'خطأ في رفع صورة البروفايل إلى التخزين'
      });
    }

    // 5. Get public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('profile-photos')
      .getPublicUrl(supabaseFileName);

    // 6. Clean up local file
    fs.unlinkSync(filePath);

    // 7. Update user table with profile photo path
    const { error: updateError } = await supabaseUser
      .from('user')
      .update({ profilePhotoUrl: publicUrlData.publicUrl })
      .eq('user_id', req.user.id);
    if (updateError) {
      console.error('خطأ في تحديث جدول المستخدم:', updateError);
      return res.status(500).json({
        success: false,
        message: 'تم رفع الصورة لكن فشل حفظ الرابط في قاعدة البيانات'
      });
    }

    res.json({
      success: true,
      message: 'صورة البروفايل اتغيرت بنجاح',
      profilePhotoUrl: publicUrlData.publicUrl
    });
  } catch (error) {
    console.error('خطأ في تغيير صورة البروفايل:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في السيرفر'
    });
  }
};