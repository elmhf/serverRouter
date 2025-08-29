# Permission System Usage Guide

## Overview
This system uses your Supabase `roles`, `permissions`, and `role_permissions` tables to provide granular access control for clinic management.

## Database Structure
- **`roles`**: Defines user roles (full_access, clinical_access, limited_access, clinic_access)
- **`permissions`**: Defines available actions (add_member, edit_clinic, delete_member, etc.)
- **`role_permissions`**: Links roles to permissions with boolean allowed/denied values

## API Endpoints

### 1. Check Specific Permission
```javascript
// POST /api/permissions/check-permission
{
  "clinicId": "clinic-uuid",
  "permissionKey": "add_member"
}

// Response
{
  "hasPermission": true,
  "clinicId": "clinic-uuid",
  "permissionKey": "add_member",
  "userId": "user-uuid"
}
```

### 2. Check Multiple Permissions (Any)
```javascript
// POST /api/permissions/check-any-permission
{
  "clinicId": "clinic-uuid",
  "permissionKeys": ["add_member", "edit_clinic", "delete_member"]
}

// Response
{
  "hasAnyPermission": true,
  "clinicId": "clinic-uuid",
  "permissionKeys": ["add_member", "edit_clinic", "delete_member"],
  "userId": "user-uuid"
}
```

### 3. Check Multiple Permissions (All)
```javascript
// POST /api/permissions/check-all-permissions
{
  "clinicId": "clinic-uuid",
  "permissionKeys": ["view_all_patients", "edit_own_appointments"]
}

// Response
{
  "hasAllPermissions": false,
  "clinicId": "clinic-uuid",
  "permissionKeys": ["view_all_patients", "edit_own_appointments"],
  "userId": "user-uuid"
}
```

### 4. Get User's Permissions in Clinic
```javascript
// GET /api/permissions/user-permissions/:clinicId

// Response
{
  "clinicId": "clinic-uuid",
  "userId": "user-uuid",
  "permissions": [
    {
      "key": "view_all_patients",
      "description": "Voir tous les patients"
    },
    {
      "key": "edit_own_appointments",
      "description": "Modifier uniquement ses propres rendez-"
    }
  ]
}
```

### 5. Get Comprehensive User Access Info
```javascript
// GET /api/permissions/user-access/:clinicId

// Response
{
  "clinicId": "clinic-uuid",
  "userId": "user-uuid",
  "role": "clinical_access",
  "isCreator": false,
  "permissions": ["view_all_patients", "edit_own_appointments"],
  "permissionDetails": [
    {
      "key": "view_all_patients",
      "description": "Voir tous les patients"
    },
    {
      "key": "edit_own_appointments",
      "description": "Modifier uniquement ses propres rendez-"
    }
  ]
}
```

### 6. Check if User is Clinic Creator
```javascript
// GET /api/permissions/is-creator/:clinicId

// Response
{
  "clinicId": "clinic-uuid",
  "userId": "user-uuid",
  "isCreator": true
}
```

### 7. Get User's Role in Clinic
```javascript
// GET /api/permissions/user-role/:clinicId

// Response
{
  "clinicId": "clinic-uuid",
  "userId": "user-uuid",
  "role": "clinical_access",
  "hasRole": true
}
```

### 8. Get All Available Permissions
```javascript
// GET /api/permissions/permissions

// Response
{
  "permissions": [
    {
      "id": "uuid-1",
      "key": "add_member",
      "description": "Ajouter un nouveau membre"
    },
    {
      "id": "uuid-2",
      "key": "edit_clinic",
      "description": "Modifier les informations de la clinique"
    }
  ]
}
```

### 9. Get All Available Roles
```javascript
// GET /api/permissions/roles

// Response
{
  "roles": [
    {
      "id": "uuid-1",
      "name": "full_access",
      "description": null
    },
    {
      "id": "uuid-2",
      "name": "clinical_access",
      "description": null
    }
  ]
}
```

