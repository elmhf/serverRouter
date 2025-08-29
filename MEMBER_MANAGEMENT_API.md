# 🏥 Member Management API - Documentation

## 📋 Overview
This document describes the new member management functionality added to the clinic system, including deleting members and changing their roles with proper permission controls.

## 🔐 Permission Requirements

### **Delete Member**
- Requires `delete_member` permission OR user must be clinic creator
- Cannot delete clinic creator
- Cannot delete yourself (use leave clinic instead)
- Can only delete members with equal or lower role

### **Change Member Role**
- Requires `change_role` permission OR user must be clinic creator
- Cannot change clinic creator's role
- Cannot change your own role
- Can only change roles of members with lower role than yours

## 📡 API Endpoints

### **1. Delete Clinic Member**
```http
POST /api/clinics/delete-member
```

**Request Body:**
```json
{
  "clinicId": "clinic-uuid",
  "memberId": "user-uuid"
}
```

**Response (Success):**
```json
{
  "message": "Member deleted successfully from clinic",
  "deletedMember": {
    "id": "user-uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "role": "staff"
  },
  "clinic": {
    "id": "clinic-uuid",
    "name": "Dental Clinic"
  }
}
```

**Response (Error - No Permission):**
```json
{
  "error": "You do not have permission to delete members from this clinic"
}
```

**Response (Error - Cannot Delete Creator):**
```json
{
  "error": "Cannot delete the clinic creator. Please transfer ownership first."
}
```

### **2. Change Member Role**
```http
POST /api/clinics/change-member-role
```

**Request Body:**
```json
{
  "clinicId": "clinic-uuid",
  "memberId": "user-uuid",
  "newRole": "admin"
}
```

**Valid Roles:**
- `staff` - Basic staff member
- `limited_access` - Limited access member
- `clinical_access` - Clinical access member
- `admin` - Administrator
- `owner` - Owner

**Response (Success):**
```json
{
  "message": "Member role updated successfully",
  "member": {
    "id": "user-uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "oldRole": "staff",
    "newRole": "admin"
  },
  "clinic": {
    "id": "clinic-uuid",
    "name": "Dental Clinic"
  }
}
```

**Response (Error - Invalid Role):**
```json
{
  "error": "Invalid role. Valid roles are: staff, limited_access, clinical_access, admin, owner"
}
```

**Response (Error - No Permission):**
```json
{
  "error": "You do not have permission to change member roles in this clinic"
}
```

## 🔒 Security Features

### **Role Hierarchy**
```javascript
const roleHierarchy = ['staff', 'limited_access', 'clinical_access', 'admin', 'owner'];
```

- Higher index = Higher role
- Users can only manage members with lower or equal roles
- Clinic creators have all permissions

### **Protection Rules**

#### **Delete Member Protection:**
1. ✅ Cannot delete clinic creator
2. ✅ Cannot delete yourself (use leave clinic)
3. ✅ Can only delete members with equal/lower role
4. ✅ Requires `delete_member` permission or be creator

#### **Change Role Protection:**
1. ✅ Cannot change clinic creator's role
2. ✅ Cannot change your own role
3. ✅ Can only change roles of members with lower role
4. ✅ Requires `change_role` permission or be creator

## 📊 Error Codes

| Error Type | HTTP Code | Description |
|------------|-----------|-------------|
| Missing Parameters | 400 | Required fields missing |
| Invalid Role | 400 | Role not in valid list |
| No Permission | 403 | User lacks required permission |
| Member Not Found | 404 | Member not in clinic |
| Database Error | 500 | Server/database error |

## 🚀 Usage Examples

### **Frontend React Example:**

```javascript
// Delete a member
const deleteMember = async (clinicId, memberId) => {
  try {
    const response = await fetch('/api/clinics/delete-member', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clinicId,
        memberId
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('Member deleted:', data.message);
      // Refresh member list
    } else {
      console.error('Error:', data.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
};

// Change member role
const changeRole = async (clinicId, memberId, newRole) => {
  try {
    const response = await fetch('/api/clinics/change-member-role', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clinicId,
        memberId,
        newRole
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('Role changed:', data.message);
      // Refresh member list
    } else {
      console.error('Error:', data.error);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
};
```

### **Permission Check Example:**

```javascript
// Check if user can delete members
const canDeleteMembers = async (clinicId) => {
  try {
    const response = await fetch('/api/permissions/check-permission', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clinicId,
        permissionKey: 'delete_member'
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
const MemberList = ({ clinicId }) => {
  const [canDelete, setCanDelete] = useState(false);
  
  useEffect(() => {
    const checkPermission = async () => {
      const hasPermission = await canDeleteMembers(clinicId);
      setCanDelete(hasPermission);
    };
    
    checkPermission();
  }, [clinicId]);
  
  return (
    <div>
      {members.map(member => (
        <div key={member.id}>
          <span>{member.name}</span>
          {canDelete && (
            <button onClick={() => deleteMember(clinicId, member.id)}>
              Delete
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
```

## 🔄 Integration with Existing System

### **Updated Functions:**
- ✅ `inviteClinicMember` - Now uses permission system
- ✅ `deleteClinicMember` - New function with full security
- ✅ `changeMemberRole` - New function with role hierarchy
- ✅ `leaveClinic` - Existing function (unchanged)

### **Permission Keys Used:**
- `delete_member` - For deleting members
- `change_role` - For changing member roles
- `add_member` - For inviting members (existing)

## 📝 Notes

1. **Clinic Creator Protection**: Clinic creators cannot be deleted or have their roles changed
2. **Self-Protection**: Users cannot delete themselves or change their own roles
3. **Role Hierarchy**: Strict hierarchy enforcement prevents privilege escalation
4. **Permission-Based**: All actions require specific permissions or creator status
5. **Audit Trail**: All actions are logged for security purposes

The system now provides complete member management with proper security controls! 🎉 