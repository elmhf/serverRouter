import { supabaseAdmin, supabaseUser } from '../supabaseClient.js';
import jwt from 'jsonwebtoken';
import { createTransport } from 'nodemailer';
import { hasPermission, isClinicCreator } from '../utils/permissionUtils.js';
import { addNotification, updateNotification, updateNotificationStatus } from '../utils/notification.js';

export async function createClinic(req, res) {
  // Get userId from auth middleware
  const userId = req.user?.id;
  const clinicData = req.body.clinicData;
  console.log("clinicData", clinicData);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // Step 1: Create the new clinic
    const { data: clinic, error: clinicError } = await supabaseUser
      .from("clinics")
      .insert([
        {
          ...clinicData,
          created_by: userId,
        },
      ])
      .select()
      .maybeSingle();
    console.log("clinic", clinic);
    console.log("clinicError", clinicError);
    if (clinicError) {
      console.log("clinicError", clinicError);
      return res.status(400).json({ error: clinicError.message });
    }
    // Step 2: Assign user as admin in user_clinic_roles
    const { error: roleError } = await supabaseUser
      .from("user_clinic_roles")
      .insert([
        {
          user_id: userId,
          clinic_id: clinic.id,
          role: "admin",
          invited_by: userId,
        },
      ]);
    if (roleError) {
      console.log("roleError", roleError);
      return res.status(400).json({ error: roleError.message });
    }
    return res.status(200).json({ message: "Clinic created and user assigned as admin", clinic });
  } catch (err) {
    console.log("err", err);
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}


