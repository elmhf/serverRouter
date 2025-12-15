import { supabaseUser } from '../supabaseClient.js';
import { hasPermission, isClinicCreator } from '../utils/permissionUtils.js';
import { notifyTreatingDoctors, notifyPatientUpdate } from '../utils/notification.js';


// ✅ Add new patient
export const addPatient = async (req, res) => {
  const {
    first_name,
    last_name,
    gender,
    date_of_birth,
    email,
    phone,
    address,
    clinicId,
    treating_doctor_id
  } = req.body;
  const userId = req.user?.id;
  console.log('treating_doctor_id', treating_doctor_id);
  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  if (!first_name || !last_name || !gender || !date_of_birth || !email) {
    return res.status(400).json({
      error: 'First name, last name, gender, date of birth, and email are required'
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate gender
  const validGenders = ['male', 'female', 'other'];
  if (!validGenders.includes(gender.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid gender. Valid options are: male, female, other' });
  }

  try {
    // 1. Check if user is a member of this clinic
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!userMembership) {
      return res.status(403).json({
        error: 'You must be a member of this clinic to add patients'
      });
    }

    // 3. Check if patient with this email already exists in this clinic
    const { data: existingPatient, error: checkError } = await supabaseUser
      .from('patients')
      .select('id')
      .eq('email', email)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (checkError) {
      console.error('Patient check error:', checkError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingPatient) {
      return res.status(400).json({ error: 'A patient with this email already exists in this clinic' });
    }

    // 4. Add the patient
    const { data: patient, error: insertError } = await supabaseUser
      .from('patients')
      .insert([
        {
          first_name,
          last_name,
          gender: gender.toLowerCase(),
          date_of_birth,
          email,
          phone,
          address,
          clinic_id: clinicId,
          created_by: userId
        }
      ])
      .select()
      .single();

    if (insertError) {
      console.error('Patient insert error:', insertError);
      return res.status(500).json({ error: 'Failed to add patient' });
    }

    // 5. Create treatment entries for the new patient (if treating_doctor_ids are provided)
    if (treating_doctor_id && Array.isArray(treating_doctor_id) && treating_doctor_id.length > 0) {
      console.log('Requested treating_doctor_id:', treating_doctor_id);
      console.log('Clinic ID:', clinicId);

      // Check if all treating doctors are members of this clinic
      const { data: doctorMemberships, error: doctorCheckError } = await supabaseUser
        .from('user_clinic_roles')
        .select('user_id')
        .eq('clinic_id', clinicId)
        .in('user_id', treating_doctor_id);

      console.log('Doctor memberships query result:', doctorMemberships);
      console.log('Doctor memberships error:', doctorCheckError);

      if (doctorCheckError) {
        console.error('Doctor membership check error:', doctorCheckError);
      }

      // Get valid doctor IDs (those who are clinic members)
      const validDoctorIds = doctorMemberships?.map(membership => membership.user_id) || [];
      const invalidDoctorIds = treating_doctor_id.filter(id => !validDoctorIds.includes(id));

      console.log('validDoctorIds:', validDoctorIds);
      console.log('invalidDoctorIds:', invalidDoctorIds);

      if (invalidDoctorIds.length > 0) {
        console.error('Some treating doctors are not members of this clinic:', invalidDoctorIds);
      }

      // Create treatment entries for valid doctors
      if (validDoctorIds.length > 0) {
        const treatmentEntries = validDoctorIds.map(doctorId => ({
          patient_id: patient.id,
          treating_doctor_id: doctorId,
          clinic_id: clinicId
        }));

        console.log('Creating treatment entries:', treatmentEntries);

        const { data: treatments, error: treatmentError } = await supabaseUser
          .from('treatments')
          .insert(treatmentEntries)
          .select();

        if (treatmentError) {
          console.error('Treatment insert error:', treatmentError);
          // Note: We don't fail here as the patient was already created
          // The treatment can be added later manually if needed
        } else {
          console.log('Treatments created successfully:', treatments);
        }
      } else {
        console.log('No valid doctors found, skipping treatment creation');
      }
    }

    // 6. Get clinic name for response
    const { data: clinicInfo, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('clinic_name')
      .eq('id', clinicId)
      .single();

    // 7. Send notifications to treating doctors about the new patient
    await notifyTreatingDoctors({
      treating_doctor_ids: treating_doctor_id,
      clinic_id: clinicId,
      patient_id: patient.id,
      patient_first_name: first_name,
      patient_last_name: last_name,
      clinic_name: clinicInfo?.clinic_name,
      added_by: userId
    });

    res.status(201).json({
      message: 'Patient added successfully',
      patient: {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        gender: patient.gender,
        date_of_birth: patient.date_of_birth,
        email: patient.email,
        phone: patient.phone,
        address: patient.address,
        created_at: patient.created_at
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

// ✅ Get all patients for a clinic
export const getPatients = async (req, res) => {
  console.log('getPatients*****************');
  const { clinicId } = req.body;
  const userId = req.user?.id;
  console.log('clinicId', clinicId);
  console.log('userId', userId);
  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Check if user is a member of this clinic
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!userMembership) {
      return res.status(403).json({
        error: 'You must be a member of this clinic to view patients'
      });
    }

    // 2. Check if user is clinic creator
    const isCreator = await isClinicCreator(userId, clinicId);

    // 3. Get user's role in this clinic
    const userRole = userMembership.role;
    const isFullAccess = userRole === 'full_access';
    const isClinicAccess = userRole === 'clinic_access';

    // 4. Get all patients with their treating doctors information and reports
    const { data: allPatients, error: patientsError } = await supabaseUser
      .from('patients')
      .select(`
        *,
        treatments (
          treating_doctor_id,
          user!treating_doctor_id (
            user_id,
            firstName,
            lastName,
            profilePhotoUrl
          )
        ),
        report_ai (
          report_id,
          raport_type,
          created_at,
          last_upload,
          status
        )
      `)
      .eq('clinic_id', clinicId);

    if (patientsError) {
      console.error('Patients fetch error:', patientsError);
      return res.status(500).json({ error: 'Failed to fetch patients' });
    }

    // 5. Get user's favorite patients for this clinic
    const { data: userFavorites, error: favoritesError } = await supabaseUser
      .from('patient_favorites')
      .select('patient_id')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId);

    if (favoritesError) {
      console.error('Favorites fetch error:', favoritesError);
    }

    const favoritePatientIds = userFavorites?.map(fav => fav.patient_id) || [];

    // 6. Process patients to include treating doctors info, last report image, check if current user is treating doctor, and check if favorite
    const processedPatients = await Promise.all(allPatients?.map(async patient => {
      const treatingDoctors = patient.treatments?.map(treatment => treatment.user).filter(Boolean) || [];
      const isCurrentUserTreatingDoctor = treatingDoctors.some(doctor => doctor.user_id === userId);
      const isFavorite = favoritePatientIds.includes(patient.id);

      // Get the last report's image if available
      let lastReportImageUrl = null;
      if (patient.report_ai && patient.report_ai.length > 0) {
        console.log(`\n📸 Processing images for patient: ${patient.first_name} ${patient.last_name} (${patient.id})`);
        console.log(`   Total reports: ${patient.report_ai.length}`);

        // Sort reports by created_at descending to get the most recent one
        const sortedReports = [...patient.report_ai].sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
        );
        const lastReport = sortedReports[0];

        console.log(`   Last report ID: ${lastReport.report_id}`);
        console.log(`   Report type: ${lastReport.raport_type}`);
        console.log(`   Created at: ${lastReport.created_at}`);

        // Build the path for original.png
        const path = `${clinicId}/${patient.id}/${lastReport.raport_type}/${lastReport.report_id}/original.png`;
        console.log(`   Storage path: ${path}`);

        // Get the public URL from Supabase storage
        const { data: publicUrlData } = supabaseUser.storage
          .from('reports')
          .getPublicUrl(path);

        lastReportImageUrl = publicUrlData?.publicUrl || null;
        console.log(`   Image URL: ${lastReportImageUrl ? '✅ Generated' : '❌ Not available'}`);
        if (lastReportImageUrl) {
          console.log(`   URL: ${lastReportImageUrl}`);
        }
      } else {
        console.log(`\n📸 Patient ${patient.first_name} ${patient.last_name} (${patient.id}) has no reports`);
      }

      return {
        ...patient,
        treating_doctors: treatingDoctors.map(doctor => ({
          id: doctor.user_id,
          first_name: doctor.firstName,
          last_name: doctor.lastName,
          profilePhotoUrl: doctor.profilePhotoUrl
        })),
        is_treating_doctor: isCurrentUserTreatingDoctor,
        isFavorite: isFavorite,
        lastReportImageUrl: lastReportImageUrl
      };
    }) || []);

    res.json({
      message: 'Patients retrieved successfully',
      patients: processedPatients,
      totalPatients: processedPatients.length,
      userRole: userRole || 'unknown',
      isCreator,
      isFullAccess,
      isClinicAccess
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};
export const getPatient = async (req, res) => {
  const { patientId } = req.params;
  const userId = req.user?.id;

  if (!patientId) {
    return res.status(400).json({ error: "Patient ID is required" });
  }

  try {
    // ✅ 1. نجيبو المريض بالـ reports بدون clinic_id من report_ai
    const { data: patient, error: patientError } = await supabaseUser
      .from("patients")
      .select(`
        *,
        clinics ( id, clinic_name ),
        treatments (
          treating_doctor_id,
          user!treating_doctor_id (
            user_id,
            firstName,
            lastName,
            profilePhotoUrl
          )
        ),
        report_ai (
          report_id,
          raport_type,
          created_at,
          last_upload,
          status
        )
      `)
      .eq("id", patientId)
      .single();

    if (patientError) {
      console.error("Patient fetch error:", patientError);
      return res.status(404).json({ error: "Patient not found" });
    }

    // ✅ 2. التشيك على الصلاحيات
    const isCreator = await isClinicCreator(userId, patient.clinic_id);

    const { data: treatment } = await supabaseUser
      .from("treatments")
      .select("id")
      .eq("patient_id", patientId)
      .eq("treating_doctor_id", userId)
      .eq("clinic_id", patient.clinic_id)
      .maybeSingle();

    const isTreatingDoctor = !!treatment;

    if (!isCreator && !isTreatingDoctor) {
      return res.status(403).json({
        error:
          "You do not have permission to view this patient. Only the clinic creator or the treating doctor can view patient details.",
      });
    }

    // ✅ 3. جلب الدور
    const { data: userRole } = await supabaseUser
      .from("user_clinic_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("clinic_id", patient.clinic_id)
      .maybeSingle();

    const userAccessLevel = {
      isCreator,
      isTreatingDoctor,
      isFullAccess: userRole?.role === "full_access",
      isClinicAccess: userRole?.role === "clinic_access",
      role: userRole?.role || "unknown",
    };

    // ✅ 4. هل المريض في المفضلة؟
    const { data: favorite } = await supabaseUser
      .from("patient_favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("patient_id", patientId)
      .maybeSingle();

    const isFavorite = !!favorite;

    // ✅ 5. الأطباء المعالجين
    const treatingDoctors =
      patient.treatments?.map((t) => t.user).filter(Boolean) || [];

    // ✅ 6. نركب مسار الصورة باستعمال patient.clinic_id
    const reports = patient.report_ai || [];
    const reportsWithImages = await Promise.all(
      reports.map(async (report) => {
        const path = `${patient.clinic_id}/${patientId}/${report.raport_type}/${report.report_id}/original.png`;

        // نحصل على URL من Supabase
        const { data: publicUrlData } = supabaseUser.storage
          .from("reports") // اسم الـ bucket
          .getPublicUrl(path);

        return {
          id: report.report_id,
          created_at: report.created_at,
          last_upload: report.last_upload,
          raport_type: report.raport_type,
          status: report.status,
          image_url: publicUrlData?.publicUrl || null,
        };
      })
    );

    // ✅ 7. نرجع الداتا كاملة
    res.json({
      message: "Patient retrieved successfully",
      patient: {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        gender: patient.gender,
        date_of_birth: patient.date_of_birth,
        email: patient.email,
        phone: patient.phone,
        address: patient.address,
        description: patient.description,
        created_at: patient.created_at,
        clinic: patient.clinics,
        treating_doctors: treatingDoctors.map((doctor) => ({
          id: doctor.user_id,
          first_name: doctor.firstName,
          last_name: doctor.lastName,
          profilePhotoUrl: doctor.profilePhotoUrl
        })),
        reports: reportsWithImages,
        isFavorite,
      },
      userAccess: userAccessLevel,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: err.message });
  }
};



// ✅ Update patient
export const updatePatient = async (req, res) => {
  const {
    patientId,
    first_name,
    last_name,
    gender,
    date_of_birth,
    email,
    phone,
    address,
    treating_doctor_id
  } = req.body;
  const userId = req.user?.id;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  try {
    // 1. Get patient to check clinic access
    const { data: existingPatient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id')
      .eq('id', patientId)
      .single();

    if (patientError) {
      console.error('Patient fetch error:', patientError);
      return res.status(404).json({ error: 'Patient not found' });
    }

    // 2. Check if user has permission to edit patients
    const isCreator = await isClinicCreator(userId, existingPatient.clinic_id);
    const canEditPatient = await hasPermission(userId, existingPatient.clinic_id, 'edit_patient');

    if (!isCreator && !canEditPatient) {
      return res.status(403).json({
        error: 'You do not have permission to edit patients in this clinic'
      });
    }

    // 3. Prepare update data
    const updateData = {};
    if (first_name) updateData.first_name = first_name;
    if (last_name) updateData.last_name = last_name;
    if (gender) {
      const validGenders = ['male', 'female', 'other'];
      if (!validGenders.includes(gender.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid gender. Valid options are: male, female, other' });
      }
      updateData.gender = gender.toLowerCase();
    }
    if (date_of_birth) updateData.date_of_birth = date_of_birth;
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      updateData.email = email;
    }
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;

    // 4. Update patient
    const { data: updatedPatient, error: updateError } = await supabaseUser
      .from('patients')
      .update(updateData)
      .eq('id', patientId)
      .select()
      .single();

    if (updateError) {
      console.error('Patient update error:', updateError);
      return res.status(500).json({ error: 'Failed to update patient' });
    }

    // 5. Update treating doctors if provided
    let newlyAssignedDoctorIds = [];
    if (treating_doctor_id && Array.isArray(treating_doctor_id)) {
      console.log('Updating treating doctors for patient:', patientId);
      console.log('Requested treating_doctor_id:', treating_doctor_id);

      // Get existing treating doctors before deletion
      const { data: existingTreatments } = await supabaseUser
        .from('treatments')
        .select('treating_doctor_id')
        .eq('patient_id', patientId);

      const existingDoctorIds = existingTreatments?.map(t => t.treating_doctor_id) || [];

      // First, delete existing treatments for this patient
      const { error: deleteError } = await supabaseUser
        .from('treatments')
        .delete()
        .eq('patient_id', patientId);

      if (deleteError) {
        console.error('Delete existing treatments error:', deleteError);
      } else {
        console.log('Deleted existing treatments for patient');
      }

      // Check if all treating doctors are members of this clinic
      const { data: doctorMemberships, error: doctorCheckError } = await supabaseUser
        .from('user_clinic_roles')
        .select('user_id')
        .eq('clinic_id', existingPatient.clinic_id)
        .in('user_id', treating_doctor_id);

      console.log('Doctor memberships query result:', doctorMemberships);
      console.log('Doctor memberships error:', doctorCheckError);

      if (doctorCheckError) {
        console.error('Doctor membership check error:', doctorCheckError);
      }

      // Get valid doctor IDs (those who are clinic members)
      const validDoctorIds = doctorMemberships?.map(membership => membership.user_id) || [];
      const invalidDoctorIds = treating_doctor_id.filter(id => !validDoctorIds.includes(id));

      console.log('validDoctorIds:', validDoctorIds);
      console.log('invalidDoctorIds:', invalidDoctorIds);

      if (invalidDoctorIds.length > 0) {
        console.error('Some treating doctors are not members of this clinic:', invalidDoctorIds);
      }

      // Identify newly assigned doctors (those not in the existing list)
      newlyAssignedDoctorIds = validDoctorIds.filter(id => !existingDoctorIds.includes(id));
      console.log('Newly assigned doctor IDs:', newlyAssignedDoctorIds);

      // Create new treatment entries for valid doctors
      if (validDoctorIds.length > 0) {
        const treatmentEntries = validDoctorIds.map(doctorId => ({
          patient_id: patientId,
          treating_doctor_id: doctorId,
          clinic_id: existingPatient.clinic_id
        }));

        console.log('Creating new treatment entries:', treatmentEntries);

        const { data: treatments, error: treatmentError } = await supabaseUser
          .from('treatments')
          .insert(treatmentEntries)
          .select();

        if (treatmentError) {
          console.error('Treatment insert error:', treatmentError);
        } else {
          console.log('New treatments created successfully:', treatments);
        }
      } else {
        console.log('No valid doctors found, skipping treatment creation');
      }
    }




    // 6. Get clinic and doctor information for notification
    const { data: clinicInfo, error: clinicError } = await supabaseUser
      .from('clinics')
      .select('clinic_name')
      .eq('id', existingPatient.clinic_id)
      .single();

    const { data: doctorInfo, error: doctorError } = await supabaseUser
      .from('user')
      .select('firstName, lastName')
      .eq('user_id', userId)
      .single();

    // 7. Send notification to clinic creator and full_access users about patient update
    if (clinicInfo && doctorInfo) {
      await notifyPatientUpdate({
        patient_id: patientId,
        clinic_id: existingPatient.clinic_id,
        patient_first_name: updatedPatient.first_name,
        patient_last_name: updatedPatient.last_name,
        clinic_name: clinicInfo.clinic_name,
        updated_by: userId,
        doctor_first_name: doctorInfo.firstName,
        doctor_last_name: doctorInfo.lastName
      });
    }

    // 8. Send notification to newly assigned treating doctors
    if (newlyAssignedDoctorIds.length > 0 && clinicInfo) {
      await notifyTreatingDoctors({
        treating_doctor_ids: newlyAssignedDoctorIds,
        clinic_id: existingPatient.clinic_id,
        patient_id: patientId,
        patient_first_name: updatedPatient.first_name,
        patient_last_name: updatedPatient.last_name,
        clinic_name: clinicInfo.clinic_name,
        added_by: userId
      });
    }


    res.json({
      message: 'Patient updated successfully',
      patient: updatedPatient
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ Update patient description
export const updatePatientDescription = async (req, res) => {
  const { patientId, description } = req.body;
  const userId = req.user?.id;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  try {
    // 1. Get patient to check clinic access
    const { data: existingPatient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id')
      .eq('id', patientId)
      .single();

    if (patientError) {
      console.error('Patient fetch error:', patientError);
      return res.status(404).json({ error: 'Patient not found' });
    }

    // 2. Check permissions
    const isCreator = await isClinicCreator(userId, existingPatient.clinic_id);
    const canEditPatient = await hasPermission(userId, existingPatient.clinic_id, 'edit_patient');

    if (!isCreator && !canEditPatient) {
      return res.status(403).json({
        error: 'You do not have permission to edit patients in this clinic'
      });
    }

    // 3. Update description
    const { data: updatedPatient, error: updateError } = await supabaseUser
      .from('patients')
      .update({ description })
      .eq('id', patientId)
      .select()
      .single();

    if (updateError) {
      console.error('Patient description update error:', updateError);
      return res.status(500).json({ error: 'Failed to update description' });
    }

    res.json({
      message: 'Description updated successfully',
      patient: updatedPatient
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ Delete patient
export const deletePatient = async (req, res) => {
  const { patientId } = req.body;
  const userId = req.user?.id;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  try {
    // 1. Get patient to check clinic access
    const { data: existingPatient, error: patientError } = await supabaseUser
      .from('patients')
      .select('clinic_id, first_name, last_name')
      .eq('id', patientId)
      .single();

    if (patientError) {
      console.error('Patient fetch error:', patientError);
      return res.status(404).json({ error: 'Patient not found' });
    }

    // 2. Check if user has permission to delete patients
    const isCreator = await isClinicCreator(userId, existingPatient.clinic_id);
    const canDeletePatient = await hasPermission(userId, existingPatient.clinic_id, 'delete_patient');

    if (!isCreator && !canDeletePatient) {
      return res.status(403).json({
        error: 'You do not have permission to delete patients in this clinic'
      });
    }

    // 3. Delete patient
    const { error: deleteError } = await supabaseUser
      .from('patients')
      .delete()
      .eq('id', patientId);

    if (deleteError) {
      console.error('Patient delete error:', deleteError);
      return res.status(500).json({ error: 'Failed to delete patient' });
    }



    res.json({
      message: 'Patient deleted successfully',
      deletedPatient: {
        id: patientId,
        name: `${existingPatient.first_name} ${existingPatient.last_name}`
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ Add/Remove patient from favorites
export const addToFavorites = async (req, res) => {
  const { patientId, isFavorite } = req.body;
  const userId = req.user?.id;
  console.log('addToFavorites');
  console.log('patientId', patientId);
  console.log('isFavorite', isFavorite);
  console.log('userId', userId);
  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  if (typeof isFavorite !== 'boolean') {
    return res.status(400).json({ error: 'isFavorite must be a boolean value (true/false)' });
  }

  try {
    // 1. Check if patient exists and get clinic info
    const { data: patient, error: patientError } = await supabaseUser
      .from('patients')
      .select('id, clinic_id')
      .eq('id', patientId)
      .single();

    if (patientError) {
      console.error('Patient fetch error:', patientError);
      return res.status(404).json({ error: 'Patient not found' });
    }

    // 2. Check if user is a member of this clinic
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('clinic_id', patient.clinic_id)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!userMembership) {
      return res.status(403).json({
        error: 'You must be a member of this clinic to add patients to favorites'
      });
    }

    // 3. Check if already in favorites
    const { data: existingFavorite, error: checkError } = await supabaseUser
      .from('patient_favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('patient_id', patientId)
      .maybeSingle();

    if (checkError) {
      console.error('Favorite check error:', checkError);
      return res.status(500).json({ error: 'Database error' });
    }

    // 4. Handle favorite status based on isFavorite value
    if (isFavorite) {
      // Add to favorites if not already there
      if (existingFavorite) {
        return res.status(200).json({
          message: 'Patient is already in your favorites',
          favorite: {
            id: existingFavorite.id,
            patient_id: patientId,
            user_id: userId
          }
        });
      }

      // Add to favorites
      const { data: favorite, error: insertError } = await supabaseUser
        .from('patient_favorites')
        .insert([
          {
            user_id: userId,
            patient_id: patientId,
            clinic_id: patient.clinic_id
          }
        ])
        .select()
        .single();

      if (insertError) {
        console.error('Favorite insert error:', insertError);
        return res.status(500).json({ error: 'Failed to add patient to favorites' });
      }

      res.status(201).json({
        message: 'Patient added to favorites successfully',
        favorite: {
          id: favorite.id,
          patient_id: favorite.patient_id,
          user_id: favorite.user_id,
          created_at: favorite.created_at
        }
      });
    } else {
      // Remove from favorites if exists
      if (!existingFavorite) {
        return res.status(200).json({
          message: 'Patient is not in your favorites',
          removedFavorite: {
            patient_id: patientId,
            user_id: userId
          }
        });
      }

      // Remove from favorites
      const { error: deleteError } = await supabaseUser
        .from('patient_favorites')
        .delete()
        .eq('user_id', userId)
        .eq('patient_id', patientId);

      if (deleteError) {
        console.error('Favorite delete error:', deleteError);
        return res.status(500).json({ error: 'Failed to remove patient from favorites' });
      }

      res.json({
        message: 'Patient removed from favorites successfully',
        removedFavorite: {
          patient_id: patientId,
          user_id: userId
        }
      });
    }

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ Remove patient from favorites
export const removeFromFavorites = async (req, res) => {
  const { patientId } = req.body;
  const userId = req.user?.id;

  if (!patientId) {
    return res.status(400).json({ error: 'Patient ID is required' });
  }

  try {
    // 1. Check if favorite exists
    const { data: existingFavorite, error: checkError } = await supabaseUser
      .from('patient_favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('patient_id', patientId)
      .maybeSingle();

    if (checkError) {
      console.error('Favorite check error:', checkError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!existingFavorite) {
      return res.status(404).json({ error: 'Patient is not in your favorites' });
    }

    // 2. Remove from favorites
    const { error: deleteError } = await supabaseUser
      .from('patient_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('patient_id', patientId);

    if (deleteError) {
      console.error('Favorite delete error:', deleteError);
      return res.status(500).json({ error: 'Failed to remove patient from favorites' });
    }

    res.json({
      message: 'Patient removed from favorites successfully',
      removedFavorite: {
        patient_id: patientId,
        user_id: userId
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ Get user's favorite patients
export const getFavoritePatients = async (req, res) => {
  const { clinicId } = req.body;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    // 1. Check if user is a member of this clinic
    const { data: userMembership, error: membershipError } = await supabaseUser
      .from('user_clinic_roles')
      .select('id')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (membershipError) {
      console.error('Membership check error:', membershipError);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!userMembership) {
      return res.status(403).json({
        error: 'You must be a member of this clinic to view favorite patients'
      });
    }

    // 2. Get favorite patients with their details
    const { data: favorites, error: favoritesError } = await supabaseUser
      .from('patient_favorites')
      .select(`
        *,
        patients (
          *,
          treatments (
            treating_doctor_id,
            user!treating_doctor_id (
              user_id,
              firstName,
              lastName
            )
          )
        )
      `)
      .eq('user_id', userId)
      .eq('clinic_id', clinicId);

    if (favoritesError) {
      console.error('Favorites fetch error:', favoritesError);
      return res.status(500).json({ error: 'Failed to fetch favorite patients' });
    }

    // 3. Process favorites to include treating doctors info
    const processedFavorites = favorites?.map(favorite => {
      const patient = favorite.patients;
      const treatingDoctors = patient.treatments?.map(treatment => treatment.user).filter(Boolean) || [];
      const isCurrentUserTreatingDoctor = treatingDoctors.some(doctor => doctor.user_id === userId);

      return {
        favorite_id: favorite.id,
        added_at: favorite.created_at,
        patient: {
          ...patient,
          treating_doctors: treatingDoctors.map(doctor => ({
            id: doctor.user_id,
            first_name: doctor.firstName,
            last_name: doctor.lastName
          })),
          is_treating_doctor: isCurrentUserTreatingDoctor
        }
      };
    }) || [];

    res.json({
      message: 'Favorite patients retrieved successfully',
      favorites: processedFavorites,
      totalFavorites: processedFavorites.length
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: err.message });
  }
}; 