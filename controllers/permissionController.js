import { 
  hasPermission, 
  hasAnyPermission, 
  hasAllPermissions, 
  getUserPermissions, 
  getUserClinicAccess,
  isClinicCreator,
  getUserClinicRole
} from '../utils/permissionUtils.js';

/**
 * Check if user has a specific permission
 */
export const checkPermission = async (req, res) => {
  const { clinicId, permissionKey } = req.body;
  const userId = req.user?.id;

  if (!clinicId || !permissionKey) {
    return res.status(400).json({ 
      error: 'Clinic ID and permission key are required' 
    });
  }

  try {
    const hasUserPermission = await hasPermission(userId, clinicId, permissionKey);
    
    res.json({
      hasPermission: hasUserPermission,
      clinicId,
      permissionKey,
      userId
    });
  } catch (error) {
    console.error('Error checking permission:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
};

/**
 * Check if user has any of the specified permissions
 */
export const checkAnyPermission = async (req, res) => {
  const { clinicId, permissionKeys } = req.body;
  const userId = req.user?.id;

  if (!clinicId || !permissionKeys || !Array.isArray(permissionKeys)) {
    return res.status(400).json({ 
      error: 'Clinic ID and array of permission keys are required' 
    });
  }

  try {
    const hasAnyUserPermission = await hasAnyPermission(userId, clinicId, permissionKeys);
    
    res.json({
      hasAnyPermission: hasAnyUserPermission,
      clinicId,
      permissionKeys,
      userId
    });
  } catch (error) {
    console.error('Error checking any permission:', error);
    res.status(500).json({ error: 'Failed to check permissions' });
  }
};

/**
 * Check if user has all of the specified permissions
 */
export const checkAllPermissions = async (req, res) => {
  const { clinicId, permissionKeys } = req.body;
  const userId = req.user?.id;

  if (!clinicId || !permissionKeys || !Array.isArray(permissionKeys)) {
    return res.status(400).json({ 
      error: 'Clinic ID and array of permission keys are required' 
    });
  }

  try {
    const hasAllUserPermissions = await hasAllPermissions(userId, clinicId, permissionKeys);
    
    res.json({
      hasAllPermissions: hasAllUserPermissions,
      clinicId,
      permissionKeys,
      userId
    });
  } catch (error) {
    console.error('Error checking all permissions:', error);
    res.status(500).json({ error: 'Failed to check permissions' });
  }
};

/**
 * Get all permissions for a user in a clinic
 */
export const getUserClinicPermissions = async (req, res) => {
  const { clinicId } = req.params;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    const permissions = await getUserPermissions(userId, clinicId);
    
    res.json({
      clinicId,
      userId,
      permissions
    });
  } catch (error) {
    console.error('Error getting user permissions:', error);
    res.status(500).json({ error: 'Failed to get user permissions' });
  }
};

/**
 * Get comprehensive user access information for a clinic
 */
export const getUserAccessInfo = async (req, res) => {
  const { clinicId } = req.params;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    const accessInfo = await getUserClinicAccess(userId, clinicId);
    
    res.json({
      clinicId,
      userId,
      ...accessInfo
    });
  } catch (error) {
    console.error('Error getting user access info:', error);
    res.status(500).json({ error: 'Failed to get user access information' });
  }
};

/**
 * Check if user is clinic creator
 */
export const checkIsClinicCreator = async (req, res) => {
  const { clinicId } = req.params;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    const isCreator = await isClinicCreator(userId, clinicId);
    
    res.json({
      clinicId,
      userId,
      isCreator
    });
  } catch (error) {
    console.error('Error checking if user is clinic creator:', error);
    res.status(500).json({ error: 'Failed to check creator status' });
  }
};

/**
 * Get user's role in a clinic
 */
export const getUserRole = async (req, res) => {
  const { clinicId } = req.params;
  const userId = req.user?.id;

  if (!clinicId) {
    return res.status(400).json({ error: 'Clinic ID is required' });
  }

  try {
    const userRole = await getUserClinicRole(userId, clinicId);
    
    res.json({
      clinicId,
      userId,
      role: userRole?.role || null,
      hasRole: !!userRole
    });
  } catch (error) {
    console.error('Error getting user role:', error);
    res.status(500).json({ error: 'Failed to get user role' });
  }
};

/**
 * Get all available permissions in the system
 */
export const getAllPermissions = async (req, res) => {
  try {
    const { data: permissions, error } = await supabaseUser
      .from('permissions')
      .select('id, key, description')
      .order('key');

    if (error) {
      console.error('Error getting permissions:', error);
      return res.status(500).json({ error: 'Failed to get permissions' });
    }

    res.json({
      permissions
    });
  } catch (error) {
    console.error('Error getting all permissions:', error);
    res.status(500).json({ error: 'Failed to get permissions' });
  }
};

/**
 * Get all available roles in the system
 */
export const getAllRoles = async (req, res) => {
  try {
    const { data: roles, error } = await supabaseUser
      .from('roles')
      .select('id, name, description')
      .order('name');

    if (error) {
      console.error('Error getting roles:', error);
      return res.status(500).json({ error: 'Failed to get roles' });
    }

    res.json({
      roles
    });
  } catch (error) {
    console.error('Error getting all roles:', error);
    res.status(500).json({ error: 'Failed to get roles' });
  }
};

/**
 * Get role permissions mapping
 */
export const getRolePermissions = async (req, res) => {
  try {
    const { data: rolePermissions, error } = await supabaseUser
      .from('role_permissions')
      .select(`
        id,
        allowed,
        roles (
          id,
          name
        ),
        permissions (
          id,
          key,
          description
        )
      `)
      .eq('allowed', true)
      .order('roles(name)');

    if (error) {
      console.error('Error getting role permissions:', error);
      return res.status(500).json({ error: 'Failed to get role permissions' });
    }

    // Group by role for easier consumption
    const rolePermissionsMap = {};
    rolePermissions.forEach(rp => {
      const roleName = rp.roles?.name;
      const permissionKey = rp.permissions?.key;
      
      if (roleName && permissionKey) {
        if (!rolePermissionsMap[roleName]) {
          rolePermissionsMap[roleName] = [];
        }
        rolePermissionsMap[roleName].push({
          key: permissionKey,
          description: rp.permissions.description
        });
      }
    });

    res.json({
      rolePermissions: rolePermissionsMap
    });
  } catch (error) {
    console.error('Error getting role permissions:', error);
    res.status(500).json({ error: 'Failed to get role permissions' });
  }
}; 