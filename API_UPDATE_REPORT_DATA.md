# API Update: Report Data JSON Storage

## Summary
Added a new API endpoint to update report data (JSON) in Supabase storage.

## Changes Made

### 1. New Controller Function
**File**: `controllers/reportController.js`

Added `updateReportData` function that:
- Accepts `report_id` and `report_data` in the request body
- Validates user permissions (must be a clinic member)
- Uploads/updates the `report.json` file in Supabase storage
- Updates the report's `last_upload` timestamp
- Returns the public URL of the uploaded file

**Storage Path**: `{clinic_id}/{patient_id}/{report_type}/{report_id}/report.json`

### 2. New Route
**File**: `routes/reportRoutes.js`

Added new route:
```javascript
router.put('/update-data', authMiddleware, updateReportData);
```

## API Usage

### Endpoint
```
PUT /api/reports/update-data
```

### Request Headers
```
Authorization: Bearer {token}
Content-Type: application/json
```

### Request Body
```json
{
  "report_id": "uuid-of-report",
  "report_data": {
    // Your JSON data here
    "findings": "...",
    "diagnosis": "...",
    // any other fields
  }
}
```

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Report data updated successfully",
  "status": "success",
  "report": {
    "id": "report-uuid",
    "patient_id": "patient-uuid",
    "clinic_id": "clinic-uuid",
    "raport_type": "cbct",
    "storage_path": "clinic-id/patient-id/cbct/report-id/report.json",
    "public_url": "https://...supabase.co/storage/v1/object/public/reports/..."
  }
}
```

### Error Responses

**400 Bad Request** - Missing required fields:
```json
{
  "success": false,
  "error": "Report ID is required",
  "status": "error"
}
```

**403 Forbidden** - Not a clinic member:
```json
{
  "success": false,
  "error": "You must be a member of this clinic to update reports",
  "status": "error"
}
```

**404 Not Found** - Report not found:
```json
{
  "success": false,
  "error": "Report not found",
  "status": "error"
}
```

**500 Internal Server Error** - Upload failed:
```json
{
  "success": false,
  "error": "Failed to upload report data to storage",
  "status": "error",
  "details": "error message"
}
```

## Features
- ✅ Authentication required
- ✅ Permission validation (clinic membership)
- ✅ Automatic JSON formatting (pretty print with 2-space indentation)
- ✅ Upsert functionality (creates or overwrites existing file)
- ✅ Updates `last_upload` timestamp in database
- ✅ Returns public URL for immediate access
- ✅ Comprehensive error handling

## Example Usage

```javascript
// Example: Update report data
const updateReport = async (reportId, data) => {
  const response = await fetch('/api/reports/update-data', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      report_id: reportId,
      report_data: data
    })
  });
  
  const result = await response.json();
  console.log('Report updated:', result.report.public_url);
};
```
