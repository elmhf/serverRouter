import { supabaseAdmin } from '../supabaseClient.js';
import jwt from 'jsonwebtoken';

// ✅ تسجيل دخول الأدمن
export const loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. البحث عن الأدمن في جدول admin
    const { data: admin, error } = await supabaseAdmin
      .from('Admins')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !admin) {
      console.error('Admin not found:', error);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 2. التحقق من كلمة المرور (مباشرة كما في user table حسب الطلب)
    if (admin.password !== password) {
      console.error('Invalid password:', password);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // 3. إنشاء Token خاص بالأدمن
    const token = jwt.sign(
      {
        id: admin.admin_id,
        email: admin.email,
        role: 'admin',
        type: 'admin_token' // لتمييزه عن توكن supabase
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );

    // 4. إنشاء Refresh Token للأدمن
    const refreshToken = jwt.sign(
      {
        id: admin.admin_id,
        email: admin.email,
        role: 'admin',
        type: 'admin_refresh_token'
      },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    // 5. تعيين الكوكيز بمسميات خاصة بالأدمن
    res.cookie('access_token_admin', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.cookie('refresh_token_admin', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      message: 'Login successful',
      admin: {
        id: admin.id,
        email: admin.email,
        role: 'admin'
      }
    });

  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};



// ✅ تجديد توكن الأدمن
export const refreshAdminToken = async (req, res) => {
  const refreshToken = req.cookies?.refresh_token_admin;

  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token provided' });
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'secret'
    );

    if (decoded.type !== 'admin_refresh_token' || decoded.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid admin refresh token' });
    }

    // Issue a new access token
    const newAccessToken = jwt.sign(
      {
        id: decoded.id,
        email: decoded.email,
        role: 'admin',
        type: 'admin_token'
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );

    res.cookie('access_token_admin', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ message: 'Token refreshed successfully' });

  } catch (err) {
    console.error('Admin token refresh error:', err);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};

// ✅ جلب بيانات الأدمن الحالي
export const getAdminProfile = async (req, res) => {
  try {
    const adminId = req.user.admin_id;
    // console.log("-------------------------------------------------------**",adminId);
    const { data: admin, error } = await supabaseAdmin
      .from('Admins')
      .select('admin_id, email, first_name, last_name')
      .eq('admin_id', adminId)
      .single();


    // console.log("-------------------------------------------------------**",admin);
    if (error) throw error;
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    res.json({ user: admin });
  } catch (err) {
    console.error('------------------------------------------------ getAdminProfile error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث بيانات الأدمن
export const updateAdminProfile = async (req, res) => {
  try {
    const adminId = req.user.admin_id;
    const { first_name, last_name, email } = req.body;

    const { data, error } = await supabaseAdmin
      .from('Admins')
      .update({ first_name, last_name, email })
      .eq('admin_id', adminId)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Profile updated successfully', user: data });
  } catch (err) {
    console.error('updateAdminProfile error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث كلمة مرور الأدمن
export const updateAdminPassword = async (req, res) => {
  try {
    const adminId = req.user.admin_id;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { error } = await supabaseAdmin
      .from('Admins')
      .update({ password: newPassword })
      .eq('admin_id', adminId);

    if (error) throw error;

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('updateAdminPassword error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ جلب إعدادات النظام
export const getAppSettings = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('*')
      .order('category', { ascending: true });

    if (error) throw error;

    // تحويل المصفوفة إلى كائن compatibility
    const config = data.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    // Return both the mapped config (for values) and the raw structure (for UI generation)
    res.json({ config, settings: data });
  } catch (err) {
    console.error('getAppSettings error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث إعدادات النظام (القيم أو الميتاداتا)
export const updateAppSettings = async (req, res) => {
  try {
    const { password, ...updates } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required to confirm changes' });
    }

    // Verify Admin Password
    const { data: admin, error: authError } = await supabaseAdmin
      .from('Admins')
      .select('password')
      .eq('admin_id', req.user.admin_id) // Assuming adminAuth middleware populates req.user
      .single();
    console.log(admin, "----------------------");
    if (authError || !admin) {
      return res.status(401).json({ error: 'Unauthorized: Admin not found' });
    }

    if (admin.password !== password) {
      return res.status(402).json({ error: 'Incorrect password' });
    }

    // Check if it's a batch update (values only) or single row full update
    if (updates.key && updates.target_service) {
      // Single row full update (Metadata + Value)
      const { key, ...fields } = updates;
      // Filter out any potential non-db fields if necessary, but 'updates' was destructured to remove password.
      // We should also be careful not to update 'key' itself if it is the primary key or part of the query.
      // The logic below assumes 'key' is used for query and removed from fields.

      const { error } = await supabaseAdmin
        .from('app_settings')
        .update({ ...fields, updated_at: new Date() })
        .eq('key', key);

      if (error) throw error;


    } else {
      // Batch value update (Standard Save)
      // Note: 'updates' currently contains the settings key-value pairs.
      // We need to iterate over them.
      const promises = Object.entries(updates).map(([key, value]) => {
        // Skip any keys that might not be settings (e.g. if we add more metadata later)
        // For now, assuming all remaining keys in 'updates' are setting keys.
        return supabaseAdmin
          .from('app_settings')
          .update({ value, updated_at: new Date() })
          .eq('key', key);
      });
      await Promise.all(promises);


    }

    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    console.error('updateAppSettings error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ إضافة إعداد جديد
export const addAppSetting = async (req, res) => {
  const { key, value, category, target_service, input_type } = req.body;

  if (!key || !target_service) {
    return res.status(400).json({ error: 'Key and Target Service are required' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('app_settings')
      .insert([{
        key,
        value,
        category: category || 'General',
        target_service,
        input_type: input_type || 'text',
        created_at: new Date(),
        updated_at: new Date()
      }]);

    if (error) throw error;

    res.json({ message: 'Setting added successfully' });
  } catch (err) {
    console.error('addAppSetting error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ حذف إعداد
export const deleteAppSetting = async (req, res) => {
  const { key } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('app_settings')
      .delete()
      .eq('key', key);

    if (error) throw error;

    res.json({ message: 'Setting deleted successfully' });
  } catch (err) {
    console.error('deleteAppSetting error:', err);
    res.status(500).json({ error: err.message });
  }
};


// ✅ تسجيل خروج الأدمن
export const logoutAdmin = async (req, res) => {
  try {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    };

    res.clearCookie('access_token_admin', cookieOptions);
    res.clearCookie('refresh_token_admin', cookieOptions);

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ✅ مثال: جيب جميع المستخدمين
export const getAllUsers = async (req, res) => {
  try {
    const { from, to } = req.query;

    let query = supabaseAdmin
      .from('user')
      .select('*', { count: 'exact' });

    if (from || to) {
      const rangeFrom = parseInt(from) || 0;
      const rangeTo = parseInt(to) || 9; // Default to first 10 if not fully specified
      query = query.range(rangeFrom, rangeTo);
    }

    const { data: users, count, error } = await query;

    if (error) throw error;

    if (!users || users.length === 0) {
      return res.json({ data: [], count });
    }

    // Fetch bans separately manually since relationship might be missing in schema cache
    const userIds = users.map(u => u.user_id);
    const { data: bans, error: banError } = await supabaseAdmin
      .from('user_bans')
      .select('user_id, ban_type, ban_description, ban_start, ban_end')
      .in('user_id', userIds)
      .eq('is_active', true);

    // Map bans to users
    const userBanMap = {};
    if (bans) {
      bans.forEach(ban => {
        userBanMap[ban.user_id] = ban;
      });
    }

    // Transform data to include is_banned, ban_type, and ban_details
    const usersWithBanStatus = users.map(user => {
      const banInfo = userBanMap[user.user_id];
      return {
        ...user,
        is_banned: !!banInfo,
        ban_type: banInfo ? banInfo.ban_type : null,
        ban_details: banInfo ? {
          type: banInfo.ban_type,
          description: banInfo.ban_description,
          start_date: banInfo.ban_start,
          end_date: banInfo.ban_end
        } : null
      };
    });

    res.json({ data: usersWithBanStatus, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ مثال: عمل promote لمستخدم (يولي admin)
export const promoteToAdmin = async (req, res) => {
  const { userId } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('user')
      .update({ role: 'admin' })
      .eq('id', userId);

    if (error) throw error;

    res.json({ message: 'User promoted to admin', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ حظر مستخدم
export const banUser = async (req, res) => {
  const { userId, type, reason, end_date } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {

    // 2. Insert into `user_bans` table
    const { error: banError } = await supabaseAdmin
      .from('user_bans')
      .insert({
        user_id: userId,
        ban_type: type || 'PERMANENT',
        ban_description: reason || 'No reason provided',
        ban_start: new Date(),
        ban_end: end_date || null,
        is_active: true
      });

    if (banError) throw banError;

    res.json({ message: 'User banned successfully' });
  } catch (err) {
    console.error('banUser error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ رفع حظر مستخدم
export const unbanUser = async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {

    // 2. Delete bans in `user_bans` table
    const { error: banError } = await supabaseAdmin
      .from('user_bans')
      .delete()
      .eq('user_id', userId);

    if (banError) throw banError;

    res.json({ message: 'User unbanned successfully' });
  } catch (err) {
    console.error('unbanUser error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ مثال: حذف user
export const deleteUser = async (req, res) => {
  const { userId } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('user')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ جيب جميع العيادات
export const getAllClinics = async (req, res) => {
  try {
    const { from, to } = req.query;
    const { users } = req.body; // Expecting list of users (objects with id or just ids)

    let query = supabaseAdmin
      .from('clinics')
      .select('*, user_clinic_roles(count), patients(count)', { count: 'exact' });

    let roleMap = {};

    // Filter by users if provided
    if (users && Array.isArray(users) && users.length > 0) {
      // Extract IDs assuming users might be objects {id: ...} or just IDs
      const userIds = users.map(u => typeof u === 'object' ? u.id : u);

      if (userIds.length > 0) {
        // Find clinics where these users are members AND fetch their role
        const { data: roles, error: rolesError } = await supabaseAdmin
          .from('user_clinic_roles')
          .select('clinic_id, role')
          .in('user_id', userIds);

        if (rolesError) throw rolesError;

        if (roles && roles.length > 0) {
          const clinicIds = [...new Set(roles.map(r => r.clinic_id))]; // Unique clinic IDs
          query = query.in('id', clinicIds);

          // Populate role map
          // Note: If multiple users queried have different roles in the SAME clinic, 
          // this simple map will overwrite. Assuming typical use case is filtering by single user.
          roles.forEach(r => {
            roleMap[r.clinic_id] = r.role;
          });
        } else {
          // No clinics found for these users, return empty result
          return res.json({ data: [], count: 0 });
        }
      }
    }

    if (from || to) {
      const rangeFrom = parseInt(from) || 0;
      const rangeTo = parseInt(to) || 9;
      query = query.range(rangeFrom, rangeTo);
    }

    const { data, count, error } = await query;

    if (error) throw error;

    // --- Secondary Query: Fetch Report Counts ---
    // We need report counts per clinic.
    // Logic: Find all patients belonging to these clinics, then get their report counts.
    // However, Supabase doesn't easily do "count of reports for all patients in these clinics" in one nested swoop efficiently with simple embedding if we want aggregate PER CLINIC.
    // An alternative generic approach:
    // 1. Get all clinic IDs.
    // 2. Query patients -> select clinic_id, report_ai(count)
    // 3. Aggregate in JS.

    const clinicIds = data.map(c => c.id);
    let clinicReportMap = {};

    if (clinicIds.length > 0) {
      const { data: patientReports, error: reportsError } = await supabaseAdmin
        .from('patients')
        .select('clinic_id, report_ai(count)')
        .in('clinic_id', clinicIds);

      if (!reportsError && patientReports) {
        // Aggregate totals per clinic
        // patientReports structure: [{ clinic_id: '...', report_ai: [{ count: 5 }] }, ...] or similar depending on count structure return
        // Actually, select('..., report_ai(count)') returns something like:
        // { clinic_id: '...', report_ai: [{ count: 5 }] } (if single) or just array of objects? 
        // Supabase `count` usually returns array unless singular.
        // Let's assume standard behavior: `report_ai: [{ count: X }]`

        patientReports.forEach(p => {
          const rCount = p.report_ai?.[0]?.count || 0;
          if (!clinicReportMap[p.clinic_id]) {
            clinicReportMap[p.clinic_id] = 0;
          }
          clinicReportMap[p.clinic_id] += rCount;
        });
      }
    }

    // Attach roles, member count, patient count, and report count to the response data
    const dataWithCounts = data.map(clinic => ({
      ...clinic,
      role: roleMap[clinic.id] || null,
      memberCount: clinic.user_clinic_roles?.[0]?.count || 0,
      patientCount: clinic.patients?.[0]?.count || 0,
      reportCount: clinicReportMap[clinic.id] || 0
    }));

    res.json({ data: dataWithCounts, count });
  } catch (err) {
    console.error('getAllClinics error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ جيب جميع التقارير
export const getAllReports = async (req, res) => {
  try {
    const { from, to } = req.body;

    let query = supabaseAdmin
      .from('report_ai')
      .select('*, patients:patient_id(first_name, last_name, clinic_id, email, clinics:clinic_id(clinic_name, email, stamp_url))', { count: 'exact' });

    if (from || to) {
      const rangeFrom = parseInt(from) || 0;
      const rangeTo = parseInt(to) || 9;
      query = query.range(rangeFrom, rangeTo);
    }

    // Order by newest first
    query = query.order('created_at', { ascending: false });

    const { data, count, error } = await query;
    if (error) throw error;

    // Flatten and format
    const formattedData = await Promise.all(data.map(async (report) => {
      const clinicId = report.patients?.clinic_id;
      let imageUrl = null;

      if (clinicId && report.patient_id && report.raport_type && report.report_id) {
        const folderPath = `${clinicId}/${report.patient_id}/${report.raport_type}/${report.report_id}`;

        // Check if 'original.png' exists in the folder
        const { data: files } = await supabaseAdmin.storage
          .from('reports')
          .list(folderPath);

        // Note: .list() returns an array of files in the folder
        const hasOriginal = files && files.some(f => f.name === 'original.png');

        if (hasOriginal) {
          const path = `${folderPath}/original.png`;
          const { data: publicUrlData } = supabaseAdmin.storage
            .from('reports')
            .getPublicUrl(path);
          imageUrl = publicUrlData?.publicUrl;
        }
      }

      return {
        ...report,
        patient_name: report.patients ? `${report.patients.first_name || ''} ${report.patients.last_name || ''}`.trim() : 'Unknown Patient',
        patient_email: report.patients?.email,
        clinic: report.patients?.clinics ? { ...report.patients.clinics, name: report.patients.clinics.clinic_name } : null,
        patient_avatar: null, // Patient photo not available in schema
        report_image: imageUrl
      };
    }));

    res.json({ data: formattedData, count });
  } catch (err) {
    console.error('getAllReports error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ مسح مستخدم من عيادة (حذف من user_clinic_roles)
export const removeUserFromClinic = async (req, res) => {
  const { userId, clinicId } = req.body;

  if (!userId || !clinicId) {
    return res.status(400).json({ error: 'userId and clinicId are required' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('user_clinic_roles')
      .delete()
      .match({ user_id: userId, clinic_id: clinicId });

    if (error) throw error;

    res.json({ message: 'User removed from clinic successfully' });
  } catch (err) {
    console.error('removeUserFromClinic error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث دور مستخدم في عيادة
export const updateUserRoleInClinic = async (req, res) => {
  const { userId, clinicId, role } = req.body;

  if (!userId || !clinicId || !role) {
    return res.status(400).json({ error: 'userId, clinicId, and role are required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('user_clinic_roles')
      .update({ role })
      .match({ user_id: userId, clinic_id: clinicId })
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'User role not found in this clinic' });
    }

    res.json({ message: 'User role updated successfully', data });
  } catch (err) {
    console.error('updateUserRoleInClinic error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث بيانات المستخدم (مع التحقق من عدم تكرار الإيميل)
export const updateUser = async (req, res) => {
  const { userId, ...updates } = req.body; // Extract userId, keep rest as updates

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Handle camelCase to snake_case mapping for names
  if (updates.first_name) {
    updates.firstName = updates.first_name;
    delete updates.first_name;
  }
  if (updates.last_name) {
    updates.lastName = updates.last_name;
    delete updates.last_name;
  }

  try {
    // 1. إذا كان هناك تحديث للإيميل، تحقق من عدم وجوده مسبقاً
    if (updates.email) {
      const { data: existingUser, error: checkError } = await supabaseAdmin
        .from('user')
        .select('id')
        .eq('email', updates.email)
        .neq('user_id', userId) // استثناء المستخدم الحالي
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingUser) {
        return res.status(400).json({ error: 'email moujoud' });
      }
    }

    // 2. تحديث البيانات
    const { data, error } = await supabaseAdmin
      .from('user')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'User updated successfully', user: data });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ إضافة مستخدم جديد
export const addUser = async (req, res) => {
  let { email, password, firstName, lastName, phone, first_name, last_name } = req.body;

  // Handle snake_case inputs
  firstName = firstName || first_name;
  lastName = lastName || last_name;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'Email, password, first name and last name are required' });
  }

  try {
    // 1. إنشاء المستخدم في Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // تأكيد الإيميل مباشرة
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        status: 'verified' // نعتبره مفعل
      }
    });

    if (authError) throw authError;

    if (!authData.user) {
      throw new Error('Failed to create auth user');
    }

    // 2. إضافة المستخدم في جدول user العام
    const userProfile = {
      user_id: authData.user.id,
      email: email.toLowerCase(),
      firstName,
      lastName,
      phone: phone || null,

      email_verified: true,
      created_at: new Date().toISOString()
    };

    const { error: insertError } = await supabaseAdmin
      .from('user')
      .insert([userProfile]);

    if (insertError) {
      // Rollback: delete auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw insertError;
    }

    // 3. إضافة إعدادات الأمان الافتراضية
    await supabaseAdmin
      .from('user_security')
      .insert([{ user_id: authData.user.id }]);

    res.status(201).json({
      message: 'User created successfully',
      user: userProfile
    });

  } catch (err) {
    console.error('addUser error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث بيانات العيادة
export const updateClinic = async (req, res) => {
  const { clinicId, ...updates } = req.body;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('clinics')
      .update(updates)
      .eq('id', clinicId)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Clinic updated successfully', clinic: data });
  } catch (err) {
    console.error('updateClinic error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ جلب جميع التكاملات
export const getAllIntegrations = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('config_Integrations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('getAllIntegrations error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ إضافة تكامل جديد
export const addIntegration = async (req, res) => {
  try {
    const { Integrations, deiscription, logo_Integration } = req.body;
    const { data, error } = await supabaseAdmin
      .from('config_Integrations')
      .insert([{ Integrations, deiscription, logo_Integration, is_Integration: true }])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('addIntegration error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث تفاصيل التكامل
export const updateIntegration = async (req, res) => {
  try {
    const { id, ...updates } = req.body;

    // Filter out undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    const { error } = await supabaseAdmin
      .from('config_Integrations')
      .update(cleanUpdates)
      .eq('Integrations_id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('updateIntegration error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ حذف تكامل
export const deleteIntegration = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('config_Integrations')
      .delete()
      .eq('Integrations_id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('deleteIntegration error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ حذف العيادة
export const deleteClinic = async (req, res) => {
  const { clinicId } = req.params;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Clean up Clinic Assets (Optional: but good practice to keep storage clean)
    const { data: clinic } = await supabaseAdmin
      .from('clinics')
      .select('logo_url, stamp_url')
      .eq('id', clinicId)
      .single();

    if (clinic) {
      if (clinic.logo_url) {
        const fileName = clinic.logo_url.split('/').pop();
        await supabaseAdmin.storage.from('cliniclogo').remove([fileName]);
      }
      if (clinic.stamp_url) {
        const fileName = clinic.stamp_url.split('/').pop();
        await supabaseAdmin.storage.from('clinicstamp').remove([fileName]);
      }
    }

    // 2. Delete Clinic Dependencies
    // A. Delete User Roles
    const { error: rolesError } = await supabaseAdmin
      .from('user_clinic_roles')
      .delete()
      .eq('clinic_id', clinicId);

    if (rolesError) {
      console.error('Error deleting clinic roles:', rolesError);
      throw rolesError;
    }

    // B. Delete Patients (and assume their cascade handles reports, or catch error)
    // Ideally we should delete reports first if not cascaded, but let's try this first.
    // If patients has FK to reports without cascade, this will fail.
    // Let's try to delete reports first just in case to be safe, assuming 'report_ai' table.
    // Finding patients first to delete their reports is expensive if many, but necessary if no cascade.
    // However, let's start with just patients deletion as the error specifically mentioned patients table.
    const { error: patientsError } = await supabaseAdmin
      .from('patients')
      .delete()
      .eq('clinic_id', clinicId);

    if (patientsError) {
      console.error('Error deleting clinic patients:', patientsError);
      // Attempt to delete reports if patients delete failed (speculative fix)
      // For now, throw to see if new error appears or if this fixes the current one.
      throw patientsError;
    }

    // 3. Delete Clinic
    const { error } = await supabaseAdmin
      .from('clinics')
      .delete()
      .eq('id', clinicId);

    if (error) throw error;

    res.json({ message: 'Clinic deleted successfully' });
  } catch (err) {
    console.error('deleteClinic error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ إضافة عيادة جديدة
export const createClinic = async (req, res) => {
  const { clinic_name, email, ...otherDetails } = req.body;

  if (!clinic_name || !email) {
    return res.status(400).json({ error: 'Clinic name and email are required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('clinics')
      .insert([{ clinic_name, email, ...otherDetails }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Clinic created successfully', clinic: data });
  } catch (err) {
    console.error('createClinic error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ جلب أعضاء العيادة
export const getClinicMembers = async (req, res) => {
  const { clinicId } = req.params;

  try {
    const { data, error } = await supabaseAdmin
      .from('user_clinic_roles')
      .select('role, user_id, user:user_id(id, email, firstName, lastName, profilePhotoUrl)')
      .eq('clinic_id', clinicId);

    if (error) throw error;

    // Flatten structure for frontend
    const members = data.map(item => ({
      userId: item.user_id,
      role: item.role,
      email: item.user?.email,
      firstName: item.user?.firstName,
      lastName: item.user?.lastName,
      profilePhotoUrl: item.user?.profilePhotoUrl,
    }));

    res.json({ members });
  } catch (err) {
    console.error('getClinicMembers error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ إضافة مستخدم لعيادة بواسطة الإيميل
export const addUserToClinic = async (req, res) => {
  const { clinicId, email, role } = req.body;

  if (!clinicId || !email || !role) {
    return res.status(400).json({ error: 'ClinicId, email, and role are required' });
  }

  try {
    // 1. Find user by email
    const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, user_id')
      .eq('email', email.toLowerCase())
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found with this email' });
    }

    // 2. Check if already a member
    const { data: existingRole, error: roleCheckError } = await supabaseAdmin
      .from('user_clinic_roles')
      .select('*')
      .match({ clinic_id: clinicId, user_id: user.user_id })
      .maybeSingle();

    if (existingRole) {
      return res.status(400).json({ error: 'User is already a member of this clinic' });
    }

    // 3. Add to clinic
    const { error: insertError } = await supabaseAdmin
      .from('user_clinic_roles')
      .insert([{
        user_id: user.user_id,
        clinic_id: clinicId,
        role: role
      }]);

    if (insertError) throw insertError;

    res.json({ message: 'User added to clinic successfully' });
  } catch (err) {
    console.error('addUserToClinic error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ مسح تقرير
export const deleteReport = async (req, res) => {
  const { reportId } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('report_ai')
      .delete()
      .eq('report_id', reportId);

    if (error) throw error;

    res.json({ message: 'Report deleted successfully' });
  } catch (err) {
    console.error('deleteReport error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ جلب جميع المرضى
export const getAllPatients = async (req, res) => {
  try {
    const { from, to, search } = req.body;

    let query = supabaseAdmin
      .from('patients')
      .select('*, clinics(clinic_id, clinic_name, email)', { count: 'exact' });

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (from || to) {
      const rangeFrom = parseInt(from) || 0;
      const rangeTo = parseInt(to) || 9;
      query = query.range(rangeFrom, rangeTo);
    }

    query = query.order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    const formattedData = data.map(patient => ({
      ...patient,
      clinic_name: patient.clinics?.clinic_name,
      clinic_email: patient.clinics?.email
    }));

    res.json({ data: formattedData, count });
  } catch (err) {
    console.error('getAllPatients error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ مسح مريض
export const deletePatient = async (req, res) => {
  const { patientId } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('patients')
      .delete()
      .eq('id', patientId);

    if (error) throw error;

    res.json({ message: 'Patient deleted successfully' });
  } catch (err) {
    console.error('deletePatient error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث بيانات المريض
export const updatePatient = async (req, res) => {
  const { patientId, ...updates } = req.body;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .update(updates)
      .eq('id', patientId)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Patient updated successfully', patient: data });
  } catch (err) {
    console.error('updatePatient error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ جلب الأطباء المعالجين للمريض
export const getPatientDoctors = async (req, res) => {
  const { patientId } = req.params;

  try {

    const { data, error } = await supabaseAdmin
      .from('treatments')
      // Note: 'user' is a reserved keyword in some contexts, but let's try mapping it.
      // If table name is explicitly 'user', Supabase usually allows referencing it.
      // We will select specific fields to be safe.
      .select('*, doctor:user!treatments_treating_doctor_id_fkey(user_id, email, firstName, lastName, profilePhotoUrl)')
      .eq('patient_id', patientId);

    if (error) {
      // Fallback: try without explicit FK name if the above fails (sometimes standard naming works)
      console.warn('Initial join failed, retrying with standard join...');
      const { data: retryData, error: retryError } = await supabaseAdmin
        .from('treatments')
        .select('*, doctor:user(user_id, email, firstName, lastName, profilePhotoUrl)')
        .eq('patient_id', patientId);
      if (retryError) throw retryError; // If both fail, throw actual error
      const doctors = retryData.map(t => ({
        treatment_id: t.user_id,
        ...t.doctor
      }));
      return res.json({ doctors });
    }

    // Format data
    const doctors = data.map(t => ({
      treatment_id: t.user_id,
      ...t.doctor
    }));

    res.json({ doctors });
  } catch (err) {
    console.error('getPatientDoctors error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ إضافة طبيب لمريض

// ✅ إحصائيات لوحة التحكم (Chart Data)
// ✅ إحصائيات لوحة التحكم (Chart Data)
export const getDashboardStats = async (req, res) => {
  try {
    const { range = '6m' } = req.query;

    let startDate = new Date();
    let interval = 'month'; // 'month', 'day', 'hour'
    let bucketCount = 6;
    let dateFormat = 'monthly'; // 'monthly', 'daily', 'hourly'

    // Determine start date and interval
    switch (range) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        interval = 'hour';
        bucketCount = 24;
        dateFormat = 'hourly';
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        interval = 'day';
        bucketCount = 7;
        dateFormat = 'daily';
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        interval = 'day';
        bucketCount = 30;
        dateFormat = 'daily';
        break;
      case '90d': // 3 months
      case '3m':
        startDate.setMonth(startDate.getMonth() - 3);
        startDate.setDate(1);
        interval = 'month';
        bucketCount = 3;
        break;
      case '6m':
      default:
        startDate.setMonth(startDate.getMonth() - 6);
        startDate.setDate(1);
        interval = 'month';
        bucketCount = 6;
        break;
    }

    const startIso = startDate.toISOString();

    // 1. Fetch Patients
    const { data: patients, error: patientsError } = await supabaseAdmin
      .from('patients')
      .select('created_at')
      .gte('created_at', startIso);

    if (patientsError) throw patientsError;

    // 2. Fetch Reports
    const { data: reports, error: reportsError } = await supabaseAdmin
      .from('report_ai')
      .select('created_at')
      .gte('created_at', startIso);

    if (reportsError) throw reportsError;

    // 3. Aggregate
    const statsMap = {};

    // Helper to generate keys
    const getKey = (date, fmt) => {
      const d = new Date(date);
      if (fmt === 'hourly') {
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}T${d.getHours().toString().padStart(2, '0')}:00`;
      } else if (fmt === 'daily') {
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      } else {
        // monthly
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      }
    }

    // Initialize buckets
    const endDate = new Date();
    // For 24h, we want exact hour buckets. For others, standard logic.
    const orderedKeys = [];

    // We need to generate buckets forward from startDate up to now
    // Or backward from now? Backward is usually safer for "Last X" charts.

    let current = new Date(endDate);
    if (interval === 'month') {
      // Round to start of month for consistency if monthly
      // But for "Last 6 months" distinct buckets, we usually walk back.
      for (let i = 0; i < bucketCount; i++) {
        // Logic: current month, current-1 month, etc.
        const d = new Date();
        d.setDate(1); // avoid Day overflow issues
        d.setMonth(endDate.getMonth() - i);
        const key = getKey(d, 'monthly');
        statsMap[key] = { date: d.toISOString(), patients: 0, reports: 0 };
        orderedKeys.unshift(key); // prepend to have chronological order
      }
    } else if (interval === 'day') {
      for (let i = 0; i < bucketCount; i++) {
        const d = new Date();
        d.setDate(endDate.getDate() - i);
        const key = getKey(d, 'daily');
        statsMap[key] = { date: d.toISOString(), patients: 0, reports: 0 };
        orderedKeys.unshift(key);
      }
    } else if (interval === 'hour') {
      for (let i = 0; i < bucketCount; i++) {
        const d = new Date();
        d.setHours(endDate.getHours() - i);
        d.setMinutes(0, 0, 0); // round to hour
        const key = getKey(d, 'hourly');
        statsMap[key] = { date: d.toISOString(), patients: 0, reports: 0 };
        orderedKeys.unshift(key);
      }
    }

    // Fill Data
    patients.forEach(p => {
      const key = getKey(p.created_at, dateFormat);
      if (statsMap[key]) statsMap[key].patients++;
    });

    reports.forEach(r => {
      const key = getKey(r.created_at, dateFormat);
      if (statsMap[key]) statsMap[key].reports++;
    });

    // Filter map by orderedKeys to ensure order and existence
    const chartData = orderedKeys.map(key => statsMap[key]);

    res.json(chartData);
  } catch (err) {
    console.error('getDashboardStats error:', err);
    res.status(500).json({ error: err.message });
  }
};


// ✅ إضافة طبيب معالج للمريض
export const addDoctorToPatient = async (req, res) => {
  const { patientId, doctorId, clinicId } = req.body;

  if (!patientId || !doctorId || !clinicId) {
    return res.status(400).json({ error: 'Patient ID, Doctor ID, and Clinic ID are required' });
  }

  try {
    // Check if already assigned
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('treatments')
      .select('id')
      .match({ patient_id: patientId, treating_doctor_id: doctorId })
      .maybeSingle();

    if (checkError) throw checkError;
    if (existing) {
      return res.status(400).json({ error: 'Doctor is already assigned to this patient' });
    }

    const { data, error } = await supabaseAdmin
      .from('treatments')
      .insert([{
        patient_id: patientId,
        treating_doctor_id: doctorId,
        clinic_id: clinicId
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Doctor added successfully', treatment: data });
  } catch (err) {
    console.error('addDoctorToPatient error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ حذف طبيب معالج من المريض
export const removeDoctorFromPatient = async (req, res) => {
  const { patientId, doctorId } = req.body;

  try {
    const { error } = await supabaseAdmin
      .from('treatments')
      .delete()
      .match({ patient_id: patientId, treating_doctor_id: doctorId });

    if (error) throw error;

    res.json({ message: 'Doctor removed successfully' });
  } catch (err) {
    console.error('removeDoctorFromPatient error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ إضافة مريض جديد
export const createPatient = async (req, res) => {
  const { first_name, last_name, email, phone, date_of_birth, gender, clinic_id } = req.body;

  if (!first_name || !last_name || !email || !clinic_id) {
    return res.status(400).json({ error: 'First Name, Last Name, Email, and Clinic are required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('patients')
      .insert([{
        first_name,
        last_name,
        email,
        phone,
        date_of_birth,
        gender,
        clinic_id,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Patient created successfully', patient: data });
  } catch (err) {
    console.error('createPatient error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getIncidentReports = async (req, res) => {
  try {
    const { from, to } = req.query;

    let query = supabaseAdmin
      .from('incident_reports')
      .select('*, user:user_id(email, firstName, lastName, profilePhotoUrl), clinic:clinic_id(clinic_name)', { count: 'exact' });

    const rangeFrom = parseInt(from) || 0;
    const rangeTo = parseInt(to) || 9;
    query = query.range(rangeFrom, rangeTo);

    query = query.order('created_at', { ascending: false });

    const { data, count, error } = await query;

    if (error) throw error;

    res.json({ data, count });
  } catch (err) {
    console.error('getIncidentReports error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ تحديث حالة تقرير الحادث
export const updateIncidentReport = async (req, res) => {
  const { reportId, status } = req.body;

  if (!reportId || !status) {
    return res.status(400).json({ error: 'Report ID and Status are required' });
  }

  try {
    const updates = { status };

    // Automatically set completed_at based on status
    if (['resolved', 'closed'].includes(status.toLowerCase())) {
      updates.completed_at = new Date();
    } else {
      updates.completed_at = null;
    }

    const { data, error } = await supabaseAdmin
      .from('incident_reports')
      .update(updates)
      .eq('id', reportId)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Report status updated successfully', report: data });
  } catch (err) {
    console.error('updateIncidentReport error:', err);
    res.status(500).json({ error: err.message });
  }
};
