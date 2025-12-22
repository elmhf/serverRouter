# دليل استعمال الـ WebSocket (Client-Side Guide)

يا خويا، باش تكونكتي على الـ WebSocket متاع مريض معين وتسمع التقارير (Reports) متاعو، تبع الخطوات هذي:

## 1. Connect to Socket
أول حاجة، لازمك تحل الـ connection مع السيرفر.

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  withCredentials: true, // مهم برشا
});
```

## 2. Join Patient Room (ادخل لبيت المريض)
باش السيرفر يعرف راك تحب تسمع أخبار المريض هذا (Reports متاعو)، لازمك تبعث event اسمه `select_patient`.

```javascript
// في Page متاع المريض (useEffect)
useEffect(() => {
  if (user && patientId) {
    // 1. ابعث للسيرفر راك دخلت لصفحة المريض
    socket.emit('select_patient', {
      userId: user.id,
      clinicId: user.clinic_id,
      patientId: patientId
    });
    
    console.log('📡 Joined patient room:', patientId);
  }

  // cleanup كي تخرج من الصفحة
  return () => {
    socket.off('report_created_realtime');
    socket.off('report_status_changed_detailed_realtime');
    // ... off events لخرين
  };
}, [patientId, user]);
```

## 3. Listen for Updates (اسمع الجديد)
توا، اقعد اسمع الـ events اللي يبعثهم السيرفر. أهم زوز events هوما:

### أ. تقرير جديد (`report_created_realtime`)
```javascript
socket.on('report_created_realtime', (data) => {
  console.log('🔔 تقرير جديد وصل:', data);
  // data.report فيه تفاصيل التقرير
  // data.message فيه ميساج بالعربي
  
  // مثال: زيد التقرير في الليستة
  setReports(prev => [data.report, ...prev]);
});
```

### ب. تبديل حالة التقرير (`report_status_changed_detailed_realtime`)
```javascript
socket.on('report_status_changed_detailed_realtime', (data) => {
  console.log('🔄 حالة التقرير تبدلت:', data);
  // data.oldStatus -> data.newStatus
  
  // مثال: لوّج على التقرير وبدّل الـ status متاعو
  setReports(prev => prev.map(report => 
    report.id === data.reportId 
      ? { ...report, status: data.newStatus } 
      : report
  ));
});
```

### ج. حذف تقرير (`report_deleted_detailed_realtime`)
```javascript
socket.on('report_deleted_detailed_realtime', (data) => {
  console.log('🗑️ تقرير تفسخ:', data);
  
  // نحي التقرير من الليستة
  setReports(prev => prev.filter(r => r.id !== data.reportId));
});
```

## ملخص
1.  **emit** `select_patient` -> باش تدخل للـ Room.
2.  **on** `report_created_realtime` -> كي يتصنع تقرير جديد.
3.  **on** `report_status_changed_detailed_realtime` -> كي يتبدل الـ status (processing -> completed).

جوّك مريقل! 👌