export const updateClinic = async (req, res) => {
  const { clinicId } = req.params;
  const { name, phone, address, location } = req.body;
  const userId = req.user?.id;

  try {
    const { data, error } = await supabaseUser
      .from('clinics')
      .update({ name, phone, address, location })
      .eq('id', clinicId)
      .eq('created_by', userId)
      .select()
      .maybeSingle();

    if (error) throw error;

    res.json({ clinic: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteClinic = async (req, res) => {
  const { clinicId } = req.params;
  const userId = req.user?.id;

  try {
    // 1. Verify ownership/permission
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('created_by, logo_url, stamp_url')
      .eq('id', clinicId)
      .single();

    if (clinicError || !clinic) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    if (clinic.created_by !== userId) {
      return res.status(403).json({ error: 'Only the clinic creator can delete the clinic' });
    }

    // 2. Clean up Clinic Assets (Logo & Stamp)
    if (clinic.logo_url) {
      const fileName = clinic.logo_url.split('/').pop();
      await supabaseAdmin.storage.from('cliniclogo').remove([fileName]);
    }
    if (clinic.stamp_url) {
      const fileName = clinic.stamp_url.split('/').pop();
      await supabaseAdmin.storage.from('clinicstamp').remove([fileName]);
    }

    // 3. Clean up All Reports Storage
    // Find all patients in this clinic
    const { data: patients } = await supabaseUser
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId);

    if (patients && patients.length > 0) {
      const patientIds = patients.map(p => p.id);

      // Find all reports for these patients
      const { data: reports } = await supabaseUser
        .from('report_ai')
        .select('report_id, raport_type, patient_id')
        .in('patient_id', patientIds);

      if (reports && reports.length > 0) {
        console.log(`🗑️ Cleaning up storage for ${reports.length} reports in deleted clinic`);

        for (const report of reports) {
          const reportPath = `${clinicId}/${report.patient_id}/${report.raport_type}/${report.report_id}`;

          // List files in report folder
          const { data: files } = await supabaseUser.storage
            .from('reports')
            .list(reportPath);

          if (files && files.length > 0) {
            const filesToRemove = files.map(f => `${reportPath}/${f.name}`);
            await supabaseUser.storage
              .from('reports')
              .remove(filesToRemove);
          }
        }
      }
    }

    // 4. Delete Clinic (Cascade will handle patients, reports, roles, etc.)
    const { error } = await supabaseUser
      .from('clinics')
      .delete()
      .eq('id', clinicId);

    if (error) throw error;

    res.status(200).json({ message: 'Clinic and all associated data deleted successfully' });
  } catch (err) {
    console.error('Delete clinic error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getUserClinics = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // Get all clinic_ids where user is a member (admin or other role)
    const { data: userClinics, error: userClinicsError } = await supabaseUser
      .from('user_clinic_roles')
      .select('clinic_id')
      .eq('user_id', userId);
    if (userClinicsError) {
      return res.status(400).json({ error: userClinicsError.message });
    }
    const clinicIds = userClinics.map(uc => uc.clinic_id);
    if (clinicIds.length === 0) {
      return res.status(200).json({ clinics: [] });
    }
    // Fetch clinic data for those IDs
    const { data: clinics, error: clinicsError } = await supabaseUser
      .from('clinics')
      .select('*')
      .in('id', clinicIds);
    if (clinicsError) {
      return res.status(400).json({ error: clinicsError.message });
    }
    return res.status(200).json({ clinics });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
};

export const updateClinicEmail = async (req, res) => {
  const { email, clinicId } = req.body.clinicData;
  const userId = req.user?.id;
  console.log("updateClinicEmail----------------", email, clinicId);
  console.log("req.body", req.body);

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to edit clinic
    const canEditClinic = await hasPermission(userId, clinicId, 'edit_clinic');
    console.log("isCreator", isCreator);
    console.log("canEditClinic", canEditClinic);

    if (!isCreator && !canEditClinic) {
      return res.status(403).json({
        error: 'You do not have permission to update clinic email'
      });
    }

    const { data, error } = await supabaseUser
      .from('clinics')
      .update({ email })
      .eq('id', clinicId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Failed to update clinic' });
    }
    if (!data) {
      return res.status(404).json({ error: 'Clinic not found' });
    }
    res.json({ clinic: data });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const updateClinicPhone = async (req, res) => {
  const { clinicId, phone } = req.body;
  const userId = req.user?.id;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to edit clinic
    const canEditClinic = await hasPermission(userId, clinicId, 'edit_clinic');

    if (!isCreator && !canEditClinic) {
      return res.status(403).json({
        error: 'You do not have permission to update clinic phone'
      });
    }

    const { data, error } = await supabaseUser
      .from('clinics')
      .update({ phone })
      .eq('id', clinicId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Failed to update clinic' });
    }
    if (!data) {
      return res.status(404).json({ error: 'Clinic not found' });
    }
    res.json({ clinic: data });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const updateClinicInfo = async (req, res) => {
  console.log("updateClinicInfo----------------", req.body);
  const {
    clinicId,
    clinic_name,
    street_address,
    neighbourhood,
    city,
    postal_code,
    country,
    website
  } = req.body;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to edit clinic
    const canEditClinic = await hasPermission(userId, clinicId, 'edit_clinic');

    if (!isCreator && !canEditClinic) {
      return res.status(403).json({
        error: 'You do not have permission to update clinic information'
      });
    }

    const { data, error } = await supabaseUser
      .from('clinics')
      .update({
        clinic_name,
        street_address,
        neighbourhood,
        city,
        postal_code,
        country,
        website
      })
      .eq('id', clinicId)
      .select()
      .maybeSingle();
    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Failed to update clinic' });
    }
    if (!data) {
      return res.status(404).json({ error: 'Clinic not found or you do not have permission' });
    }
    res.json({ clinic: data });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const changeClinicLogo = async (req, res) => {
  console.log("changeClinicLogo----------------", req.body);
  const { clinicId } = req.body;
  const userId = req.user?.id;

  if (!req.file) {
    return res.status(400).json({ error: 'Logo image is required' });
  }

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // Check if user has admin/owner role or is the clinic creator
    const { data: userAccess, error: accessError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('clinic_id', clinicId)
      .eq('user_id', userId)
      .maybeSingle();

    if (accessError) {
      console.error('Access check error:', accessError);
      return res.status(500).json({ error: 'Database error' });
    }

    // Check if user is clinic creator or has admin/owner role
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('created_by')
      .eq('id', clinicId)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic check error:', clinicError);
      return res.status(500).json({ error: 'Database error' });
    }

    const isCreator = clinic.created_by === userId;
    const hasAdminRole = userAccess && (userAccess.role === 'admin' || userAccess.role === 'owner');

    if (!isCreator && !hasAdminRole) {
      return res.status(403).json({
        error: 'Only clinic creators, administrators, and owners can change clinic logo'
      });
    }

    // 1. Fetch clinic and get old logo_url
    const { data: clinicCheck, error: checkError } = await supabaseUser
      .from('clinics')
      .select('id, logo_url')
      .eq('id', clinicId)
      .maybeSingle();

    if (checkError) {
      console.error('Check error:', checkError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!clinicCheck) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    const oldLogoUrl = clinicCheck.logo_url;

    // 2. Delete old logo from storage (if exists)
    if (oldLogoUrl) {
      // Extract filename from URL (e.g., "123-1234567890.png")
      const urlParts = oldLogoUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      const { error: removeError } = await supabaseAdmin.storage
        .from('cliniclogo')
        .remove([fileName]);

      if (removeError) {
        console.warn('Failed to delete old logo:', removeError.message);
      }
    }

    // 3. Upload new logo
    const fileName = `${clinicId}-${Date.now()}.png`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('cliniclogo')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600'
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload image' });
    }

    // 4. Get public URL of new logo
    const { data: { publicUrl } } = supabaseUser.storage
      .from('cliniclogo')
      .getPublicUrl(fileName);

    // 5. Update clinic with new logo URL
    const { data: updatedClinic, error: updateError } = await supabaseUser
      .from('clinics')
      .update({
        logo_url: publicUrl
      })
      .eq('id', clinicId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update clinic' });
    }

    if (!updatedClinic) {
      return res.status(404).json({ error: 'Clinic not found or you do not have permission' });
    }

    res.json({
      message: 'Clinic logo updated successfully',
      clinic: updatedClinic
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const changeStampClinic = async (req, res) => {
  console.log("changeStampClinic----------------", req.body);
  const { clinicId } = req.body;
  const userId = req.user?.id;

  if (!req.file) {
    return res.status(400).json({ error: 'Stamp image is required' });
  }

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // Check if user has admin/owner role or is the clinic creator
    const { data: userAccess, error: accessError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('clinic_id', clinicId)
      .eq('user_id', userId)
      .maybeSingle();

    if (accessError) {
      console.error('Access check error:', accessError);
      return res.status(500).json({ error: 'Database error' });
    }

    // Check if user is clinic creator or has admin/owner role
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('created_by')
      .eq('id', clinicId)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic check error:', clinicError);
      return res.status(500).json({ error: 'Database error' });
    }

    const isCreator = clinic.created_by === userId;
    const hasAdminRole = userAccess && (userAccess.role === 'admin' || userAccess.role === 'owner');

    if (!isCreator && !hasAdminRole) {
      return res.status(403).json({
        error: 'Only clinic creators, administrators, and owners can change clinic stamp'
      });
    }

    // 1. Fetch clinic and get old stamp_url
    const { data: clinicCheck, error: checkError } = await supabaseUser
      .from('clinics')
      .select('id, stamp_url')
      .eq('id', clinicId)
      .maybeSingle();
    console.log("clinicCheck", clinicCheck);
    if (checkError) {
      console.error('Check error:', checkError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!clinicCheck) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    const oldStampUrl = clinicCheck.stamp_url;

    // 2. Delete old stamp from storage (if exists)
    if (oldStampUrl) {
      // Extract filename from URL (e.g., "123-1234567890.png")
      const urlParts = oldStampUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];

      const { error: removeError } = await supabaseAdmin.storage
        .from('clinicstamp')
        .remove([fileName]);

      if (removeError) {
        console.warn('Failed to delete old stamp:', removeError.message);
      }
    }

    // 3. Upload new stamp
    const fileName = `${clinicId}-${Date.now()}.png`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('clinicstamp')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600'
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload stamp image' });
    }

    // 4. Get public URL of new stamp
    const { data: { publicUrl } } = supabaseUser.storage
      .from('clinicstamp')
      .getPublicUrl(fileName);

    // 5. Update clinic with new stamp URL
    const { data: updatedClinic, error: updateError } = await supabaseUser
      .from('clinics')
      .update({
        stamp_url: publicUrl
      })
      .eq('id', clinicId)
      .select()
      .maybeSingle();
    console.log("updatedClinic", publicUrl);
    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update clinic' });
    }

    if (!updatedClinic) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    res.json({
      message: 'Clinic stamp updated successfully',
      clinic: updatedClinic
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getClinicMembers = async (req, res) => {
  const { clinicId } = req.body;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to view all users
    const canViewAllUsers = await hasPermission(userId, clinicId, 'view_all_users');
    if (!isCreator && !canViewAllUsers) {
      return res.status(403).json({
        error: 'You do not have permission to view members for this clinic'
      });
    }

    // Get all members of the clinic with their details
    const { data: members, error: membersError } = await supabaseUser
      .from('user_clinic_roles')
      .select(`
        id,
        role,
        status,
        created_at,
        joined_at,
        invited_by,
        user_id,
        user:user_id (
          id,
          firstName,
          lastName,
          email,
          profilePhotoUrl,
          personalSignature
        )
      `)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });

    if (membersError) {
      console.error('Members fetch error:', membersError);
      return res.status(500).json({ error: 'Failed to fetch clinic members' });
    }

    // Transform the data to a cleaner format
    const transformedMembers = members.map(member => ({
      id: member.id,
      role: member.role,
      status: member.status,
      joinedAt: member.joined_at,
      invitedBy: member.invited_by,
      createdAt: member.created_at,
      user_id: member.user_id,
      user: {
        id: member.user?.id,
        firstName: member.user?.firstName,
        lastName: member.user?.lastName,
        email: member.user?.email,
        profilePhotoUrl: member.user?.profilePhotoUrl,
        personalSignature: member.user?.personalSignature
      }
    }));

    res.json({
      message: 'Clinic members retrieved successfully',
      members: transformedMembers,
      totalMembers: transformedMembers.length
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getClinicInvitationMembers = async (req, res) => {
  console.log("getClinicInvitationMembers----------------");
  const { clinicId } = req.body;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to view all invitations
    const canViewAllInvitations = await hasPermission(userId, clinicId, 'view_all_invitation');

    if (!isCreator && !canViewAllInvitations) {
      return res.status(403).json({
        error: 'You do not have permission to view invitations for this clinic'
      });
    }

    // Get all pending invitations for the clinic
    const { data: invitations, error: invitationsError } = await supabaseUser
      .from('clinic_invitations')
      .select(`
        id,
        clinic_id,
        email,
        status,
        role,
        created_at,
        expires_at
      `)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });

    if (invitationsError) {
      console.error('Invitations fetch error:', invitationsError);
      return res.status(500).json({ error: 'Failed to fetch clinic invitations' });
    }

    // Transform the data to a cleaner format
    const transformedInvitations = invitations.map(invitation => ({
      id: invitation.id,
      clinicId: invitation.clinic_id,
      email: invitation.email,
      status: invitation.status,
      createdAt: invitation.created_at,
      role: invitation.role,
      expiresAt: invitation.expires_at
    }));

    res.json({
      message: 'Clinic invitations retrieved successfully',
      invitations: transformedInvitations,
      totalInvitations: transformedInvitations.length
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const deleteClinicInvitation = async (req, res) => {
  console.log("deleteClinicInvitation----------------", req.body);
  const { clinicId, invitationId } = req.body;
  const userId = req.user?.id;

  if (!clinicId || !invitationId) {
    return res.status(400).json({ error: 'Clinic ID and invitation ID are required' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to delete invitations
    const canDeleteInvitation = await hasPermission(userId, clinicId, 'delete_invitation');

    if (!isCreator && !canDeleteInvitation) {
      return res.status(403).json({
        error: 'You do not have permission to delete invitations from this clinic'
      });
    }

    // 3. Check if the invitation exists and belongs to this clinic
    const { data: invitation, error: invitationCheckError } = await supabaseUser
      .from('clinic_invitations')
      .select('id, email, status, role')
      .eq('id', invitationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (invitationCheckError) {
      console.error('Invitation check error:', invitationCheckError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found in this clinic' });
    }

    // 4. Check if the invitation is still pending (not accepted/rejected)
    if (invitation.status !== 'invited') {
      return res.status(400).json({
        error: 'Cannot delete invitation that has already been processed (accepted/rejected)'
      });
    }

    // 5. Delete the invitation
    const { error: deleteError } = await supabaseUser
      .from('clinic_invitations')
      .delete()
      .eq('id', invitationId)
      .eq('clinic_id', clinicId);

    if (deleteError) {
      console.error('Delete invitation error:', deleteError);
      return res.status(500).json({ error: 'Failed to delete invitation' });
    }

    // 6. Get clinic name for response
    const { data: clinicInfo, error: clinicInfoError } = await supabaseUser
      .from('clinics')
      .select('clinic_name')
      .eq('id', clinicId)
      .maybeSingle();

    res.json({
      message: 'Invitation deleted successfully',
      deletedInvitation: {
        id: invitationId,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status
      },
      clinic: {
        id: clinicId,
        name: clinicInfo?.clinic_name || 'Unknown Clinic'
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const inviteClinicMember = async (req, res) => {
  const { clinicId, email, role = 'assistant_access' } = req.body;
  const userId = req.user?.id;

  if (!clinicId || !email) {
    return res.status(400).json({ error: 'Clinic ID and email are required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate role
  const validRoles = ['limited_access', 'clinic_access', 'assistant_access', 'full_access'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Valid roles are: limited_access, clinic_access, assistant_access, full_access' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to add members
    const canAddMember = await hasPermission(userId, clinicId, 'add_member');

    // 3. Check if user has permission to add admin members (for full_access and clinic_access roles)
    const canAddAdminMember = await hasPermission(userId, clinicId, 'add_admin_member');

    console.log("canAddMember", canAddMember);
    console.log("canAddAdminMember", canAddAdminMember);
    console.log("isCreator", isCreator);

    // Check basic permission to invite members
    if (!isCreator && !canAddMember) {
      return res.status(403).json({
        error: 'You do not have permission to invite members to this clinic'
      });
    }

    // Check permission for admin-level roles (full_access, clinic_access)
    if ((role === 'full_access' || role === 'clinic_access') && !isCreator && !canAddAdminMember) {
      return res.status(403).json({
        error: 'You do not have permission to invite admin-level'
      });
    }

    // 2. Check if user is already a member of this clinic
    const { data: existingUser, error: userCheckError } = await supabaseUser
      .from('user')
      .select('id, user_id')
      .eq('email', email)
      .maybeSingle();

    if (userCheckError) {
      console.error('User check error:', userCheckError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingUser) {
      // Check if user is already a member
      const { data: existingMember, error: memberCheckError } = await supabaseUser
        .from('user_clinic_roles')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('user_id', existingUser.user_id)
        .maybeSingle();

      if (memberCheckError) {
        console.error('Member check error:', memberCheckError);
        return res.status(500).json({ error: 'Database error' });
      }

      if (existingMember) {
        return res.status(400).json({ error: 'User is already a member of this clinic' });
      }
    }

    // 3. Check if there's already a pending invitation for this email and clinic
    const { data: existingInvitation, error: invitationCheckError } = await supabaseUser
      .from('clinic_invitations')
      .select('id, status')
      .eq('clinic_id', clinicId)
      .eq('email', email)
      .eq('status', 'invited')
      .maybeSingle();

    if (invitationCheckError) {
      console.error('Invitation check error:', invitationCheckError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingInvitation) {
      return res.status(400).json({ error: 'An invitation has already been sent to this email' });
    }

    // 4. Generate JWT token for invitation
    const invitationToken = jwt.sign(
      {
        clinicId,
        email,
        role,
        invitedBy: userId,
        type: 'clinic_invitation'
      },
      process.env.JWT_SECRET || "43513e03963af80a1bd1dc5a27a8ddca",
      { expiresIn: '7d' }
    );

    // 5. Create invitation record
    const { data: invitation, error: invitationError } = await supabaseUser
      .from('clinic_invitations')
      .insert([
        {
          clinic_id: clinicId,
          email: email,
          token: invitationToken,
          status: 'invited',
          role: role,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
        }
      ])
      .select()
      .maybeSingle();

    if (invitationError) {
      console.error('Invitation creation error:', invitationError);
      return res.status(500).json({ error: 'Failed to create invitation' });
    }

    // 6. Get clinic details for email
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('*')
      .eq('id', clinicId)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic fetch error:', clinicError);
      return res.status(500).json({ error: 'Failed to fetch clinic details' });
    }

    // 7. Send invitation email (you can implement this based on your email service)
    try {
      // Setup email transporter
      const transporter = createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        }, tls: {
          rejectUnauthorized: false // يخلي الاتصال يتجاوز self-signed error
        }
      });

      // Create invitation link
      const invitationLink = `${0 || 'http://localhost:3000'}/accept-invitation?token=${invitationToken}`;

      // Email content
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Invitation to Join Clinic</h2>
          <p>Hello,</p>
          <p>You have been invited to join <strong>${clinic.clinic_name}</strong> as a <strong>${role}</strong>.</p>
          <p>Click the button below to accept the invitation:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${invitationLink}" 
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Accept Invitation
            </a>
          </div>
          <p>Or copy and paste this link in your browser:</p>
          <p style="word-break: break-all; color: #666;">${invitationLink}</p>
          <p>This invitation will expire in 7 days.</p>
          <p>If you didn't expect this invitation, please ignore this email.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">
            This is an automated message from the clinic management system.
          </p>
        </div>
      `;

      const emailText = `
        Invitation to Join Clinic
        
        Hello,
        
        You have been invited to join ${clinic.clinic_name} as a ${role}.
        
        To accept the invitation, visit this link:
        ${invitationLink}
        
        This invitation will expire in 7 days.
        
        If you didn't expect this invitation, please ignore this email.
      `;

      // Send email
      await transporter.sendMail({
        from: `"Clinic Management System" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Invitation to Join ${clinic.clinic_name}`,
        text: emailText,
        html: emailHtml,
      });

      console.log('Invitation email sent successfully to:', email);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // Don't fail the request if email fails, just log it
    }

    await addNotification({
      user_id: existingUser.user_id,
      title: "invitaion",
      message: "gsggsggsg",
      type: "invitation",
      token: invitationToken,
      meta_data: {
        clinic_name: clinic.clinic_name,
        logo_url: clinic.logo_url,
        role: role

      }
      // ✅ شلنا io - الآن يعتمد 100% على Supabase Realtime
    })
    console.log(clinic.logo_url, "*************clinic.logo_url*************")
    res.json({
      message: 'Invitation sent successfully',
      invitation: {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expires_at,
        clinicName: clinic.clinic_name
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const validateInvitation = async (req, res) => {
  const { token } = req.body;
  const userId = req.user?.id;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized - User not authenticated' });
  }

  try {
    // 1. Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "43513e03963af80a1bd1dc5a27a8ddca");

    if (decoded.type !== 'clinic_invitation') {
      return res.status(400).json({ error: 'Invalid invitation token' });
    }

    // 2. Check if invitation exists and is still valid
    const { data: invitation, error: invitationError } = await supabaseUser
      .from('clinic_invitations')
      .select(`
        id,
        clinic_id,
        email,
        token,
        status,
        expires_at,
        clinics (
          clinic_name
        )
      `)
      .eq('token', token)
      .eq('status', 'invited')
      .maybeSingle();

    if (invitationError) {
      console.error('Invitation fetch error:', invitationError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }

    // 3. Check if invitation has expired
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);

    if (now > expiresAt) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    // 4. Check if the authenticated user is the one who was invited
    const { data: currentUser, error: userError } = await supabaseUser
      .from('user')
      .select('id, user_id, email')
      .eq('user_id', userId)
      .maybeSingle();

    if (userError) {
      console.error('User check error:', userError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the authenticated user's email matches the invitation email
    if (currentUser.email !== invitation.email) {
      return res.status(403).json({ error: 'You can only validate your own invitations' });
    }

    // 5. Return invitation details
    res.json({
      message: 'Invitation is valid',
      invitation: {
        id: invitation.id,
        clinicId: invitation.clinic_id,
        clinicName: invitation.clinics?.clinic_name,
        email: invitation.email,
        role: decoded.role,
        expiresAt: invitation.expires_at,
        status: invitation.status
      }
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Token has expired' });
    }
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const acceptInvitation = async (req, res) => {
  console.log("acceptInvitation");
  const { token, NotificationId } = req.body;
  const userId = req.user?.id;
  console.log("token NotificationId ", NotificationId, req.body);

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized - User not authenticated' });
  }

  try {
    // 1. Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "43513e03963af80a1bd1dc5a27a8ddca");

    if (decoded.type !== 'clinic_invitation') {
      return res.status(400).json({ error: 'Invalid invitation token' });
    }

    // 2. Check if invitation exists and is still valid
    const { data: invitation, error: invitationError } = await supabaseUser
      .from('clinic_invitations')
      .select(`
        id,
        clinic_id,
        email,
        token,
        status,
        expires_at
      `)
      .eq('token', token)
      .eq('status', 'invited')
      .maybeSingle();

    if (invitationError) {
      console.error('Invitation fetch error:', invitationError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }

    // 3. Check if invitation has expired
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);

    if (now > expiresAt) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    // 4. Check if the authenticated user is the one who was invited
    const { data: currentUser, error: currentUserError } = await supabaseUser
      .from('user')
      .select('id, user_id, email')
      .eq('user_id', userId)
      .maybeSingle();

    if (currentUserError) {
      console.error('Current user check error:', currentUserError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the authenticated user's email matches the invitation email
    if (currentUser.email !== invitation.email) {
      return res.status(403).json({ error: 'You can only accept your own invitations' });
    }

    // 6. Add user to clinic with the specified role
    const { error: roleError } = await supabaseUser
      .from('user_clinic_roles')
      .insert([
        {
          user_id: currentUser.user_id,
          clinic_id: invitation.clinic_id,
          role: decoded.role,
          invited_by: decoded.invitedBy,
          status: 'accepted',
          joined_at: new Date().toISOString()
        }
      ]);

    if (roleError) {
      console.error('Role assignment error:', roleError);
      return res.status(500).json({ error: 'Failed to add user to clinic' });
    }

    // 7. Update invitation status to accepted
    const { error: updateError } = await supabaseUser
      .from('clinic_invitations')
      .update({ status: 'accepted' })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Invitation update error:', updateError);
      return res.status(500).json({ error: 'Failed to update invitation status' });
    }

    // 8. Update notification status if NotificationId is provided
    if (NotificationId) {
      await updateNotificationStatus(NotificationId, 'accepted');
    }

    res.json({
      message: 'Invitation accepted successfully',
      user: {
        id: currentUser.id,
        email: currentUser.email
      },
      clinic: {
        id: invitation.clinic_id,
        role: decoded.role
      }
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Token has expired' });
    }
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const rejectInvitation = async (req, res) => {
  const { token, NotificationId } = req.body;
  const userId = req.user?.id;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized - User not authenticated' });
  }

  try {
    // 1. Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "43513e03963af80a1bd1dc5a27a8ddca");

    if (decoded.type !== 'clinic_invitation') {
      return res.status(400).json({ error: 'Invalid invitation token' });
    }

    // 2. Check if invitation exists and is still valid
    const { data: invitation, error: invitationError } = await supabaseUser
      .from('clinic_invitations')
      .select(`
        id,
        clinic_id,
        email,
        token,
        status,
        expires_at
      `)
      .eq('token', token)
      .eq('status', 'invited')
      .maybeSingle();

    if (invitationError) {
      console.error('Invitation fetch error:', invitationError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }

    // 3. Check if invitation has expired
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);

    if (now > expiresAt) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    // 4. Check if the authenticated user is the one who was invited
    const { data: currentUser, error: currentUserError } = await supabaseUser
      .from('user')
      .select('id, user_id, email')
      .eq('user_id', userId)
      .maybeSingle();

    if (currentUserError) {
      console.error('Current user check error:', currentUserError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if the authenticated user's email matches the invitation email
    if (currentUser.email !== invitation.email) {
      return res.status(403).json({ error: 'You can only reject your own invitations' });
    }

    // 5. Update invitation status to rejected
    const { error: updateError } = await supabaseUser
      .from('clinic_invitations')
      .update({ status: 'rejected' })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Invitation update error:', updateError);
      return res.status(500).json({ error: 'Failed to update invitation status' });
    }

    // 6. Update notification status if NotificationId is provided
    if (NotificationId) {
      await updateNotificationStatus(NotificationId, 'rejected');
    }



    res.json({
      message: 'Invitation rejected successfully',
      invitation: {
        id: invitation.id,
        email: invitation.email,
        status: 'rejected'
      }
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Token has expired' });
    }
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const deleteClinicMember = async (req, res) => {
  const { clinicId, memberId } = req.body;
  const userId = req.user?.id;

  if (!clinicId || !memberId) {
    return res.status(400).json({ error: 'Clinic ID and member ID are required' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to delete members
    const canDeleteMember = await hasPermission(userId, clinicId, 'delete_member');

    if (!isCreator && !canDeleteMember) {
      return res.status(403).json({
        error: 'You do not have permission to delete members from this clinic'
      });
    }

    // 3. Check if the member to be deleted exists in this clinic
    const { data: memberToDelete, error: memberCheckError } = await supabaseUser
      .from('user_clinic_roles')
      .select('id, role, user_id')
      .eq('clinic_id', clinicId)
      .eq('user_id', memberId)
      .maybeSingle();

    if (memberCheckError) {
      console.error('Member check error:', memberCheckError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!memberToDelete) {
      return res.status(404).json({ error: 'Member not found in this clinic' });
    }

    // 4. Prevent deleting the clinic creator
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('created_by')
      .eq('id', clinicId)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic check error:', clinicError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (clinic.created_by === memberId) {
      return res.status(400).json({
        error: 'Cannot delete the clinic creator. Please transfer ownership first.'
      });
    }

    // 5. Prevent users from deleting themselves (they should use leaveClinic instead)
    if (userId === memberId) {
      return res.status(400).json({
        error: 'You cannot delete yourself. Please use the leave clinic function instead.'
      });
    }

    // 6. Check if the user trying to delete has higher role than the member being deleted
    const { data: currentUserRole, error: currentUserRoleError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('clinic_id', clinicId)
      .eq('user_id', userId)
      .maybeSingle();

    if (currentUserRoleError) {
      console.error('Current user role check error:', currentUserRoleError);
      return res.status(500).json({ error: 'Database error' });
    }

    // Define role hierarchy (higher index = higher role)
    const roleHierarchy = ['assistant_access', 'limited_access', 'clinic_access', 'full_access'];

    const currentUserRoleIndex = roleHierarchy.indexOf(currentUserRole?.role || 'assistant_access');
    const memberRoleIndex = roleHierarchy.indexOf(memberToDelete.role || 'assistant_access');

    // Only allow deletion if current user has higher or equal role
    if (currentUserRoleIndex < memberRoleIndex) {
      return res.status(403).json({
        error: 'You can only delete members with equal or lower role than yours'
      });
    }

    // 7. Get member details for response
    const { data: memberDetails, error: memberDetailsError } = await supabaseUser
      .from('user')
      .select('firstName, lastName, email')
      .eq('user_id', memberId)
      .maybeSingle();

    // 8. Delete the member from clinic
    const { error: deleteError } = await supabaseUser
      .from('user_clinic_roles')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('user_id', memberId);

    if (deleteError) {
      console.error('Delete member error:', deleteError);
      return res.status(500).json({ error: 'Failed to delete member from clinic' });
    }

    // 9. Get clinic name for response
    const { data: clinicInfo, error: clinicInfoError } = await supabaseUser
      .from('clinics')
      .select('clinic_name')
      .eq('id', clinicId)
      .maybeSingle();

    res.json({
      message: 'Member deleted successfully from clinic',
      deletedMember: {
        id: memberId,
        firstName: memberDetails?.firstName,
        lastName: memberDetails?.lastName,
        email: memberDetails?.email,
        role: memberToDelete.role
      },
      clinic: {
        id: clinicId,
        name: clinicInfo?.clinic_name || 'Unknown Clinic'
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const leaveClinic = async (req, res) => {
  const { clinicId, action, newOwnerId } = req.body;
  const userId = req.user?.id;

  console.log('leaveClinic----------------', { clinicId, action, newOwnerId, userId });

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  // Validate action if provided
  if (action && !['delete', 'transfer'].includes(action)) {
    return res.status(400).json({
      error: 'Invalid action. Valid actions are: delete, transfer'
    });
  }

  // Validate newOwnerId if action is transfer
  if (action === 'transfer' && !newOwnerId) {
    return res.status(400).json({
      error: 'newOwnerId is required when action is transfer'
    });
  }

  try {
    // 1. Check if the user is a member of this clinic
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('id, role, status')
      .eq('clinic_id', clinicId)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!userMembership) {
      return res.status(404).json({ error: 'You are not a member of this clinic' });
    }

    // 2. Check if user is the clinic creator (owner)
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('id, created_by, clinic_name')
      .eq('id', clinicId)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic check error:', clinicError);
      return res.status(500).json({ error: 'Database error' });
    }

    const isOwner = clinic.created_by === userId;

    // 3. Handle owner leaving
    if (isOwner) {
      if (!action) {
        // No action specified - return error with options
        return res.status(400).json({
          error: 'As the clinic owner, you must specify an action when leaving.',
          options: {
            delete: 'Set action=delete to delete the clinic',
            transfer: 'Set action=transfer and provide newOwnerId to transfer ownership'
          }
        });
      }

      if (action === 'delete') {
        // Delete the clinic
        const { error: deleteClinicError } = await supabaseUser
          .from('clinics')
          .delete()
          .eq('id', clinicId)
          .eq('created_by', userId);

        if (deleteClinicError) {
          console.error('Delete clinic error:', deleteClinicError);
          return res.status(500).json({ error: 'Failed to delete clinic' });
        }

        console.log(`Clinic ${clinicId} deleted by owner ${userId}`);

        return res.json({
          message: 'Clinic deleted successfully',
          clinic: {
            id: clinicId,
            name: clinic.clinic_name
          }
        });
      }

      if (action === 'transfer') {
        // Verify the new owner is a member of the clinic
        const { data: newOwnerMembership, error: newOwnerError } = await supabaseUser
          .from('user_clinic_roles')
          .select('id, user_id, role, status')
          .eq('clinic_id', clinicId)
          .eq('user_id', newOwnerId)
          .maybeSingle();

        if (newOwnerError) {
          console.error('New owner check error:', newOwnerError);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!newOwnerMembership) {
          return res.status(404).json({
            error: 'New owner is not a member of this clinic'
          });
        }


        // Transfer ownership
        const { error: transferError } = await supabaseUser
          .from('clinics')
          .update({ created_by: newOwnerId })
          .eq('id', clinicId)
          .eq('created_by', userId);

        if (transferError) {
          console.error('Transfer error:', transferError);
          return res.status(500).json({ error: 'Failed to transfer ownership' });
        }

        // Update new owner's role to full_access if needed
        if (newOwnerMembership.role !== 'admin' && newOwnerMembership.role !== 'full_access') {
          await supabaseUser
            .from('user_clinic_roles')
            .update({ role: 'full_access' })
            .eq('clinic_id', clinicId)
            .eq('user_id', newOwnerId);
        }

        // Remove old owner from members
        const { error: removeError } = await supabaseUser
          .from('user_clinic_roles')
          .delete()
          .eq('clinic_id', clinicId)
          .eq('user_id', userId);

        if (removeError) {
          console.error('Remove old owner error:', removeError);
          return res.status(500).json({ error: 'Failed to remove from clinic' });
        }

        // Get new owner details
        const { data: newOwnerDetails } = await supabaseUser
          .from('user')
          .select('firstName, lastName, email')
          .eq('user_id', newOwnerId)
          .maybeSingle();

        console.log(`Ownership transferred from ${userId} to ${newOwnerId} for clinic ${clinicId}`);

        return res.json({
          message: 'Ownership transferred and you left the clinic successfully',
          clinic: {
            id: clinicId,
            name: clinic.clinic_name
          },
          newOwner: {
            id: newOwnerId,
            firstName: newOwnerDetails?.firstName,
            lastName: newOwnerDetails?.lastName,
            email: newOwnerDetails?.email
          }
        });
      }
    }

    // 4. Non-owner leaving - standard flow
    const { error: deleteError } = await supabaseUser
      .from('user_clinic_roles')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Delete membership error:', deleteError);
      return res.status(500).json({ error: 'Failed to leave clinic' });
    }

    console.log(`User ${userId} left clinic ${clinicId}`);

    res.json({
      message: 'Successfully left the clinic',
      clinic: {
        id: clinicId,
        name: clinic.clinic_name,
        role: userMembership.role
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const changeMemberRole = async (req, res) => {
  const { clinicId, memberId, newRole } = req.body;
  const userId = req.user?.id;
  console.log("changeMemberRole----------------", memberId, newRole, req.body);

  if (!clinicId || !memberId || !newRole) {
    return res.status(400).json({ error: 'Clinic ID, member ID, and new role are required' });
  }

  // Validate role
  const validRoles = ['limited_access', 'clinic_access', 'assistant_access', 'full_access'];
  if (!validRoles.includes(newRole)) {
    return res.status(400).json({ error: 'Invalid role. Valid roles are: limited_access clinic_access assistant_access full_access' });
  }

  try {
    // 1. Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);

    // 2. Check if user has permission to change roles
    const canChangeRole = await hasPermission(userId, clinicId, 'change_role');

    if (!isCreator && !canChangeRole) {
      return res.status(403).json({
        error: 'You do not have permission to change member roles in this clinic'
      });
    }

    // 3. Check if the member exists in this clinic
    const { data: memberToChange, error: memberCheckError } = await supabaseUser
      .from('user_clinic_roles')
      .select('id, role, user_id')
      .eq('clinic_id', clinicId)
      .eq('user_id', memberId)
      .maybeSingle();

    if (memberCheckError) {
      console.error('Member check error:', memberCheckError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!memberToChange) {
      return res.status(404).json({ error: 'Member not found in this clinic' });
    }

    // 4. Prevent changing the clinic creator's role
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('created_by')
      .eq('id', clinicId)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic check error:', clinicError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (clinic.created_by === memberId) {
      return res.status(400).json({
        error: 'Cannot change the clinic creator\'s role. Please transfer ownership first.'
      });
    }

    // 5. Prevent users from changing their own role
    if (userId === memberId) {
      return res.status(400).json({
        error: 'You cannot change your own role. Please ask another administrator.'
      });
    }

    // 6. Check if the user trying to change role has higher role than the member being changed
    const { data: currentUserRole, error: currentUserRoleError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('clinic_id', clinicId)
      .eq('user_id', userId)
      .maybeSingle();

    if (currentUserRoleError) {
      console.error('Current user role check error:', currentUserRoleError);
      return res.status(500).json({ error: 'Database error' });
    }

    // Define role hierarchy (higher index = higher role)
    const roleHierarchy = ['assistant_access', 'limited_access', 'clinic_access', 'full_access'];

    const currentUserRoleIndex = roleHierarchy.indexOf(currentUserRole?.role || 'assistant_access');
    const memberRoleIndex = roleHierarchy.indexOf(memberToChange.role || 'assistant_access');

    // Only allow role change if current user has higher role
    if (currentUserRoleIndex <= memberRoleIndex) {
      return res.status(403).json({
        error: 'You can only change roles of members with lower role than yours'
      });
    }

    // 7. Get member details for response
    const { data: memberDetails, error: memberDetailsError } = await supabaseUser
      .from('user')
      .select('firstName, lastName, email')
      .eq('user_id', memberId)
      .maybeSingle();

    // 8. Update the member's role
    const { data: updatedMember, error: updateError } = await supabaseUser
      .from('user_clinic_roles')
      .update({ role: newRole })
      .eq('clinic_id', clinicId)
      .eq('user_id', memberId)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('Update role error:', updateError);
      return res.status(500).json({ error: 'Failed to update member role' });
    }

    // 9. Get clinic name for response
    const { data: clinicInfo, error: clinicInfoError } = await supabaseUser
      .from('clinics')
      .select('clinic_name')
      .eq('id', clinicId)
      .maybeSingle();

    res.json({
      message: 'Member role updated successfully',
      member: {
        id: memberId,
        firstName: memberDetails?.firstName,
        lastName: memberDetails?.lastName,
        email: memberDetails?.email,
        oldRole: memberToChange.role,
        newRole: newRole
      },
      clinic: {
        id: clinicId,
        name: clinicInfo?.clinic_name || 'Unknown Clinic'
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Transfer clinic ownership to another member
export const transferClinicOwnership = async (req, res) => {
  const { clinicId, newOwnerId } = req.body;
  const userId = req.user?.id;

  console.log('transferClinicOwnership----------------', { clinicId, newOwnerId, userId });

  if (!clinicId || !newOwnerId) {
    return res.status(400).json({ error: 'Clinic ID and new owner ID are required' });
  }

  if (userId === newOwnerId) {
    return res.status(400).json({ error: 'You are already the owner of this clinic' });
  }

  try {
    // 1. Verify current user is the clinic owner (created_by)
    const { data: clinic, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('id, created_by, clinic_name')
      .eq('id', clinicId)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic check error:', clinicError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!clinic) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    if (clinic.created_by !== userId) {
      return res.status(403).json({
        error: 'Only the clinic owner can transfer ownership'
      });
    }

    // 2. Verify the new owner is a member of the clinic
    const { data: newOwnerMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('id, user_id, role, status')
      .eq('clinic_id', clinicId)
      .eq('user_id', newOwnerId)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!newOwnerMembership) {
      return res.status(404).json({
        error: 'New owner is not a member of this clinic'
      });
    }

    if (newOwnerMembership.status !== 'active') {
      return res.status(400).json({
        error: 'New owner must have an active membership in the clinic'
      });
    }

    // 3. Get new owner details for response
    const { data: newOwnerDetails, error: ownerDetailsError } = await supabaseUser
      .from('user')
      .select('firstName, lastName, email')
      .eq('user_id', newOwnerId)
      .maybeSingle();

    if (ownerDetailsError) {
      console.error('Owner details error:', ownerDetailsError);
    }

    // 4. Transfer ownership by updating created_by field
    const { error: transferError } = await supabaseUser
      .from('clinics')
      .update({ created_by: newOwnerId })
      .eq('id', clinicId)
      .eq('created_by', userId); // Double check current user is still owner

    if (transferError) {
      console.error('Transfer error:', transferError);
      return res.status(500).json({ error: 'Failed to transfer ownership' });
    }

    // 5. Update the new owner's role to admin if not already (optional but recommended)
    if (newOwnerMembership.role !== 'admin' && newOwnerMembership.role !== 'full_access') {
      await supabaseUser
        .from('user_clinic_roles')
        .update({ role: 'full_access' })
        .eq('clinic_id', clinicId)
        .eq('user_id', newOwnerId);
    }

    console.log(`Ownership transferred successfully from ${userId} to ${newOwnerId} for clinic ${clinicId}`);

    res.json({
      message: 'Clinic ownership transferred successfully',
      clinic: {
        id: clinicId,
        name: clinic.clinic_name
      },
      newOwner: {
        id: newOwnerId,
        firstName: newOwnerDetails?.firstName,
        lastName: newOwnerDetails?.lastName,
        email: newOwnerDetails?.email
      },
      previousOwner: {
        id: userId
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};
