import { supabaseUser } from '../supabaseClient.js';

/**
 * Get user's role in a specific clinic
 * @param {string} userId - User ID
 * @param {string} clinicId - Clinic ID
 * @returns {Promise<Object|null>} User's role information
 */
export async function getUserClinicRole(userId, clinicId) {
  console.log('userId', userId);
  console.log('clinicId', clinicId);
  try {
    const { data, error } = await supabaseUser
      .from('user_clinic_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('clinic_id', clinicId)
      .maybeSingle();

    if (error) {
      console.error('Error getting user clinic role:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getUserClinicRole:', error);
    return null;
  }
}

/**
 * Check if user has a specific permission in a clinic
 * @param {string} userId - User ID
 * @param {string} clinicId - Clinic ID
 * @param {string} permissionKey - Permission key (e.g., 'edit_clinic', 'add_member')
 * @returns {Promise<boolean>} Whether user has the permission
 */
export async function hasPermission(userId, clinicId, permissionKey) {
  try {
    // First, get user's role in the clinic
    const userRole = await getUserClinicRole(userId, clinicId);
    console.log('userRole', userRole);
    if (!userRole) {
      return false;
    }
   console.log(userRole,"userRole")
    // Get the role ID from the roles table
    const { data: roleData, error: roleError } = await supabaseUser
      .from('roles')
      .select('id')
      .eq('name', userRole.role)
      .single();

    if (roleError || !roleData) {
      console.error('Error getting role ID:', roleError);
      return false;
    }

    // Get the permission ID from the permissions table
    const { data: permissionData, error: permissionError } = await supabaseUser
      .from('permissions')
      .select('id')
      .eq('key', permissionKey)
      .maybeSingle(); // Changed from .single() to .maybeSingle()

    if (permissionError) {
      console.error('Error getting permission ID:', permissionError);
      return false;
    }

    if (!permissionData) {
      console.log(`❌ Permission key '${permissionKey}' not found in database`);
      return false;
    }
    console.log("roleData", roleData);
    console.log("permissionData", permissionData);
    // Check if the role has this permission
    const { data: rolePermission, error: rolePermissionError } = await supabaseUser
      .from('role_permissions')
      .select('allowed')
      .eq('role_id', roleData.id)
      .eq('permission_id', permissionData.id)
      .maybeSingle();
console.log("rolePermission", rolePermission);
    if (rolePermissionError) {
      console.error('Error checking role permission:', rolePermissionError);
      return false;
    }
    console.log("rolePermission", rolePermission);
    return rolePermission ? rolePermission.allowed : false;
  } catch (error) {
    console.error('Error in hasPermission:', error);
    return false;
  }
}

/**
 * Check if user has any of the specified permissions
 * @param {string} userId - User ID
 * @param {string} clinicId - Clinic ID
 * @param {string[]} permissionKeys - Array of permission keys
 * @returns {Promise<boolean>} Whether user has any of the permissions
 */
export async function hasAnyPermission(userId, clinicId, permissionKeys) {
  for (const permissionKey of permissionKeys) {
    const hasPermission = await hasPermission(userId, clinicId, permissionKey);
    if (hasPermission) {
      return true;
    }
  }
  return false;
}

/**
 * Check if user has all of the specified permissions
 * @param {string} userId - User ID
 * @param {string} clinicId - Clinic ID
 * @param {string[]} permissionKeys - Array of permission keys
 * @returns {Promise<boolean>} Whether user has all permissions
 */
export async function hasAllPermissions(userId, clinicId, permissionKeys) {
  for (const permissionKey of permissionKeys) {
    const hasPermission = await hasPermission(userId, clinicId, permissionKey);
    if (!hasPermission) {
      return false;
    }
  }
  return true;
}

/**
 * Get all permissions for a user in a clinic
 * @param {string} userId - User ID
 * @param {string} clinicId - Clinic ID
 * @returns {Promise<Array>} Array of permission keys the user has
 */
export async function getUserPermissions(userId, clinicId) {
  try {
    // Get user's role in the clinic
    const userRole = await getUserClinicRole(userId, clinicId);
    if (!userRole) {
      return [];
    }

    // Get the role ID
    const { data: roleData, error: roleError } = await supabaseUser
      .from('roles')
      .select('id')
      .eq('name', userRole.role)
      .single();

    if (roleError || !roleData) {
      return [];
    }

    // Get all permissions for this role
    const { data: permissions, error: permissionsError } = await supabaseUser
      .from('role_permissions')
      .select(`
        allowed,
        permissions (
          key,
          description
        )
      `)
      .eq('role_id', roleData.id)
      .eq('allowed', true);

    if (permissionsError) {
      console.error('Error getting user permissions:', permissionsError);
      return [];
    }

    return permissions
      .filter(p => p.allowed && p.permissions)
      .map(p => ({
        key: p.permissions.key,
        description: p.permissions.description
      }));
  } catch (error) {
    console.error('Error in getUserPermissions:', error);
    return [];
  }
}

/**
 * Check if user is clinic creator
 * @param {string} userId - User ID
 * @param {string} clinicId - Clinic ID
 * @returns {Promise<boolean>} Whether user is the clinic creator
 */
export async function isClinicCreator(userId, clinicId) {
  try {
    const { data, error } = await supabaseUser
      .from('clinics')
      .select('created_by')
      .eq('id', clinicId)
      .single();

    if (error || !data) {
      return false;
    }

    return data.created_by === userId;
  } catch (error) {
    console.error('Error in isClinicCreator:', error);
    return false;
  }
}

/**
 * Middleware to check if user has specific permission
 * @param {string} permissionKey - Permission key to check
 * @returns {Function} Express middleware function
 */
export function requirePermission(permissionKey) {
  return async (req, res, next) => {
    const userId = req.user?.id;
    const clinicId = req.body.clinicId || req.params.clinicId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic ID is required' });
    }

    // Check if user is clinic creator (creators have all permissions)
    const isCreator = await isClinicCreator(userId, clinicId);
    if (isCreator) {
      return next();
    }

    // Check specific permission
    const hasPermission = await hasPermission(userId, clinicId, permissionKey);
    if (!hasPermission) {
      return res.status(403).json({ 
        error: `You don't have permission to perform this action. Required permission: ${permissionKey}` 
      });
    }

    next();
  };
}

/**
 * Middleware to check if user has any of the specified permissions
 * @param {string[]} permissionKeys - Array of permission keys to check
 * @returns {Function} Express middleware function
 */
export function requireAnyPermission(permissionKeys) {
  return async (req, res, next) => {
    const userId = req.user?.id;
    const clinicId = req.body.clinicId || req.params.clinicId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic ID is required' });
    }

    // Check if user is clinic creator
    const isCreator = await isClinicCreator(userId, clinicId);
    if (isCreator) {
      return next();
    }

    // Check if user has any of the required permissions
    const hasAnyPermission = await hasAnyPermission(userId, clinicId, permissionKeys);
    if (!hasAnyPermission) {
      return res.status(403).json({ 
        error: `You don't have permission to perform this action. Required permissions: ${permissionKeys.join(', ')}` 
      });
    }

    next();
  };
}

/**
 * Get user's role and permissions summary for a clinic
 * @param {string} userId - User ID
 * @param {string} clinicId - Clinic ID
 * @returns {Promise<Object>} User's role and permissions information
 */
export async function getUserClinicAccess(userId, clinicId) {
  try {
    const userRole = await getUserClinicRole(userId, clinicId);
    const isCreator = await isClinicCreator(userId, clinicId);
    const permissions = await getUserPermissions(userId, clinicId);

    return {
      role: userRole?.role || null,
      isCreator,
      permissions: permissions.map(p => p.key),
      permissionDetails: permissions
    };
  } catch (error) {
    console.error('Error in getUserClinicAccess:', error);
    return {
      role: null,
      isCreator: false,
      permissions: [],
      permissionDetails: []
    };
  }
} 