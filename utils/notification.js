
import { supabaseAdmin, supabaseUser } from '../supabaseClient.js';

/**
 * Add Notification to Supabase
 * @param {Object} params
 * @param {string} params.user_id - ID of the user
 * @param {string} params.title - Small title
 * @param {string} params.message - Full text
 * @param {string} [params.type='info'] - info | success | error
 * 
 * Note: Notifications are automatically sent to clients via Supabase Realtime
 */
export async function addNotification({ user_id, title, message, type = 'info', token, meta_data }) {
  const { data, error } = await supabaseUser
    .from('notifications')
    .insert([
      {
        user_id,
        title,
        message,
        type,
        is_read: false,
        token,
        meta_data
      }
    ])
    .select()
    .single()

  if (error) {
    console.error("❌ Failed to add notification:", error)
    return { error }
  }

  console.log("✅ Notification added successfully:", data.id)
  console.log("📡 Notification will be sent via Supabase Realtime to user:", user_id)

  return { data }
}

/**
 * Clear all notifications for a specific user
 * @param {string} user_id - ID of the user
 */
export async function clearAllNotificationsByUserId(user_id) {
  const { data, error } = await supabaseUser
    .from('notifications')
    .delete()
    .eq('user_id', user_id)
    .select()

  if (error) {
    console.error("❌ Failed to clear notifications:", error)
    return { error }
  }

  return { data }
}

/**
 * Update a notification
 * @param {string} notificationId - ID of the notification to update
 * @param {Object} updates - Fields to update (e.g., { meta_data: { ... } })
 */
export async function updateNotification(notificationId, updates) {
  const { data, error } = await supabaseUser
    .from('notifications')
    .update(updates)
    .eq('id', notificationId)
    .select()
    .single();

  if (error) {
    console.error("❌ Failed to update notification:", error);
    return { error };
  }

  console.log("✅ Notification updated successfully:", data.id);
  return { data };
}

/**
 * Update notification status in meta_data
 * @param {string} notificationId - ID of the notification
 * @param {string} status - New status (e.g., 'accepted', 'rejected')
 */
export async function updateNotificationStatus(notificationId, status) {
  console.log("------------**************updateNotificationStatus", notificationId, status);
  const { data: notif, error: fetchError } = await supabaseUser
    .from('notifications')
    .select('meta_data')
    .eq('id', notificationId)
    .maybeSingle();

  if (fetchError || !notif) {
    console.error("❌ Failed to fetch notification for status update:", fetchError);
    return { error: fetchError || 'Notification not found' };
  }

  const newMetaData = { ...notif.meta_data, status: status };

  return await updateNotification(notificationId, { meta_data: newMetaData });
}

/**
 * Mark all notifications as read for a specific user
 * @param {string} user_id - ID of the user
 */
export async function markAllNotificationsAsRead(user_id) {
  const { data, error } = await supabaseUser
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user_id)
    .eq('is_read', false)
    .select();

  if (error) {
    console.error("❌ Failed to mark notifications as read:", error);
    return { error };
  }

  console.log(`✅ Marked ${data.length} notifications as read for user:`, user_id);
  return { data };
}

/**
 * Notify treating doctors about new patient assignment
 * @param {Object} params
 * @param {Array<string>} params.treating_doctor_ids - Array of treating doctor IDs
 * @param {string} params.clinic_id - Clinic ID
 * @param {string} params.patient_id - Patient ID
 * @param {string} params.patient_first_name - Patient first name
 * @param {string} params.patient_last_name - Patient last name
 * @param {string} params.clinic_name - Clinic name
 * @param {string} params.added_by - User ID who added the patient
 */
