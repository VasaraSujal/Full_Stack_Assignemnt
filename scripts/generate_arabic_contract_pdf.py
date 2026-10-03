import os
import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register Arial font with Arabic Unicode support
font_path = 'C:/Windows/Fonts/arial.ttf'
bold_font_path = 'C:/Windows/Fonts/arialbd.ttf'

pdfmetrics.registerFont(TTFont('ArabicFont', font_path))
pdfmetrics.registerFont(TTFont('ArabicFontBold', bold_font_path if os.path.exists(bold_font_path) else font_path))

def ar(text: str) -> str:
    """Reshape and reorder Arabic text for correct RTL visual rendering in PDF."""
    if not text:
        return ""
    reshaped = arabic_reshaper.reshape(text)
    return get_display(reshaped)

def draw_header_footer(c, page_num, total_pages=4):
    width, height = letter
    # Top header line
    c.setStrokeColorRGB(0.12, 0.23, 0.54) # Deep Navy
    c.setLineWidth(1.5)
    c.line(54, height - 50, width - 54, height - 50)
    
    c.setFont('ArabicFont', 9)
    c.setFillColorRGB(0.35, 0.40, 0.50)
    c.drawRightString(width - 54, height - 42, ar("عقد تقديم خدمات تقنية واتفاقية سرية المعلومات — نسخة معتمدة"))
    c.drawString(54, height - 42, "CONFIDENTIAL & PROPRIETARY")

    # Bottom footer line
    c.setStrokeColorRGB(0.85, 0.88, 0.92)
    c.setLineWidth(1)
    c.line(54, 50, width - 54, 50)
    
    c.setFont('ArabicFont', 9)
    c.setFillColorRGB(0.40, 0.45, 0.55)
    page_str = f"صفحة {page_num} من {total_pages}"
    c.drawRightString(width - 54, 38, ar(page_str))
    c.drawString(54, 38, "Lexicon AI Evaluation Sample Agreement")

