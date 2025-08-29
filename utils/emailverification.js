import { supabaseAdmin } from '../supabaseClient.js';

/**
 * تتحقق من استعمال الإيميل حسب نوع الكيان
 * @param {string} email - الإيميل اللي تحب تتحقق منه
 * @param {string} entityType - 'user' أو 'clinic' أو 'all'
 * @param {string|null} currentUserId - (اختياري) لتجاهل المستخدم الحالي في التحقق
 * @returns {Promise<{usedBy: string|null}>}
 */
export default async function validateEmailUsage(email, entityType = 'all', currentUserId = null) {
    if (entityType === 'user' || entityType === 'all') {
      const { data: existingUsers, error: userCheckError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .neq('id', currentUserId)
        .limit(1);
  
      if (userCheckError) {
        throw new Error('Error checking user email');
      }
      if (existingUsers.length > 0) {
        return { usedBy: 'user' };
      }
    }
  
    if (entityType === 'clinic' || entityType === 'all') {
      const { data: existingClinics, error: clinicCheckError } = await supabaseAdmin
        .from('clinics')
        .select('id')
        .eq('email', email)
        .limit(1);
  
      if (clinicCheckError) {
        throw new Error('Error checking clinic email');
      }
      if (existingClinics.length > 0) {
        return { usedBy: 'clinic' };
      }
    }
  
    return { usedBy: null };
  }
  