### 10. Get Role Permissions Mapping
```javascript
// GET /api/permissions/role-permissions

// Response
{
  "rolePermissions": {
    "full_access": [
      {
        "key": "add_member",
        "description": "Ajouter un nouveau membre"
      },
      {
        "key": "edit_clinic",
        "description": "Modifier les informations de la clinique"
      }
    ],
    "clinical_access": [
      {
        "key": "view_all_patients",
        "description": "Voir tous les patients"
      }
    ]
  }
}
```

## Frontend Usage Examples

### React Hook Example
```javascript
import { useState, useEffect } from 'react';

const usePermission = (clinicId, permissionKey) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const response = await fetch('/api/permissions/check-permission', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clinicId,
            permissionKey
          })
        });
        
        const data = await response.json();
        setHasPermission(data.hasPermission);
      } catch (error) {
        console.error('Error checking permission:', error);
        setHasPermission(false);
      } finally {
        setLoading(false);
      }
    };

    if (clinicId && permissionKey) {
      checkPermission();
    }
  }, [clinicId, permissionKey]);

  return { hasPermission, loading };
};

// Usage
const { hasPermission: canAddMember, loading } = usePermission(clinicId, 'add_member');

if (loading) return <div>Loading...</div>;
if (!canAddMember) return <div>You don't have permission to add members</div>;

return <button>Add Member</button>;
```

### Conditional Rendering Example
```javascript
const ClinicManagement = ({ clinicId }) => {
  const [userAccess, setUserAccess] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getUserAccess = async () => {
      try {
        const response = await fetch(`/api/permissions/user-access/${clinicId}`);
        const data = await response.json();
        setUserAccess(data);
      } catch (error) {
        console.error('Error getting user access:', error);
      } finally {
        setLoading(false);
      }
    };

    getUserAccess();
  }, [clinicId]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Clinic Management</h2>
      
      {/* Only show if user can add members */}
      {userAccess.permissions.includes('add_member') && (
        <button>Add New Member</button>
      )}
      
      {/* Only show if user can edit clinic */}
      {userAccess.permissions.includes('edit_clinic') && (
        <button>Edit Clinic Info</button>
      )}
      
      {/* Only show if user is creator */}
      {userAccess.isCreator && (
        <button>Delete Clinic</button>
      )}
      
      {/* Show user's role */}
      <p>Your role: {userAccess.role}</p>
    </div>
  );
};
```

### Permission Guard Component
```javascript
const PermissionGuard = ({ clinicId, permission, children, fallback = null }) => {
  const { hasPermission, loading } = usePermission(clinicId, permission);

  if (loading) return <div>Loading...</div>;
  if (!hasPermission) return fallback;

  return children;
};

// Usage
<PermissionGuard 
  clinicId={clinicId} 
  permission="add_member"
  fallback={<div>You don't have permission to add members</div>}
>
  <AddMemberForm />
</PermissionGuard>
```

## Available Permission Keys

Based on your database, here are the available permission keys:

- `view_all_doctors` - Voir tous les médecins
- `edit_own_appointments` - Modifier uniquement ses propres rendez-
- `view_reports` - Accéder aux rapports et statistiques de la
- `change_role` - Changer le rôle d'
- `view_all_appointments` - Voir tous les rendez-vous
- `view_own_profile` - Voir uniquement son propre profil
- `edit_clinic` - Modifier les informations de la clinique
- `delete_member` - Supprimer un membre
- `delete_admin` - Supprimer un administrateur
- `transfer_ownership` - Transférer la propriété de la clinique
- `delete_clinic` - Supprimer la clinique
- `add_member` - Ajouter un nouveau membre
- `schedule_for_all` - Programmer des rendez-vous pour tous le
- `manage_patient_appointments` - Ajouter / modifier / supprimer les rendez
- `view_all_patients` - Voir tous les patients

## Integration with Existing Controllers

The clinic controller has been updated to use the permission system:

```javascript
// Old way (hardcoded role check)
if (userAccess.role !== 'admin' && userAccess.role !== 'owner') {
  return res.status(403).json({ error: 'Access denied' });
}

// New way (permission-based)
const canAddMember = await hasPermission(userId, clinicId, 'add_member');
if (!canAddMember) {
  return res.status(403).json({ error: 'Permission denied' });
}
```

This system provides much more flexibility and granular control over user permissions! 