def generate_arabic_pdf(output_path: str):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    c = canvas.Canvas(output_path, pagesize=letter)
    width, height = letter
    right_margin = width - 54
    
    # =========================================================================
    # PAGE 1: PREAMBLE, PARTIES, PURPOSE & SCOPE
    # =========================================================================
    draw_header_footer(c, 1)
    y = height - 90
    
    # Document Main Title
    c.setFont('ArabicFontBold', 18)
    c.setFillColorRGB(0.10, 0.20, 0.50)
    c.drawRightString(right_margin, y, ar("عقد تقديم خدمات تقنية واتفاقية سرية المعلومات"))
    y -= 25
    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.40, 0.45, 0.55)
    c.drawRightString(right_margin, y, ar("اتفاقية تجارية ملزمة قانونياً لتنفيذ وتطوير الأنظمة السحابية وحماية البيانات"))
    y -= 35

    # Article 1: Parties
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة الأولى: أطراف الاتفاقية والتمهيد القانوني"))
    y -= 20
    
    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p1_lines = [
        "تم إبرام هذا العقد والاتفاق عليه في يوم الأحد بتاريخ 01 أكتوبر 2026م بين كل من:",
        "1. الطرف الأول: شركة التقنية المتقدمة للحلول الرقمية، شركة ذات مسؤولية محدودة مسجلة في السجل التجاري",
        "برقم 1010892341 ويمثلها في التوقيع على هذا العقد الرئيس التنفيذي ويشار إليها لاحقاً بـ (المزود).",
        "2. الطرف الثاني: مؤسسة الخدمات الاستشارية وتطوير الأعمال، مؤسسة تجارية مسجلة بالسجل التجاري",
        "برقم 1010543210 ويمثلها في التوقيع المدير العام ويشار إليها لاحقاً بـ (العميل).",
        "وحيث أن الطرف الأول يمتلك الكفاءة والخبرة الفنية في هندسة البرمجيات والأنظمة السحابية،",
        "ورغب الطرف الثاني في الاستعانة بخدماته، فقد التقت إرادة الطرفين على التعاقد وفق البنود التالية."
    ]
    for line in p1_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    y -= 20
    # Article 2: Scope of Services
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة الثانية: نطاق العمل والخدمات الهندسية"))
    y -= 20

    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p2_lines = [
        "يلتزم الطرف الأول (المزود) بتقديم الخدمات الفنية والهندسية التالية لصالح الطرف الثاني:",
        "أولاً: تصميم وتطوير منصة سحابية لإدارة العقود وتحليل الوثائق القانونية بالذكاء الاصطناعي.",
        "ثانياً: دمج واجهات برمجة التطبيقات واستخراج النصوص وضمان دقة المطابقة بنسبة لا تقل عن 99%.",
        "ثالثاً: توفير بيئة سحابية آمنة ومعزولة مع تشفير البيانات الحساسة أثناء النقل والتخزين.",
        "رابعاً: تدريب فريق عمل الطرف الثاني وتقديم الدعم الفني والصيانة المستمرة خلال فترة التشغيل التجريبي."
    ]
    for line in p2_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    c.showPage()

    # =========================================================================
    # PAGE 2: FINANCIAL COMPENSATION & PAYMENT TERMS
    # =========================================================================
    draw_header_footer(c, 2)
    y = height - 90

    # Article 3: Financial Terms
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة الثالثة: المقابل المالي وجدول سداد الدفعات"))
    y -= 20

    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p3_lines = [
        "1. تبلغ القيمة الإجمالية لهذا العقد مبلغاً وقدره 150,000 ريال سعودي (مائة وخمسون ألف ريال سعودي)",
        "غير شاملة ضريبة القيمة المضافة المقررة نظاماً.",
        "2. اتفق الطرفان على سداد المستحقات المالية وفق جدول الدفعات المرحلي التالي:",
        "   - الدفعة الأولى: نسبة 30% وقدرها 45,000 ريال سعودي تستحق فور توقيع هذا العقد.",
        "   - الدفعة الثانية: نسبة 40% وقدرها 60,000 ريال سعودي تستحق بعد اكتمال مرحلة الاختبارات التجريبية.",
        "   - الدفعة الثالثة: نسبة 30% وقدرها 45,000 ريال سعودي تستحق عند التسليم النهائي للمشروع واعتماده رسمياً.",
        "3. يلتزم العميل بسداد كل دفعة خلال مدة لا تتجاوز 15 يوماً من تاريخ استلام الفاتورة الضريبية المعتمدة."
    ]
    for line in p3_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    y -= 25
    # Article 4: Obligations
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة الرابعة: التزامات وحقوق الطرفين"))
    y -= 20

    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p4_lines = [
        "1. يلتزم الطرف الثاني (العميل) بتوفير كافة المتطلبات والمعلومات الفنية والتراخيص اللازمة في المواعيد المحددة.",
        "2. يلتزم الطرف الأول (المزود) بتخصيص فريق هندسي مؤهل لتنفيذ المهام الموكلة إليه دون تأخير غير مبرر.",
        "3. يحق للعميل مراجعة وتقييم مخرجات العمل في كل مرحلة، وتقديم ملاحظاته الخطية خلال 7 أيام عمل.",
        "4. لا يجوز لأي طرف التنازل عن هذا العقد أو أي من حقوقه أو التزاماته لأي طرف ثالث دون موافقة خطية مسبقة."
    ]
    for line in p4_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    c.showPage()

    # =========================================================================
    # PAGE 3: CONFIDENTIALITY & INTELLECTUAL PROPERTY
    # =========================================================================
    draw_header_footer(c, 3)
    y = height - 90

    # Article 5: Confidentiality & Data Protection
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة الخامسة: سرية المعلومات وحماية البيانات"))
    y -= 20

    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p5_lines = [
        "1. يُقصد بـ (المعلومات السرية) كافة البيانات الفنية، والمالية، والتجارية، والوثائق، والرموز البرمجية،",
        "والمعلومات التي يفصح عنها أي طرف للطرف الآخر بموجب هذا العقد سواء كانت شفهية أو كتابية أو إلكترونية.",
        "2. يلتزم الطرفان بالحفاظ التام على سرية هذه المعلومات واتخاذ كافة التدابير الأمنية لمنع تسريبها أو كشفها.",
        "3. لا يشمل التزام السرية المعلومات المتاحة للعموم بشكل مشروع، أو التي كانت معلومة للطرف المتلقي مسبقاً.",
        "4. يستمر التزام السرية سارياً طوال مدة سريان هذا العقد ولمدة خمس (5) سنوات كاملة بعد انتهائه أو إنهائه لأي سبب.",
        "5. في حال انتهاء العقد، يلتزم كل طرف بإعادة أو إتلاف كافة النسخ والوثائق السرية وتقديم إقرار كتابي بذلك."
    ]
    for line in p5_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    y -= 25
    # Article 6: Intellectual Property
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة السادسة: حقوق الملكية الفكرية"))
    y -= 20

    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p6_lines = [
        "1. تعود ملكية كافة البرمجيات، والتقارير، والمخرجات المطورة خصيصاً لصالح الطرف الثاني للعميل حصرياً فور سداد كامل المقابل المالي.",
        "2. يحتفظ المزود بحقوق ملكية أدواته البرمجية المسبقة والمكتبات الأساسية العامة التي تم استخدامها في التطوير.",
        "3. يمنح المزود العميل ترخيصاً دائماً وغير حصري وخالياً من الإتاوات لاستخدام تلك الأدوات ضمن النظام المسلّم."
    ]
    for line in p6_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    c.showPage()

    # =========================================================================
    # PAGE 4: TERM, TERMINATION, GOVERNING LAW & SIGNATURES
    # =========================================================================
    draw_header_footer(c, 4)
    y = height - 90

    # Article 7: Term & Termination
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة السابعة: مدة العقد والإنهاء"))
    y -= 20

    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p7_lines = [
        "1. يسري هذا العقد لمدة سنة ميلادية كاملة (12 شهراً) تبدأ من تاريخ توقيعه من قبل ممثلي الطرفين.",
        "2. يتجدد العقد تلقائياً لمدد مماثلة ما لم يخطر أحد الطرفين الآخر كتابة بعدم رغبته في التجديد قبل 30 يوماً على الأقل.",
        "3. يجوز لأي طرف إنهاء العقد فوراً بإشعار كتابي في حال إخلال الطرف الآخر بأي بند جوهري وعجزه عن تصحيحه خلال 14 يوماً."
    ]
    for line in p7_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    y -= 20
    # Article 8: Governing Law & Jurisdiction
    c.setFont('ArabicFontBold', 13)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(right_margin, y, ar("المادة الثامنة: القانون الواجب التطبيق والاختصاص القضائي"))
    y -= 20

    c.setFont('ArabicFont', 11)
    c.setFillColorRGB(0.15, 0.18, 0.25)
    p8_lines = [
        "1. يخضع هذا العقد ويفسر في جميع أحكامه وبنوده وفقاً للأنظمة واللوائح والقرارات السارية في المملكة العربية السعودية.",
        "2. في حال حدوث أي نزاع ينشأ عن تفسير أو تنفيذ هذا العقد، يسعى الطرفان لحله ودياً خلال ثلاثين (30) يوماً.",
        "3. في حال تعذر الحل الودي، ينعقد الاختصاص القضائي الحصري للمحاكم التجارية المختصة في مدينة الرياض."
    ]
    for line in p8_lines:
        c.drawRightString(right_margin, y, ar(line))
        y -= 19

    y -= 30
    # Signatures
    c.setFont('ArabicFontBold', 12)
    c.setFillColorRGB(0.10, 0.20, 0.50)
    c.drawRightString(right_margin, y, ar("خاتمة العقد وتوقيعات ممثلي الطرفين المفوضين:"))
    y -= 30

    # Draw two signature boxes side-by-side
    box_w = 220
    box_h = 100
    
    # Party 1 Box (Right side in RTL)
    p1_box_x = width - 54 - box_w
    c.setStrokeColorRGB(0.80, 0.85, 0.92)
    c.setFillColorRGB(0.97, 0.98, 1.00)
    c.roundRect(p1_box_x, y - box_h, box_w, box_h, 6, fill=1, stroke=1)
    
    c.setFont('ArabicFontBold', 10)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(p1_box_x + box_w - 15, y - 22, ar("الطرف الأول (المزود):"))
    c.setFont('ArabicFont', 9)
    c.setFillColorRGB(0.25, 0.30, 0.40)
    c.drawRightString(p1_box_x + box_w - 15, y - 40, ar("شركة التقنية المتقدمة للحلول الرقمية"))
    c.drawRightString(p1_box_x + box_w - 15, y - 56, ar("الممثل: الرئيس التنفيذي"))
    c.drawRightString(p1_box_x + box_w - 15, y - 76, ar("التوقيع: [معتمد إلكترونياً]"))

    # Party 2 Box (Left side in RTL)
    p2_box_x = 54
    c.roundRect(p2_box_x, y - box_h, box_w, box_h, 6, fill=1, stroke=1)
    
    c.setFont('ArabicFontBold', 10)
    c.setFillColorRGB(0.12, 0.23, 0.54)
    c.drawRightString(p2_box_x + box_w - 15, y - 22, ar("الطرف الثاني (العميل):"))
    c.setFont('ArabicFont', 9)
    c.setFillColorRGB(0.25, 0.30, 0.40)
    c.drawRightString(p2_box_x + box_w - 15, y - 40, ar("مؤسسة الخدمات الاستشارية وتطوير الأعمال"))
    c.drawRightString(p2_box_x + box_w - 15, y - 56, ar("الممثل: المدير العام"))
    c.drawRightString(p2_box_x + box_w - 15, y - 76, ar("التوقيع: [معتمد إلكترونياً]"))

    c.showPage()
    c.save()
    print(f"Generated Arabic Contract PDF: {output_path} (4 pages)")

if __name__ == '__main__':
    target = os.path.join(os.getcwd(), 'sample-contracts', 'arabic-commercial-agreement.pdf')
    generate_arabic_pdf(target)
