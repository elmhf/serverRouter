// لاستعمال FileSystem
const fs = require('fs');

// قراءة ملف JSON
fs.readFile('data/4.json', 'utf8', (err, jsonString) => {
  if (err) {
    console.error("خطأ في قراءة الملف:", err);
    return;
  }

  try {
    const data = JSON.parse(jsonString);

    // دالة استخراج أنواع المشاكل بدون تكرار
    function getUniqueProblemTypes(jsonData) {
      if (!jsonData.teeth || !Array.isArray(jsonData.teeth)) {
        console.error("لا يوجد بيانات أسنان.");
        return [];
      }

      const problemTypes = jsonData.teeth.flatMap(tooth => 
        (tooth.problems || []).map(problem => problem.type)
      );

      // إزالة التكرار باستخدام Set
      const uniqueTypes = [...new Set(problemTypes)];

      return uniqueTypes;
    }

    // استخراج الأنواع الفريدة
    const uniqueProblems = getUniqueProblemTypes(data);

    // طباعة النتيجة
    console.log(uniqueProblems);

  } catch (err) {
    console.error("خطأ في تحويل JSON:", err);
  }
});
