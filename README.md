# منصة التشطيبات — Contracting & Finishing Platform

نظام متكامل لإدارة أعمال المقاولات والتشطيبات: من طلب العميل حتى نهاية الضمان.
الخطة الكاملة في [`CLAUDE.md`](CLAUDE.md)، وتقرير كل مرحلة في [`docs/`](docs).

## الحالة

| المرحلة | الحالة |
|---|---|
| 1. الأساس (الدخول، الشركات، الصلاحيات، سجل التدقيق، التصميم، الإعدادات) | ✅ مكتملة — بانتظار ربط Supabase وVercel |
| 2. الخدمات والتكاليف | التالية |

## للمطوّر

```bash
npm install
cp .env.example .env.local   # ضع مفاتيح Supabase
npm run dev                   # http://localhost:3000  — معاينة التصميم: /dev/preview
npm run check                 # فحص الكود + اختبارات الوحدة + اختبارات أمان قاعدة البيانات
npm run test:e2e              # اختبارات الواجهة (كمبيوتر، آيباد، جوال)
```

- قاعدة البيانات: `supabase/migrations/` — تُطبَّق على المشروع الحي من GitHub Actions ← *Database migrations*.
- الأمان: كل جدول محمي بـ RLS، والاختبارات في `tests/db/`.
