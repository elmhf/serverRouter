# 🏥 Clinic Management Permissions - Updated Functions

## 📋 Overview
This document describes the updated clinic management functions that now use the permission system instead of hardcoded role checks.

## 🔄 Updated Functions

### **1. updateClinicInfo**
**Permission Required:** `edit_clinic` OR clinic creator

**Changes Made:**
- ✅ Replaced hardcoded role checks with permission system
- ✅ Uses `hasPermission(userId, clinicId, 'edit_clinic')`
- ✅ Uses `isClinicCreator(userId, clinicId)`
- ✅ Removed manual database queries for role checking

**Before:**
```javascript
// Old way - hardcoded role checks
const { data: userAccess, error: accessError } = await supabaseUser
  .from('user_clinic_roles')
  .select('role')
  .eq('clinic_id', clinicId)
  .eq('user_id', userId)
  .maybeSingle();

const isCreator = clinic.created_by === userId;
const hasAdminRole = userAccess && (userAccess.role === 'admin' || userAccess.role === 'owner');

if (!isCreator && !hasAdminRole) {
  return res.status(403).json({ error: 'Access denied' });
}
```

**After:**
```javascript
// New way - permission-based
const isCreator = await isClinicCreator(userId, clinicId);
const canEditClinic = await hasPermission(userId, clinicId, 'edit_clinic');

if (!isCreator && !canEditClinic) {
  return res.status(403).json({ 
    error: 'You do not have permission to update clinic information' 
  });
}
```

### **2. updateClinicEmail**
**Permission Required:** `edit_clinic` OR clinic creator

**Changes Made:**
- ✅ Added permission system integration
- ✅ Added clinicId validation
- ✅ Removed creator-only restriction
- ✅ Uses permission-based access control

**Before:**
```javascript
// Old way - creator only
const { data, error } = await supabaseUser
  .from('clinics')
  .update({ email })
  .eq('id', clinicId)
  .eq('created_by', userId)  // Only creator could update
  .select()
  .maybeSingle();
```

**After:**
```javascript
// New way - permission-based
const isCreator = await isClinicCreator(userId, clinicId);
const canEditClinic = await hasPermission(userId, clinicId, 'edit_clinic');

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
```

### **3. updateClinicPhone**
**Permission Required:** `edit_clinic` OR clinic creator

**Changes Made:**
- ✅ Added permission system integration
- ✅ Added clinicId validation
- ✅ Removed creator-only restriction
- ✅ Uses permission-based access control

**Before:**
```javascript
// Old way - creator only
const { data, error } = await supabaseUser
  .from('clinics')
  .update({ phone })
  .eq('id', clinicId)
  .eq('created_by', userId)  // Only creator could update
  .select()
  .maybeSingle();
```

**After:**
```javascript
// New way - permission-based
const isCreator = await isClinicCreator(userId, clinicId);
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
```

## 🔐 Permission System Benefits

### **1. Flexibility**
- ✅ Permissions configurable via Supabase
- ✅ No hardcoded role restrictions
- ✅ Easy to modify access levels

### **2. Granular Control**
- ✅ Specific permission for each action
- ✅ Different permissions for different functions
- ✅ Role-based permissions in database

### **3. Security**
- ✅ Database-level permission checks
- ✅ Consistent error handling
- ✅ Audit trail through permission system

## 📡 API Endpoints

| Function | Endpoint | Permission Required |
|----------|----------|-------------------|
| Update Clinic Info | `PUT /api/clinics/update-info` | `edit_clinic` |
| Update Clinic Email | `PUT /api/clinics/update-email` | `edit_clinic` |
| Update Clinic Phone | `PUT /api/clinics/update-phone` | `edit_clinic` |
| Change Clinic Logo | `POST /api/clinics/change-logo` | `edit_clinic` |
| Change Clinic Stamp | `POST /api/clinics/change-stamp` | `edit_clinic` |

## 🚀 Usage Examples

### **Frontend Permission Check:**
```javascript
// Check if user can edit clinic
const canEditClinic = async (clinicId) => {
  try {
    const response = await fetch('/api/permissions/check-permission', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clinicId,
        permissionKey: 'edit_clinic'
      })
    });
    
    const data = await response.json();
    return data.hasPermission;
  } catch (error) {
    console.error('Error checking permission:', error);
    return false;
  }
};

// Usage in component
const ClinicSettings = ({ clinicId }) => {
  const [canEdit, setCanEdit] = useState(false);
  
  useEffect(() => {
    const checkPermission = async () => {
      const hasPermission = await canEditClinic(clinicId);
      setCanEdit(hasPermission);
    };
    
    checkPermission();
  }, [clinicId]);
  
  return (
    <div>
      {canEdit && (
        <>
          <button onClick={() => updateClinicInfo()}>Update Info</button>
          <button onClick={() => updateClinicEmail()}>Update Email</button>
          <button onClick={() => updateClinicPhone()}>Update Phone</button>
        </>
      )}
    </div>
  );
};
```

### **API Calls:**
```javascript
// Update clinic info
const updateClinicInfo = async (clinicData) => {
  const response = await fetch('/api/clinics/update-info', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(clinicData)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }
  
  return response.json();
};

// Update clinic email
const updateClinicEmail = async (email, clinicId) => {
  const response = await fetch('/api/clinics/update-email', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clinicData: { email, clinicId }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }
  
  return response.json();
};
```

## 🔄 Migration Summary

### **Functions Updated:**
1. ✅ `updateClinicInfo` - Now uses permission system
2. ✅ `updateClinicEmail` - Now uses permission system  
3. ✅ `updateClinicPhone` - Now uses permission system
4. ✅ `changeClinicLogo` - Already updated (previous work)
5. ✅ `changeStampClinic` - Already updated (previous work)

### **Benefits Achieved:**
- ✅ **Consistent Security** - All functions use same permission system
- ✅ **Flexible Access** - Permissions configurable via Supabase
- ✅ **Better Error Messages** - Specific permission-based errors
- ✅ **Easier Maintenance** - Centralized permission logic
- ✅ **Future-Proof** - Easy to add new permissions

### **Permission Keys Used:**
- `edit_clinic` - For all clinic update operations
- `add_member` - For inviting members (existing)
- `delete_member` - For deleting members (new)
- `change_role` - For changing member roles (new)

The clinic management system now has consistent, permission-based access control across all functions! 🎉 