export async function notifyTreatingDoctors({
  treating_doctor_ids,
  clinic_id,
  patient_id,
  patient_first_name,
  patient_last_name,
  clinic_name,
  added_by
}) {
  try {
    // Validate treating doctor IDs
    if (!treating_doctor_ids || !Array.isArray(treating_doctor_ids) || treating_doctor_ids.length === 0) {
      console.log('No treating doctors to notify');
      return { data: [], count: 0 };
    }

    // Get valid treating doctor IDs (those who are clinic members)
    const { data: doctorMemberships, error: doctorCheckError } = await supabaseUser
      .from('user_clinic_roles')
      .select('user_id')
      .eq('clinic_id', clinic_id)
      .in('user_id', treating_doctor_ids);

    if (doctorCheckError) {
      console.error('❌ Failed to validate treating doctors:', doctorCheckError);
      return { error: doctorCheckError };
    }

    const validDoctorIds = doctorMemberships?.map(membership => membership.user_id) || [];

    if (validDoctorIds.length === 0) {
      console.log('No valid treating doctors found');
      return { data: [], count: 0 };
    }

    // Send notifications to treating doctors
    const notificationPromises = validDoctorIds
      .filter(doctorId => doctorId !== added_by) // Exclude the user who added the patient
      .map(doctorId =>
        addNotification({
          user_id: doctorId,
          title: 'New Patient Assigned',
          message: `You have been assigned as treating doctor for ${patient_first_name} ${patient_last_name} in ${clinic_name || 'the clinic'}`,
          type: 'Patient',
          meta_data: {
            patient_id,
            clinic_id,
            patient_name: `${patient_first_name} ${patient_last_name}`,
            added_by,
            action: 'patient_assigned',
            is_treating_doctor: true
          }
        })
      );

    // Wait for all notifications to be sent
    const results = await Promise.all(notificationPromises);
    console.log(`✅ Sent notifications to ${notificationPromises.length} treating doctors about new patient assignment`);

    return { data: results, count: notificationPromises.length };
  } catch (error) {
    console.error('❌ Error in notifyTreatingDoctors:', error);
    return { error };
  }
}

/**
 * Notify user when treating doctor updates patient information
 * @param {Object} params
 * @param {string} params.patient_id - Patient ID
 * @param {string} params.clinic_id - Clinic ID
 * @param {string} params.patient_first_name - Patient first name
 * @param {string} params.patient_last_name - Patient last name
 * @param {string} params.clinic_name - Clinic name
 * @param {string} params.updated_by - User ID who updated the patient (treating doctor)
 * @param {string} params.doctor_first_name - Doctor's first name
 * @param {string} params.doctor_last_name - Doctor's last name
 */
export async function notifyPatientUpdate({
  patient_id,
  clinic_id,
  patient_first_name,
  patient_last_name,
  clinic_name,
  updated_by,
  doctor_first_name,
  doctor_last_name
}) {
  try {
    // Get all clinic members who should be notified (clinic creator and other relevant users)
    const { data: clinicMembers, error: membersError } = await supabaseUser
      .from('user_clinic_roles')
      .select('user_id, role')
      .eq('clinic_id', clinic_id);

    if (membersError) {
      console.error('❌ Failed to fetch clinic members:', membersError);
      return { error: membersError };
    }

    if (!clinicMembers || clinicMembers.length === 0) {
      console.log('No clinic members to notify');
      return { data: [], count: 0 };
    }

    // Get clinic creator
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('created_by')
      .eq('id', clinic_id)
      .single();

    if (clinicError) {
      console.error('❌ Failed to fetch clinic creator:', clinicError);
      return { error: clinicError };
    }

    // Notify clinic creator and full_access users (excluding the doctor who made the update)
    const usersToNotify = clinicMembers
      .filter(member =>
        member.user_id !== updated_by && // Don't notify the doctor who made the update
        (member.user_id === clinic.created_by || member.role === 'full_access')
      )
      .map(member => member.user_id);

    if (usersToNotify.length === 0) {
      console.log('No users to notify about patient update');
      return { data: [], count: 0 };
    }

    // Send notifications
    const notificationPromises = usersToNotify.map(userId =>
      addNotification({
        user_id: userId,
        title: 'Patient Information Updated',
        message: `Dr. ${doctor_first_name} ${doctor_last_name} updated information for patient ${patient_first_name} ${patient_last_name} in ${clinic_name || 'the clinic'}`,
        type: 'Patient',
        meta_data: {
          patient_id,
          clinic_id,
          patient_name: `${patient_first_name} ${patient_last_name}`,
          updated_by,
          doctor_name: `${doctor_first_name} ${doctor_last_name}`,
          action: 'patient_updated'
        }
      })
    );

    // Wait for all notifications to be sent
    const results = await Promise.all(notificationPromises);
    console.log(`✅ Sent notifications to ${notificationPromises.length} users about patient update`);

    return { data: results, count: notificationPromises.length };
  } catch (error) {
    console.error('❌ Error in notifyPatientUpdate:', error);
    return { error };
  }
}