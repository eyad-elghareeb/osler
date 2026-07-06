/**
 * Sample medical articles for the Osler Library view.
 * Modeled after AMBOSS-style article structure: TOC tree → specialty → article.
 */

export interface ArticleTocNode {
  id: string;
  label: string;
  children?: ArticleTocNode[];
  articleId?: string; // present on leaf nodes
}

export interface Article {
  id: string;
  title: string;
  specialty: string;
  system: string;
  readTimeMin: number;
  html: string;
  tags?: string[];
}

export const ARTICLE_TOC: ArticleTocNode[] = [
  {
    id: "cardiology",
    label: "Cardiology",
    children: [
      {
        id: "cardiology-isc",
        label: "Ischemic Syndrome",
        children: [
          { id: "art-stemi", label: "ST-Elevation Myocardial Infarction", articleId: "art-stemi" },
          { id: "art-acs", label: "Acute Coronary Syndromes Overview", articleId: "art-acs" },
        ],
      },
      {
        id: "cardiology-failure",
        label: "Heart Failure",
        children: [
          { id: "art-hf", label: "Heart Failure — Reduced Ejection Fraction", articleId: "art-hf" },
        ],
      },
    ],
  },
  {
    id: "pulmonology",
    label: "Pulmonology",
    children: [
      {
        id: "pulm-obstructive",
        label: "Obstructive Disease",
        children: [
          { id: "art-copd", label: "Chronic Obstructive Pulmonary Disease", articleId: "art-copd" },
          { id: "art-asthma", label: "Asthma — Diagnosis & Management", articleId: "art-asthma" },
        ],
      },
      {
        id: "pulm-vascular",
        label: "Vascular Disease",
        children: [
          { id: "art-pe", label: "Pulmonary Embolism", articleId: "art-pe" },
        ],
      },
    ],
  },
  {
    id: "neurology",
    label: "Neurology",
    children: [
      {
        id: "neuro-stroke",
        label: "Cerebrovascular",
        children: [
          { id: "art-stroke", label: "Acute Ischemic Stroke", articleId: "art-stroke" },
          { id: "art-sah", label: "Subarachnoid Hemorrhage", articleId: "art-sah" },
        ],
      },
    ],
  },
  {
    id: "gastroenterology",
    label: "Gastroenterology",
    children: [
      {
        id: "gi-liver",
        label: "Hepatobiliary",
        children: [
          { id: "art-cirrhosis", label: "Cirrhosis & Portal Hypertension", articleId: "art-cirrhosis" },
        ],
      },
    ],
  },
];

export const ARTICLES: Record<string, Article> = {
  "art-stemi": {
    id: "art-stemi",
    title: "ST-Elevation Myocardial Infarction",
    specialty: "Cardiology",
    system: "Ischemic Syndrome",
    readTimeMin: 8,
    tags: ["emergency", "ischemia", "ECG"],
    html: `
<h1>ST-Elevation Myocardial Infarction (STEMI)</h1>
<p><strong>STEMI</strong> is a type of acute coronary syndrome characterized by complete occlusion of an epicardial coronary artery, resulting in transmural myocardial ischemia and ST-segment elevation on the ECG. It is a <strong>medical emergency</strong> requiring immediate reperfusion therapy.</p>

<h2>Pathophysiology</h2>
<p>STEMI most commonly results from rupture of an atherosclerotic plaque with subsequent thrombus formation, leading to complete occlusion of the coronary artery. The ensuing ischemia results in myocardial necrosis within 20–30 minutes if not relieved. The infarct begins subendocardially and extends transmurally as ischemia persists.</p>

<div class="callout">
  <strong>Key concept:</strong> "Time is muscle." Every minute of delay in reperfusion results in additional cardiomyocyte death. The goal is <strong>door-to-balloon time ≤ 90 minutes</strong> for primary PCI.
</div>

<h2>Clinical Presentation</h2>
<p>The classic presentation of STEMI includes:</p>
<ul>
  <li><strong>Chest pain:</strong> Retrosternal, crushing/pressure-like, lasting &gt; 20 minutes, not relieved by rest or nitroglycerin</li>
  <li><strong>Radiation:</strong> To the left arm, jaw, neck, or back (in 30% of cases)</li>
  <li><strong>Associated symptoms:</strong> Diaphoresis, nausea, vomiting, dyspnea, palpitations</li>
  <li><strong>Atypical presentation:</strong> More common in women, diabetics, and the elderly — epigastric pain, fatigue, or syncope may be the only symptom</li>
</ul>

<h2>ECG Criteria</h2>
<p>ST-segment elevation in <strong>≥ 2 contiguous leads</strong>:</p>
<table>
  <thead>
    <tr><th>Artery</th><th>Leads with ST elevation</th><th>Localization</th></tr>
  </thead>
  <tbody>
    <tr><td>LAD</td><td>V1–V4</td><td>Anterior</td></tr>
    <tr><td>LAD (proximal)</td><td>V1–V4 + I, aVL</td><td>Anterolateral</td></tr>
    <tr><td>LCx</td><td>I, aVL, V5–V6</td><td>Lateral</td></tr>
    <tr><td>RCA</td><td>II, III, aVF</td><td>Inferior</td></tr>
    <tr><td>RCA (proximal)</td><td>II, III, aVF + V1</td><td>Inferior + RV infarct</td></tr>
  </tbody>
</table>

<div class="warning">
  <strong>Caution:</strong> In inferior STEMI, always obtain a <strong>right-sided ECG (V4R)</strong> to assess for RV involvement. RV infarct is preload-dependent — avoid nitrates, which can cause profound hypotension.
</div>

<h2>Diagnosis</h2>
<p>The diagnosis of STEMI is made by ECG; do not wait for cardiac biomarkers. <strong>Troponin I/T</strong> rises within 3–4 hours, peaks at 18–24 hours, and remains elevated for 7–10 days. CK-MB is less specific but useful for detecting reinfarction (returns to baseline in 48–72 hours).</p>

<h2>Management</h2>
<h3>Initial Treatment (MONA-B)</h3>
<ul>
  <li><strong>M</strong>orphine: 2–4 mg IV for refractory pain (use sparingly — may delay antiplatelet absorption)</li>
  <li><strong>O</strong>xygen: Only if SpO₂ &lt; 90% (routine O₂ in normoxic patients increases mortality)</li>
  <li><strong>N</strong>itroglycerin: SL or IV for ongoing chest pain <em>(contraindicated in RV infarct, hypotension, recent PDE-5 inhibitor use)</em></li>
  <li><strong>A</strong>spirin: 162–325 mg chewed immediately</li>
  <li><strong>B</strong>eta-blocker: Metoprolol 25 mg PO (IV only if hypertensive/tachycardic; <em>contraindicated in acute heart failure, hypotension, severe bronchospasm, advanced AV block</em>)</li>
</ul>

<h3>Reperfusion Therapy</h3>
<p><strong>Primary PCI</strong> is the preferred reperfusion strategy if it can be performed within <strong>120 minutes</strong> of first medical contact:</p>
<ul>
  <li>Door-to-balloon time ≤ 90 minutes</li>
  <li>Stent placement + aspiration thrombectomy if large thrombus burden</li>
  <li>Drug-eluting stent preferred — requires 12 months of dual antiplatelet therapy (DAPT)</li>
</ul>

<p>If PCI cannot be achieved within 120 minutes, <strong>fibrinolytic therapy</strong> with IV alteplase (tPA) or tenecteplase (TNK) should be given within 30 minutes of arrival ("door-to-needle time"). Fibrinolytics must be administered within <strong>12 hours</strong> of symptom onset.</p>

<h3>Adjunctive Medical Therapy</h3>
<ul>
  <li><strong>P2Y12 inhibitor:</strong> Ticagrelor 180 mg loading → 90 mg BID, OR clopidogrel 600 mg loading → 75 mg daily</li>
  <li><strong>Anticoagulation:</strong> Unfractionated heparin, enoxaparin, or bivalirudin during PCI</li>
  <li><strong>Statin:</strong> Atorvastatin 80 mg daily (high-intensity)</li>
  <li><strong>ACE inhibitor:</strong> Lisinopril within 24 hours (especially in anterior STEMI, LV dysfunction, or diabetes)</li>
  <li><strong>ARB:</strong> Valsartan if ACE inhibitor not tolerated</li>
</ul>

<h2>Complications</h2>
<h3>Early (≤ 72 hours)</h3>
<ul>
  <li>Reperfusion arrhythmias (most commonly accelerated idioventricular rhythm)</li>
  <li>Cardiogenic shock (especially in large anterior STEMI)</li>
  <li>Acute mitral regurgitation from papillary muscle rupture</li>
  <li>Ventricular free wall rupture (peak 3–5 days) — cardiac tamponade</li>
  <li>Ventricular septal rupture (peak 3–5 days)</li>
</ul>

<h3>Late (&gt; 72 hours)</h3>
<ul>
  <li>Post-infarction pericarditis (Dressler syndrome, 2–10 weeks) — autoimmune-mediated</li>
  <li>Ventricular aneurysm — persistent ST elevation, heart failure, thromboembolism</li>
  <li>Heart failure with reduced ejection fraction</li>
</ul>

<h2>Prognosis</h2>
<p>In-hospital mortality for STEMI is approximately 5–8% with primary PCI and 7–10% with fibrinolytics. Major predictors of mortality include age, Killip class, time to reperfusion, anterior infarct location, and development of cardiogenic shock (which carries &gt; 50% mortality).</p>
`,
  },
  "art-acs": {
    id: "art-acs",
    title: "Acute Coronary Syndromes — Overview",
    specialty: "Cardiology",
    system: "Ischemic Syndrome",
    readTimeMin: 6,
    tags: ["ischemia", "overview"],
    html: `
<h1>Acute Coronary Syndromes (ACS)</h1>
<p><strong>Acute coronary syndromes</strong> represent a spectrum of conditions resulting from acute myocardial ischemia, ranging from unstable angina to ST-elevation myocardial infarction. They share a common underlying pathophysiology: <strong>atherosclerotic plaque rupture or erosion with varying degrees of thrombus formation</strong>.</p>

<h2>Classification</h2>
<table>
  <thead>
    <tr><th>Type</th><th>ST changes</th><th>Troponin</th></tr>
  </thead>
  <tbody>
    <tr><td>Unstable angina (UA)</td><td>None / transient</td><td>Normal</td></tr>
    <tr><td>NSTEMI</td><td>None / transient</td><td>Elevated</td></tr>
    <tr><td>STEMI</td><td>Persistent ST elevation</td><td>Elevated</td></tr>
  </tbody>
</table>

<h2>Pathophysiology</h2>
<p>The central event is <strong>plaque rupture or erosion</strong>, exposing the thrombogenic lipid core to circulating blood. Platelets adhere (via von Willebrand factor and glycoprotein Ib), activate, and aggregate (via glycoprotein IIb/IIIa). The coagulation cascade is activated, generating thrombin and converting fibrinogen to fibrin. The resulting thrombus partially or completely occludes the lumen.</p>

<h2>Clinical Presentation</h2>
<p>Patients typically present with chest pain that is:</p>
<ul>
  <li>New-onset (≤ 2 months)</li>
  <li>Acceleration/worsening of stable angina</li>
  <li>At rest and prolonged (&gt; 20 minutes)</li>
</ul>

<h2>Risk Stratification</h2>
<p>The <strong>GRACE score</strong> uses age, heart rate, blood pressure, creatinine, Killip class, ST deviation, cardiac arrest at admission, and elevated biomarkers to estimate 6-month mortality. High-risk patients (GRACE &gt; 140) benefit from early invasive strategy within 24 hours.</p>

<h2>Initial Management</h2>
<p>All ACS patients receive:</p>
<ul>
  <li>Aspirin 162–325 mg chewed</li>
  <li>P2Y12 inhibitor (ticagrelor preferred; clopidogrel if contraindicated)</li>
  <li>Anticoagulation (unfractionated heparin, enoxaparin, or fondaparinux)</li>
  <li>High-intensity statin (atorvastatin 80 mg)</li>
  <li>Beta-blocker (if no acute heart failure, hypotension, or bradycardia)</li>
</ul>

<div class="callout">
  <strong>STEMI vs NSTEMI distinction matters:</strong> STEMI requires <em>immediate</em> reperfusion (PCI ≤ 90 min, or fibrinolytics ≤ 30 min). NSTEMI/UA uses an <em>early invasive</em> strategy (PCI within 24–72 hours for high-risk) or <em>conservative</em> strategy (medical management with PCI only if symptoms recur or risk stratifies high).
</div>
`,
  },
  "art-hf": {
    id: "art-hf",
    title: "Heart Failure — Reduced Ejection Fraction",
    specialty: "Cardiology",
    system: "Heart Failure",
    readTimeMin: 9,
    tags: ["heart-failure", "chronic"],
    html: `
<h1>Heart Failure with Reduced Ejection Fraction (HFrEF)</h1>
<p><strong>HFrEF</strong> is defined by left ventricular ejection fraction (LVEF) ≤ 40% with symptoms or signs of heart failure. It is a progressive syndrome characterized by maladaptive cardiac remodeling, neurohormonal activation, and worsening contractile function.</p>

<h2>Etiology</h2>
<p>The most common causes of HFrEF include:</p>
<ul>
  <li><strong>Coronary artery disease</strong> (50–60% of cases) — prior MI, ischemic cardiomyopathy</li>
  <li><strong>Hypertension</strong> — long-standing pressure overload</li>
  <li><strong>Valvular disease</strong> — aortic stenosis, mitral regurgitation</li>
  <li><strong>Dilated cardiomyopathy</strong> — genetic, alcohol-induced, viral myocarditis, chemotherapy (doxorubicin)</li>
  <li><strong>Tachycardia-mediated cardiomyopathy</strong> — untreated AF/flutter</li>
</ul>

<h2>Pathophysiology</h2>
<p>Decreased cardiac output triggers compensatory mechanisms that become maladaptive over time:</p>

<h3>1. Sympathetic Nervous System (SNS)</h3>
<p>Reduced stroke volume activates baroreceptors, increasing norepinephrine release. Initially beneficial (increases heart rate and contractility), chronic SNS activation causes:</p>
<ul>
  <li>Cardiomyocyte apoptosis</li>
  <li>LV hypertrophy and dilation</li>
  <li>Arrhythmias</li>
  <li>Renin release from juxtaglomerular cells</li>
</ul>

<h3>2. Renin-Angiotensin-Aldosterone System (RAAS)</h3>
<p>Renin converts angiotensinogen to angiotensin I, then ACE converts it to angiotensin II. Angiotensin II:</p>
<ul>
  <li>Vasoconstricts efferent renal arterioles (maintains GFR but increases afterload)</li>
  <li>Promotes aldosterone secretion → sodium retention + potassium excretion</li>
  <li>Stimulates ADH release → water retention</li>
  <li>Promotes cardiac fibrosis and hypertrophy</li>
</ul>

<h3>3. Ventricular Remodeling</h3>
<p>Chronically elevated wall stress causes myocyte hypertrophy, interstitial fibrosis, and chamber dilation. The ventricle becomes more spherical, mitral regurgitation worsens, and stroke volume declines further — a vicious cycle.</p>

<div class="callout">
  <strong>Guideline-directed medical therapy (GDMT)</strong> targets these maladaptive pathways. All four pillars — beta-blocker, ACEi/ARB/ARNI, MRA, SGLT2i — have been shown to reduce mortality in HFrEF and should be initiated in all patients unless contraindicated.
</div>

<h2>Clinical Presentation</h2>
<h3>Left-sided heart failure</h3>
<ul>
  <li>Dyspnea on exertion → progressing to dyspnea at rest</li>
  <li>Orthopnea (≤ 2 pillows → ≥ 3 pillows)</li>
  <li>Paroxysmal nocturnal dyspnea (PND)</li>
  <li>Bendopnea (dyspnea bending forward)</li>
  <li>Fatigue, exercise intolerance</li>
  <li>Nocturnal cough, wheezing (cardiac asthma)</li>
</ul>

<h3>Right-sided heart failure</h3>
<ul>
  <li>Peripheral edema (ankles, sacrum)</li>
  <li>Hepatomegaly with right upper quadrant pain</li>
  <li>Jugular venous distension (JVD)</li>
  <li>Ascites, anasarca in severe cases</li>
</ul>

<h2>Diagnosis</h2>
<h3>Echocardiography</h3>
<p>The single most useful test. Confirms reduced LVEF (≤ 40%), assesses chamber sizes, wall motion abnormalities, valvular function, and estimates pulmonary artery systolic pressure.</p>

<h3>BNP / NT-proBNP</h3>
<p>BNP &gt; 100 pg/mL or NT-proBNP &gt; 300 pg/mL supports heart failure diagnosis. Levels correlate with severity and prognosis. Normal BNP (&lt; 50) effectively excludes heart failure in acute dyspnea.</p>

<h3>Other Workup</h3>
<ul>
  <li><strong>ECG:</strong> Look for prior MI, LV hypertrophy, arrhythmias, bundle branch block</li>
  <li><strong>Chest X-ray:</strong> Cardiomegaly, pulmonary edema, Kerley B lines, pleural effusions</li>
  <li><strong>Lab work:</strong> BUN/creatinine, electrolytes, TSH, iron studies, CBC, LFTs</li>
  <li><strong>Coronary angiography:</strong> If suspected ischemic etiology</li>
</ul>

<h2>Management — The Four Pillars of GDMT</h2>

<h3>Pillar 1: Beta-blocker</h3>
<p>One of three evidence-based agents: <strong>carvedilol, metoprolol succinate, or bisoprolol</strong>. Start low, titrate to target dose every 2 weeks. Reduces mortality by ~35%.</p>

<h3>Pillar 2: ACEi / ARB / ARNI</h3>
<p><strong>ARNI</strong> (sacubitril/valsartan) is preferred over ACEi/ARB based on PARADIGM-HF. If initiating ARNI, must wait 36 hours after last ACE inhibitor dose (risk of angioedema). Reduces mortality ~20%.</p>

<h3>Pillar 3: Mineralocorticoid Receptor Antagonist (MRA)</h3>
<p><strong>Spironolactone</strong> or <strong>eplerenone</strong>. Reduces mortality 30% in NYHA III–IV. Monitor potassium and creatinine closely (risk of hyperkalemia).</p>

<h3>Pillar 4: SGLT2 inhibitor</h3>
<p><strong>Dapagliflozin</strong> or <strong>empagliflozin</strong>. Reduces HF hospitalization and cardiovascular mortality regardless of diabetes status.</p>

<h3>Additional therapies</h3>
<ul>
  <li><strong>Diuretics</strong> (loop diuretics — furosemide, torsemide): For symptom control in volume overload. Do NOT reduce mortality.</li>
  <li><strong>Ivabradine:</strong> If HR &gt; 70 bpm on max tolerated beta-blocker</li>
  <li><strong>Digoxin:</strong> Symptom control only; no mortality benefit</li>
  <li><strong>Hydralazine + nitrate:</strong> Self-identified African American patients with NYHA III–IV despite optimal GDMT</li>
  <li><strong>ICD:</strong> Primary prevention if LVEF ≤ 35% after ≥ 3 months of optimal GDMT</li>
  <li><strong>Cardiac resynchronization therapy (CRT):</strong> LVEF ≤ 35% + LBBB + QRS ≥ 150 ms</li>
</ul>

<h2>Prognosis</h2>
<p>Five-year mortality for HFrEF remains ~50% despite optimal therapy. Patients who achieve <strong>LVEF recovery ≥ 50%</strong> after treatment may have HFimpEF (improved) and can often have medications de-escalated under specialist supervision.</p>
`,
  },
  "art-copd": {
    id: "art-copd",
    title: "Chronic Obstructive Pulmonary Disease",
    specialty: "Pulmonology",
    system: "Obstructive Disease",
    readTimeMin: 10,
    tags: ["obstructive", "chronic", "smoking"],
    html: `
<h1>Chronic Obstructive Pulmonary Disease (COPD)</h1>
<p><strong>COPD</strong> is a common, preventable, and treatable disease characterized by persistent respiratory symptoms and airflow limitation due to airway and/or alveolar abnormalities, usually caused by significant exposure to noxious particles or gases.</p>

<h2>Risk Factors</h2>
<ul>
  <li><strong>Tobacco smoking</strong> (most important; ~80% of COPD deaths)</li>
  <li><strong>Occupational exposure</strong> — dusts, chemicals (coal, grain, cadmium)</li>
  <li><strong>Indoor biomass fuel</strong> — wood/dung smoke (major cause in developing countries)</li>
  <li><strong>Alpha-1 antitrypsin deficiency</strong> — early-onset panacinar emphysema, especially in non-smokers &lt; 45 years</li>
  <li><strong>Childhood respiratory infections</strong> — reduce maximal lung growth</li>
</ul>

<h2>Pathophysiology</h2>
<p>COPD encompasses two coexisting conditions:</p>

<h3>Chronic Bronchitis</h3>
<p>Chronic inflammation of the bronchi with <strong>mucus gland hyperplasia</strong> and increased sputum production. Clinically defined as <strong>productive cough for ≥ 3 months in 2 consecutive years</strong>. Hypertrophy of mucus-secreting glands increases the <strong>Reid index</strong> (gland-to-wall thickness ratio, normal &lt; 0.4).</p>

<h3>Emphysema</h3>
<p>Permanent abnormal enlargement of airspaces distal to the terminal bronchiole, with destruction of alveolar walls. Two patterns:</p>
<ul>
  <li><strong>Centriacinar:</strong> Affects respiratory bronchioles (upper lobes); smoking-related</li>
  <li><strong>Panacinar:</strong> Affects entire acinus (lower lobes); alpha-1 antitrypsin deficiency</li>
</ul>

<p>Protease-antiprotease imbalance: neutrophil-derived elastase destroys alveolar walls. Alpha-1 antitrypsin normally inhibits elastase; deficiency or smoking-induced inactivation tips the balance toward tissue destruction.</p>

<h2>Clinical Presentation</h2>
<table>
  <thead>
    <tr><th>Feature</th><th>Chronic Bronchitis ("Blue Bloater")</th><th>Emphysema ("Pink Puffer")</th></tr>
  </thead>
  <tbody>
    <tr><td>Age</td><td>~50s</td><td>~60s</td></tr>
    <tr><td>Body habitus</td><td>Obese</td><td>Cachectic</td></tr>
    <tr><td>Sputum</td><td>Copious, purulent</td><td>Scanty, mucoid</td></tr>
    <tr><td>Cyanosis</td><td>Present</td><td>Absent</td></tr>
    <tr><td>Dyspnea</td><td>Mild-moderate</td><td>Severe, progressive</td></tr>
    <tr><td>PaCO₂</td><td>Elevated (chronic CO₂ retainer)</td><td>Normal or low</td></tr>
    <tr><td>Chest X-ray</td><td>Increased markings</td><td>Hyperinflation, flattened diaphragm</td></tr>
  </tbody>
</table>

<div class="callout">
  Modern teaching: The "blue bloater" vs "pink puffer" dichotomy is an oversimplification. Most COPD patients have features of both, and the classification has limited clinical utility. Use the GOLD ABCD assessment tool instead.
</div>

<h2>Diagnosis</h2>
<h3>Spirometry (Gold Standard)</h3>
<p>Post-bronchodilator <strong>FEV1/FVC &lt; 0.70</strong> confirms persistent airflow limitation. The GOLD severity staging is based on FEV1 % predicted:</p>

<table>
  <thead>
    <tr><th>GOLD Stage</th><th>Severity</th><th>FEV1 (% predicted)</th></tr>
  </thead>
  <tbody>
    <tr><td>GOLD 1</td><td>Mild</td><td>≥ 80%</td></tr>
    <tr><td>GOLD 2</td><td>Moderate</td><td>50–79%</td></tr>
    <tr><td>GOLD 3</td><td>Severe</td><td>30–49%</td></tr>
    <tr><td>GOLD 4</td><td>Very Severe</td><td>&lt; 30%</td></tr>
  </tbody>
</table>

<h3>GOLD ABCD Assessment (2023 update)</h3>
<p>Stratifies by symptoms (mMRC ≥ 2 or CAT ≥ 10) and exacerbation history:</p>
<ul>
  <li><strong>Group A:</strong> Low symptoms, 0–1 exacerbations (no hospitalization)</li>
  <li><strong>Group B:</strong> High symptoms, 0–1 exacerbations (no hospitalization)</li>
  <li><strong>Group C:</strong> Low symptoms, ≥ 2 exacerbations OR ≥ 1 hospitalization</li>
  <li><strong>Group D:</strong> High symptoms, ≥ 2 exacerbations OR ≥ 1 hospitalization</li>
</ul>

<h2>Management</h2>
<h3>Non-pharmacologic</h3>
<ul>
  <li><strong>Smoking cessation</strong> — the ONLY intervention that slows disease progression</li>
  <li><strong>Vaccinations</strong> — influenza annually, pneumococcal, COVID-19, RSV (if eligible)</li>
  <li><strong>Pulmonary rehabilitation</strong> — improves exercise capacity and quality of life</li>
  <li><strong>Long-term oxygen therapy (LTOT)</strong> — if PaO₂ ≤ 55 mm Hg or SpO₂ ≤ 88%; <strong>improves survival</strong></li>
  <li><strong>Nutritional support</strong> — for cachexia</li>
</ul>

<h3>Pharmacologic by GOLD Group</h3>
<ul>
  <li><strong>Group A:</strong> Short-acting bronchodilator PRN (SABA or SAMA)</li>
  <li><strong>Group B:</strong> LABA + LAMA (dual long-acting bronchodilation)</li>
  <li><strong>Group C:</strong> LABA + LAMA (consider ICS if eos ≥ 300)</li>
  <li><strong>Group D:</strong> LABA + LAMA + ICS (if eos ≥ 300) OR LABA + LAMA (if eos &lt; 100)</li>
</ul>

<div class="warning">
  <strong>ICS caution:</strong> Inhaled corticosteroids increase pneumonia risk in COPD. Use only when eosinophil count ≥ 300 or history of frequent exacerbations despite dual bronchodilation. Do NOT use ICS alone in COPD (unlike asthma).
</div>

<h2>Acute Exacerbation (AECOPD)</h2>
<p>Defined as increased dyspnea, sputum volume, or sputum purulence (Anthonisen criteria). Triggers include viral URIs (most common), bacterial infection, environmental exposures, and PE.</p>

<h3>Treatment</h3>
<ul>
  <li><strong>Oxygen:</strong> Target SpO₂ 88–92% (avoid hyperoxia — can worsen hypercapnia in CO₂ retainers by Haldane effect and V/Q mismatch)</li>
  <li><strong>Bronchodilators:</strong> SABA (albuterol) + SAMA (ipratropium) via nebulizer or MDI</li>
  <li><strong>Corticosteroids:</strong> Prednisone 40 mg PO × 5 days (short courses as effective as 14 days)</li>
  <li><strong>Antibiotics:</strong> If increased sputum purulence (amoxicillin-clavulanate, doxycycline, or azithromycin)</li>
  <li><strong>Non-invasive ventilation (NIV):</strong> First-line for respiratory acidosis (pH &lt; 7.35, PaCO₂ &gt; 45) — reduces intubation rates and mortality</li>
</ul>

<h2>Prognosis</h2>
<p>COPD is the <strong>third leading cause of death</strong> worldwide. Five-year mortality after first hospitalization for exacerbation is ~50%. The two interventions that reduce mortality are <strong>smoking cessation</strong> and <strong>LTOT for severe hypoxemia</strong>.</p>
`,
  },
  "art-asthma": {
    id: "art-asthma",
    title: "Asthma — Diagnosis & Management",
    specialty: "Pulmonology",
    system: "Obstructive Disease",
    readTimeMin: 7,
    tags: ["obstructive", "eosinophilic"],
    html: `
<h1>Asthma</h1>
<p><strong>Asthma</strong> is a chronic inflammatory airway disease characterized by reversible airflow obstruction, bronchial hyperresponsiveness, and airway remodeling. It affects ~300 million people worldwide and is the most common chronic disease of childhood.</p>

<h2>Pathophysiology</h2>
<p>Asthma is primarily a <strong>Type 2 (Th2-mediated) inflammatory disease</strong> in ~50% of cases ("type-2 high" or eosinophilic asthma). Key mediators:</p>
<ul>
  <li>IL-4 → IgE class switching</li>
  <li>IL-5 → eosinophil maturation and survival</li>
  <li>IL-13 → mucus hypersecretion, airway hyperresponsiveness</li>
</ul>
<p>Exposure to allergens in sensitized individuals triggers mast cell degranulation (IgE-mediated), causing acute bronchoconstriction. Chronic inflammation leads to airway remodeling (subepithelial fibrosis, smooth muscle hypertrophy, goblet cell hyperplasia) — these changes are <strong>only partially reversible</strong>.</p>

<h2>Triggers</h2>
<ul>
  <li>Allergens: dust mites, pet dander, cockroach, pollen, mold</li>
  <li>Respiratory infections (especially rhinovirus in children)</li>
  <li>Exercise (especially in cold, dry air)</li>
  <li>Cold air, irritants (tobacco smoke, perfumes, occupational chemicals)</li>
  <li>Aspirin / NSAIDs (in aspirin-exacerbated respiratory disease, AERD)</li>
  <li>GERD</li>
  <li>Stress, anxiety</li>
</ul>

<h2>Clinical Presentation</h2>
<p>Classic triad: <strong>wheezing, dyspnea, cough</strong> (worse at night/early morning). Symptoms are <strong>variable and reversible</strong> — they may resolve spontaneously or with bronchodilator treatment. Asymmetric findings or focal wheeze suggests alternative diagnosis (foreign body, mass).</p>

<h2>Diagnosis</h2>
<h3>Spirometry</h3>
<p>Diagnosis requires <strong>reversible airflow obstruction</strong>:</p>
<ul>
  <li>FEV1/FVC &lt; 0.75 (LLN)</li>
  <li><strong>FEV1 improves ≥ 12% AND ≥ 200 mL</strong> after SABA (albuterol 400 mcg)</li>
</ul>

<h3>Peak Expiratory Flow (PEF) Variability</h3>
<p>Mean daily diurnal PEF variability &gt; 10% over 2 weeks supports diagnosis.</p>

<h3>Bronchoprovocation</h3>
<p>If spirometry is normal but suspicion remains: methacholine challenge (FEV1 drops ≥ 20% at low concentration indicates hyperresponsiveness). High negative predictive value — useful to <em>rule out</em> asthma.</p>

<h3>Other Tests</h3>
<ul>
  <li><strong>Fractional exhaled nitric oxide (FeNO):</strong> &gt; 50 ppb indicates eosinophilic inflammation</li>
  <li><strong>Sputum eosinophils:</strong> ≥ 2%</li>
  <li><strong>Blood eosinophils:</strong> ≥ 300/μL (predicts ICS responsiveness)</li>
  <li><strong>Skin prick / specific IgE:</strong> Identifies sensitization</li>
</ul>

<h2>Stepwise Management (GINA 2023)</h2>
<p>For patients aged ≥ 12 years, GINA recommends <strong>anti-inflammatory reliever (AIR) therapy</strong> as preferred:</p>

<h3>Track 1 (Preferred): AIR</h3>
<ul>
  <li><strong>Steps 1–2:</strong> Low-dose ICS-formoterol PRN (Smart or AIR)</li>
  <li><strong>Step 3:</strong> Low-dose ICS-formoterol maintenance + PRN</li>
  <li><strong>Step 4:</strong> Medium-dose ICS-formoterol maintenance + PRN</li>
  <li><strong>Step 5:</strong> High-dose ICS-formoterol + add-on (tiotropium, biologic) + PRN</li>
</ul>

<h3>Track 2 (Alternative): SABA + Maintenance ICS</h3>
<p>For patients who cannot use ICS-formoterol as reliever. Maintenance ICS-LABA + SABA PRN.</p>

<div class="warning">
  <strong>GINA no longer recommends SABA-only treatment</strong> for mild asthma. SABA-only increases risk of severe exacerbations and asthma-related death. All patients should receive ICS-containing therapy.
</div>

<h3>Biologics (Step 5)</h3>
<ul>
  <li><strong>Omalizumab</strong> (anti-IgE): Allergic asthma, IgE 30–700</li>
  <li><strong>Mepolizumab, reslizumab</strong> (anti-IL-5): Eosinophilic asthma (eos ≥ 150)</li>
  <li><strong>Benralizumab</strong> (anti-IL-5 receptor α): Eosinophilic asthma</li>
  <li><strong>Dupilumab</strong> (anti-IL-4Rα): Eosinophilic or oral-steroid dependent</li>
  <li><strong>Tezepelumab</strong> (anti-TSLP): Severe asthma regardless of phenotype</li>
</ul>

<h2>Acute Severe Asthma (Status Asthmaticus)</h2>
<h3>Assessment</h3>
<ul>
  <li><strong>Severity:</strong> Severe if PEF ≤ 50%, can't complete sentences, RR ≥ 25, HR ≥ 110; Life-threatening if SpO₂ &lt; 92%, silent chest, cyanosis, exhaustion, arrhythmia</li>
  <li><strong>ABG:</strong> Initial hypoxemia + hypocapnia (respiratory alkalosis). <strong>Normal or rising PaCO₂ is an ominous sign</strong> of impending respiratory failure.</li>
</ul>

<h3>Management</h3>
<ul>
  <li><strong>Oxygen:</strong> Target SpO₂ 93–95%</li>
  <li><strong>SABA:</strong> Albuterol nebulized 5 mg every 20 min × 3, then hourly (or continuous in severe cases)</li>
  <li><strong>Ipratropium:</strong> 0.5 mg nebulized every 20 min × 3 (especially in severe exacerbations)</li>
  <li><strong>Corticosteroids:</strong> Prednisone 40–50 mg PO or methylprednisolone 60–80 mg IV (equivalent efficacy)</li>
  <li><strong>Magnesium sulfate:</strong> 2 g IV over 20 min for severe exacerbations not responding to above</li>
  <li><strong>BiPAP / Intubation:</strong> If impending respiratory failure; use ketamine for induction (bronchodilator properties)</li>
</ul>
`,
  },
  "art-pe": {
    id: "art-pe",
    title: "Pulmonary Embolism",
    specialty: "Pulmonology",
    system: "Vascular Disease",
    readTimeMin: 8,
    tags: ["vascular", "emergency"],
    html: `
<h1>Pulmonary Embolism (PE)</h1>
<p><strong>Pulmonary embolism</strong> is a potentially life-threatening condition caused by obstruction of the pulmonary arterial tree, most commonly by thrombus embolized from deep veins of the lower extremities (DVT). PE and DVT are collectively called <strong>venous thromboembolism (VTE)</strong>.</p>

<h2>Risk Factors — Virchow's Triad</h2>
<ol>
  <li><strong>Endothelial injury:</strong> Trauma, surgery, prior DVT, IV catheters</li>
  <li><strong>Hypercoagulability:</strong>
    <ul>
      <li>Acquired: Malignancy, pregnancy, OCPs/HRT, antiphospholipid syndrome, nephrotic syndrome, HIT</li>
      <li>Inherited: Factor V Leiden, prothrombin gene mutation, protein C/S deficiency, antithrombin deficiency</li>
    </ul>
  </li>
  <li><strong>Stasis:</strong> Immobility (post-op, paralysis, prolonged travel), heart failure, obesity</li>
</ol>

<div class="callout">
  <strong>Unprovoked VTE</strong> (no identifiable risk factor) should prompt evaluation for occult malignancy in patients &gt; 40 years, especially if recurrent.
</div>

<h2>Clinical Presentation</h2>
<p>Symptoms depend on the size and location of the embolus:</p>
<ul>
  <li><strong>Small/segmental PE:</strong> Pleuritic chest pain, dyspnea, mild hypoxia, hemoptysis</li>
  <li><strong>Large/lobar PE:</strong> Significant dyspnea, hypoxia, tachycardia</li>
  <li><strong>Massive PE (saddle):</strong> Sudden-onset severe dyspnea, syncope, hypotension, cardiac arrest</li>
</ul>

<p>Classic but uncommon triad: <strong>dyspnea + pleuritic chest pain + hemoptysis</strong> (&lt; 20% of patients).</p>

<h3>Physical Exam</h3>
<ul>
  <li>Tachypnea, tachycardia (most common)</li>
  <li>Hypoxia (most common, but may be absent in small PE)</li>
  <li>Signs of right heart strain: elevated JVP, right ventricular heave, loud P2, S3/S4 gallop</li>
  <li>Signs of DVT: calf swelling, tenderness, positive Homan's sign (low sensitivity)</li>
  <li>Pleural friction rub (with pulmonary infarction)</li>
</ul>

<h2>Diagnostic Approach</h2>

<h3>1. Pre-test Probability (Wells Score)</h3>
<table>
  <thead><tr><th>Wells Score</th><th>Probability</th></tr></thead>
  <tbody>
    <tr><td>&lt; 2</td><td>Low (PE unlikely)</td></tr>
    <tr><td>2–6</td><td>Moderate</td></tr>
    <tr><td>&gt; 6</td><td>High (PE likely)</td></tr>
  </tbody>
</table>

<h3>2. D-dimer</h3>
<p>High sensitivity, low specificity. <strong>Useful to RULE OUT in low-probability patients</strong>. If D-dimer is negative in a low-probability patient, no further workup needed. If positive, proceed to imaging. D-dimer is falsely elevated in pregnancy, malignancy, infection, post-surgery, and elderly (use age-adjusted cutoff: age × 10 if &gt; 50).</p>

<h3>3. CT Pulmonary Angiography (CTPA)</h3>
<p>Gold standard for diagnosis. Sensitivity ~95%, specificity ~95%. Shows filling defects in pulmonary arteries. Also evaluates right ventricular size (RV/LV ratio &gt; 1 suggests strain).</p>

<h3>4. V/Q Scan</h3>
<p>Alternative if CTPA is contraindicated (renal failure, contrast allergy, pregnancy). Result reported as low/intermediate/high probability — must be interpreted with pre-test probability.</p>

<h3>5. ECG</h3>
<p>Most commonly shows sinus tachycardia. Classic but rare <strong>S1Q3T3 pattern</strong> (S wave in lead I, Q wave in lead III, T wave inversion in lead III) — indicates right heart strain. New right axis deviation, right bundle branch block, or T-wave inversions in V1–V4 also suggest strain.</p>

<h3>6. Chest X-ray</h3>
<p>Usually normal or nonspecific. Classic signs (rare):</p>
<ul>
  <li><strong>Westermark sign:</strong> Focal oligemia (decreased vascular markings) distal to embolus</li>
  <li><strong>Hampton's hump:</strong> Wedge-shaped pleural-based opacity indicating pulmonary infarction</li>
</ul>

<h3>7. Echocardiography</h3>
<p>Bedside test useful in hemodynamically unstable patients. May show RV dilation, RV hypokinesis with preserved apical motion (<strong>McConnell's sign</strong>), tricuspid regurgitation, elevated pulmonary artery pressure. <em>Negative echo does not exclude PE.</em></p>

<h2>Risk Stratification</h2>
<h3>Hemodynamic Stability</h3>
<ul>
  <li><strong>Massive (high-risk) PE:</strong> Hypotension (SBP &lt; 90 for ≥ 15 min) or shock — requires immediate reperfusion</li>
  <li><strong>Submassive (intermediate-risk) PE:</strong> Normotensive with RV strain (echo or biomarkers)</li>
  <li><strong>Low-risk PE:</strong> Normotensive without RV strain</li>
</ul>

<h3>sPESI Score</h3>
<p>Pulmonary Embolism Severity Index. Identifies low-risk patients suitable for outpatient treatment. Factors: age, cancer, chronic cardiopulmonary disease, HR ≥ 110, SBP &lt; 100, SpO₂ &lt; 90%.</p>

<h2>Management</h2>

<h3>Anticoagulation</h3>
<p>Start immediately if PE confirmed or suspicion is high (do not delay for imaging if high probability). Options:</p>
<ul>
  <li><strong>DOACs</strong> (preferred): Apixaban or rivaroxaban (no initial parenteral therapy required); dabigatran or edoxaban (require 5–10 days of parenteral first)</li>
  <li><strong>LMWH</strong> (enoxaparin): Preferred in pregnancy, cancer (with warfarin transition), severe renal impairment</li>
  <li><strong>Warfarin:</strong> Requires overlap with parenteral anticoagulant for 5 days AND until INR ≥ 2 for 24 hours</li>
  <li><strong>Unfractionated heparin:</strong> Preferred in renal failure (CrCl &lt; 30), high bleeding risk, or massive PE (rapidly reversible with protamine)</li>
</ul>

<p>Duration: 3 months for provoked (transient risk factor); indefinite for unprovoked, cancer-associated, or recurrent VTE.</p>

<h3>Massive PE (Hemodynamically Unstable)</h3>
<ul>
  <li><strong>Systemic thrombolysis:</strong> Alteplase 100 mg IV over 2 hours. Indicated if hypotension, shock, or cardiac arrest. Reduces mortality but increases major bleeding (intracranial hemorrhage ~3%).</li>
  <li><strong>Catheter-directed thrombolysis:</strong> Lower-dose tPA delivered directly to clot; lower bleeding risk</li>
  <li><strong>Surgical embolectomy:</strong> If thrombolysis contraindicated or failed</li>
  <li><strong>VA ECMO:</strong> Rescue therapy for refractory cardiogenic shock</li>
</ul>

<h3>Inferior Vena Cava (IVC) Filter</h3>
<p>Indicated if: <strong>contraindication to anticoagulation</strong>, recurrent PE despite adequate anticoagulation, or massive PE with high recurrence risk. Should be <strong>retrievable</strong> — remove once anticoagulation can resume.</p>

<h2>Prognosis</h2>
<p>Three-month mortality: ~10% overall; ~30–60% for massive PE. Long-term risk of <strong>chronic thromboembolic pulmonary hypertension (CTEPH)</strong> — ~0.5–4% of PE survivors; presents with persistent dyspnea months to years later; treated with pulmonary endarterectomy.</p>
`,
  },
  "art-stroke": {
    id: "art-stroke",
    title: "Acute Ischemic Stroke",
    specialty: "Neurology",
    system: "Cerebrovascular",
    readTimeMin: 9,
    tags: ["emergency", "cerebrovascular"],
    html: `
<h1>Acute Ischemic Stroke</h1>
<p><strong>Acute ischemic stroke</strong> accounts for ~87% of all strokes. It results from sudden interruption of cerebral blood flow, most commonly due to thrombotic or embolic occlusion of a cerebral artery. The cornerstone of treatment is rapid reperfusion — every minute of delay equals ~1.9 million neurons lost.</p>

<h2>Etiology — TOAST Classification</h2>
<ol>
  <li><strong>Large-artery atherosclerosis</strong> (~20%): Carotid bifurcation or intracranial large vessel stenosis; atheroembolic</li>
  <li><strong>Cardioembolism</strong> (~20%): Atrial fibrillation (most common), prosthetic valve, recent MI, endocarditis, dilated cardiomyopathy</li>
  <li><strong>Small-vessel occlusion (lacunar)</strong> (~25%): Chronic hypertension / diabetes; lipohyalinosis of penetrating arteries</li>
  <li><strong>Other determined cause</strong> (~5%): Dissection, vasculitis, hypercoagulable states, Moyamoya, drug use (cocaine, amphetamines)</li>
  <li><strong>Undetermined (cryptogenic)</strong> (~30%): No identified cause despite workup</li>
</ol>

<h2>Risk Factors</h2>
<p>Modifiable (most impact): hypertension (most important), atrial fibrillation, diabetes, dyslipidemia, smoking, carotid stenosis, obstructive sleep apnea, sedentary lifestyle, obesity, excessive alcohol.</p>
<p>Non-modifiable: age, male sex (until 75, then female), Black/Hispanic ethnicity, family history, prior stroke/TIA.</p>

<h2>Clinical Presentation</h2>
<p>Symptoms depend on the affected vascular territory:</p>

<h3>Anterior Cerebral Artery (ACA)</h3>
<ul>
  <li>Contralateral leg weakness (greater than arm)</li>
  <li>Urinary incontinence</li>
  <li>Abulia, akinetic mutism (bilateral ACA)</li>
</ul>

<h3>Middle Cerebral Artery (MCA)</h3>
<p>Most common stroke territory. Contralateral:</p>
<ul>
  <li>Hemiparesis (face & arm &gt; leg)</li>
  <li>Hemisensory loss</li>
  <li>Homonymous hemianopia</li>
  <li><strong>Dominant (left) MCA:</strong> Aphasia (Broca's = expressive, Wernicke's = receptive)</li>
  <li><strong>Non-dominant (right) MCA:</strong> Hemineglect, anosognosia, spatial disorientation</li>
</ul>

<h3>Posterior Cerebral Artery (PCA)</h3>
<ul>
  <li>Contralateral homonymous hemianopia (with macular sparing)</li>
  <li>Visual field defects</li>
  <li>Alexia without agraphia (dominant occipital + splenium)</li>
</ul>

<h3>Vertebrobasilar (Brainstem)</h3>
<ul>
  <li>Cranial nerve palsies</li>
  <li>Crossed motor/sensory deficits (ipsilateral face, contralateral body)</li>
  <li>Ataxia, vertigo, diplopia, dysarthria</li>
  <li>Locked-in syndrome (basilar occlusion)</li>
</ul>

<h2>Diagnosis</h2>
<h3>1. Non-contrast Head CT</h3>
<p><strong>First test in every suspected stroke.</strong> Primary goal: <strong>exclude hemorrhage</strong> (cannot give tPA if bleed present). Early ischemic signs (within 6 hours):</p>
<ul>
  <li>Hyperdense MCA sign (early thrombus)</li>
  <li>Loss of gray-white differentiation (insular ribbon)</li>
  <li>Sulcal effacement</li>
  <li>Lentiform nucleus hypodensity</li>
</ul>

<h3>2. CT Angiography (CTA)</h3>
<p>Identifies large vessel occlusion (LVO) — critical for determining eligibility for mechanical thrombectomy. M1/M2 MCA, intracranial ICA, or basilar occlusions are amenable to intervention.</p>

<h3>3. MRI</h3>
<p>More sensitive for acute ischemia, especially posterior fossa strokes (CT is poor for brainstem/cerebellum). Diffusion-weighted imaging (DWI) shows restricted diffusion within minutes of stroke onset. <strong>MR perfusion</strong> can identify salvageable penumbra.</p>

<h2>Acute Management</h2>

<h3>Initial Assessment (First Minutes)</h3>
<ul>
  <li>ABCs, SpO₂ ≥ 94%, BP control</li>
  <li><strong>NIH Stroke Scale (NIHSS)</strong> — quantifies stroke severity (0 = no deficit, 42 = deepest coma)</li>
  <li>Establish <strong>last known well (LKW) time</strong> — critical for treatment window</li>
  <li>Bedside glucose (hypoglycemia mimics stroke)</li>
  <li>Immediate non-contrast CT to rule out hemorrhage</li>
</ul>

<h3>Blood Pressure Management</h3>
<p>Permissive hypertension maintains cerebral perfusion to penumbra:</p>
<ul>
  <li><strong>Pre-tPA:</strong> Lower BP to &lt; 185/110</li>
  <li><strong>Post-tPA (24 hours):</strong> Keep BP &lt; 180/105</li>
  <li><strong>Without tPA:</strong> Permissive HTN up to 220/120; treat only if &gt; 220/120 or symptomatic (e.g., aortic dissection, hypertensive encephalopathy, acute MI)</li>
</ul>
<p>Preferred agents: labetalol IV, nicardipine IV, clevidipine IV (titratable). Avoid oral meds and diuretics initially.</p>

<h3>Intravenous Thrombolysis (tPA)</h3>
<p><strong>Alteplase (rt-PA)</strong> 0.9 mg/kg (max 90 mg; 10% bolus over 1 min, remainder over 60 min):</p>
<ul>
  <li><strong>Standard window:</strong> Within 3 hours of symptom onset (FDA-approved)</li>
  <li><strong>Extended window:</strong> Within 4.5 hours (selected patients; excluded: age &gt; 80, severe stroke NIHSS &gt; 25, prior stroke + diabetes, on anticoagulant regardless of INR)</li>
</ul>

<h4>Major Contraindications</h4>
<ul>
  <li>Intracranial hemorrhage on CT</li>
  <li>Active internal bleeding</li>
  <li>Recent intracranial/intraspinal surgery or serious head trauma (&lt; 3 months)</li>
  <li>INR &gt; 1.7, platelets &lt; 100k</li>
  <li>Sustained BP &gt; 185/110 despite treatment</li>
  <li>Glucose &lt; 50 mg/dL (correct first)</li>
  <li>Recent major surgery (&lt; 14 days)</li>
  <li>GI malignancy or GI bleed (&lt; 21 days)</li>
</ul>

<div class="warning">
  <strong>Tenecteplase (TNK)</strong> (0.25 mg/kg single IV bolus) is now preferred over alteplase at many centers based on EXTEND-IA TNK — non-inferior efficacy, easier administration, lower cost.
</div>

<h3>Mechanical Thrombectomy</h3>
<p>For <strong>large vessel occlusion (LVO)</strong> in anterior circulation:</p>
<ul>
  <li><strong>Standard window:</strong> Within 6 hours of symptom onset (DAWN, DEFUSE 3)</li>
  <li><strong>Extended window (6–24 hours):</strong> If CT perfusion or MRI shows favorable core-to-penumbra ratio</li>
</ul>
<p>Eligible vessels: intracranial ICA, M1, M2 MCA, basilar artery. Significantly improves functional outcomes vs tPA alone.</p>

<h3>Antiplatelet Therapy</h3>
<ul>
  <li><strong>Aspirin 160–300 mg</strong> within 24–48 hours (after tPA: wait 24 hours)</li>
  <li><strong>Dual antiplatelet therapy (DAPT):</strong> Aspirin + clopidogrel for 21 days for <strong>minor stroke (NIHSS ≤ 3) or high-risk TIA</strong> (POINT, CHANCE trials)</li>
  <li><strong>Cilostazol</strong>: Add for Asian patients with intracranial atherosclerosis</li>
</ul>

<h3>Secondary Prevention</h3>
<ul>
  <li><strong>AF:</strong> DOAC or warfarin (start 2–14 days after stroke depending on size)</li>
  <li><strong>Carotid stenosis ≥ 50% (symptomatic):</strong> CEA within 2 weeks (better than stenting in patients &lt; 70)</li>
  <li><strong>Statins:</strong> High-intensity (atorvastatin 80 mg) — SPARCL trial</li>
  <li><strong>HTN control:</strong> Target &lt; 130/80</li>
  <li><strong>Diabetes:</strong> HbA1c &lt; 7%</li>
  <li><strong>Lifestyle:</strong> Smoking cessation, exercise, Mediterranean diet</li>
</ul>

<h2>Complications</h2>
<h3>Hemorrhagic Conversion</h3>
<p>Especially after tPA or in large infarcts. Symptomatic hemorrhage occurs in ~6% of tPA recipients. Stop tPA, give cryoprecipitate, consider neurosurgical evacuation if large.</p>

<h3>Cerebral Edema</h3>
<p>Peaks 3–5 days post-stroke. Malignant MCA infarction (especially dominant hemisphere) can cause fatal herniation. Treat with:</p>
<ul>
  <li>Head of bed 30°, normoglycemia, normothermia</li>
  <li>Osmotherapy: Mannitol 0.5–1 g/kg IV, or hypertonic saline 3% bolus</li>
  <li><strong>Decompressive hemicraniectomy</strong> (within 48 hours for age &lt; 60 with malignant MCA infarct — improves survival but may leave severe disability)</li>
</ul>

<h2>Prognosis</h2>
<p>Stroke is the <strong>5th leading cause of death</strong> in the US and leading cause of long-term disability. Outcomes depend on stroke severity (NIHSS), location, time to treatment, and patient age. Approximately:</p>
<ul>
  <li>30-day mortality: ~15% for ischemic stroke</li>
  <li>Functional independence at 90 days: ~50% with tPA + thrombectomy for LVO; ~30% with tPA alone</li>
  <li>5-year recurrence risk: ~25% (reduced with optimal secondary prevention)</li>
</ul>
`,
  },
  "art-sah": {
    id: "art-sah",
    title: "Subarachnoid Hemorrhage",
    specialty: "Neurology",
    system: "Cerebrovascular",
    readTimeMin: 7,
    tags: ["emergency", "vascular"],
    html: `
<h1>Subarachnoid Hemorrhage (SAH)</h1>
<p><strong>Subarachnoid hemorrhage</strong> is bleeding into the subarachnoid space — between the arachnoid and pia mater. The classic presentation is sudden-onset severe headache ("thunderclap"). Most nontraumatic SAH is caused by rupture of a <strong>saccular (berry) aneurysm</strong>.</p>

<h2>Etiology</h2>
<ul>
  <li><strong>Ruptured saccular (berry) aneurysm</strong> (~85% of nontraumatic SAH)</li>
  <li>Perimesencephalic nonaneurysmal SAH (~10%) — better prognosis</li>
  <li>Arteriovenous malformation (AVM)</li>
  <li>Vasculitis</li>
  <li>Trauma (most common cause of SAH overall)</li>
  <li>Bleeding diathesis / anticoagulation</li>
</ul>

<h3>Risk Factors for Aneurysm</h3>
<ul>
  <li><strong>Hypertension</strong> (modifiable)</li>
  <li><strong>Smoking</strong> (most important modifiable)</li>
  <li>Family history (2 first-degree relatives → 4× risk)</li>
  <li>Autosomal dominant polycystic kidney disease (ADPKD)</li>
  <li>Ehlers-Danlos syndrome (vascular type)</li>
  <li>Marfan syndrome</li>
  <li>Fibromuscular dysplasia</li>
  <li>Age 40–60; female &gt; male</li>
</ul>

<h2>Clinical Presentation</h2>
<p>The hallmark is the <strong>"thunderclap headache"</strong> — sudden-onset, maximal intensity within seconds to minutes, often described as "the worst headache of my life." Patients may say it feels like a "kick to the back of the head."</p>

<h3>Associated symptoms</h3>
<ul>
  <li>Nausea and vomiting</li>
  <li>Photophobia</li>
  <li>Neck stiffness (meningismus, develops hours later)</li>
  <li>Transient loss of consciousness</li>
  <li>Seizures (especially in first 24 hours)</li>
  <li>Focal neurologic deficits (suggests aneurysm location — e.g., CN III palsy with PCoA aneurysm)</li>
</ul>

<h3>Warning ("Sentinel") Headache</h3>
<p>~30–50% of patients have a minor leak ("sentinel bleed") days to weeks before major rupture. Often misdiagnosed as migraine or tension headache. <strong>Any sudden, severe headache warrants imaging</strong>.</p>

<h2>Diagnosis</h2>
<h3>1. Non-contrast Head CT</h3>
<p><strong>Sensitivity:</strong> ~98% within 6 hours; declines to ~50% by 5 days. Blood appears as high-density material in the subarachnoid space (basal cisterns, Sylvian fissure, interhemispheric fissure). Pattern of blood can suggest aneurysm location:</p>
<ul>
  <li><strong>Basal cisterns:</strong> PCoA, ACoA, basilar tip aneurysm</li>
  <li><strong>Sylvian fissure:</strong> MCA aneurysm</li>
  <li><strong>Interhemispheric fissure:</strong> ACA / ACoA aneurysm</li>
  <li><strong>Intraventricular hemorrhage</strong> suggests rupture into ventricle — worse prognosis</li>
</ul>

<h3>2. Lumbar Puncture</h3>
<p>If CT is negative but suspicion remains (especially &gt; 6 hours after symptom onset). <strong>Look for:</strong></p>
<ul>
  <li><strong>Xanthochromia</strong> (yellow-tinged supernatant from hemoglobin breakdown) — present within 2–4 hours, persists for ~2 weeks</li>
  <li>Non-clearing RBCs across sequential tubes (traumatic tap shows decreasing RBCs)</li>
  <li>Elevated opening pressure</li>
</ul>

<h3>3. CT Angiography (CTA)</h3>
<p>Identifies aneurysm location, size, neck morphology, and relationship to parent vessel. <strong>First-line vascular imaging</strong> in acute SAH. Sensitivity ~95% for aneurysms &gt; 3 mm.</p>

<h3>4. Digital Subtraction Angiography (DSA)</h3>
<p>Gold standard. Performed if CTA is negative but clinical suspicion is high, or for treatment planning. ~10–20% of SAH patients have negative initial angiography.</p>

<h2>Management</h2>

<h3>Initial Stabilization</h3>
<ul>
  <li>ABCs; intubate if comatose (Hunt & Hess IV–V)</li>
  <li><strong>BP control:</strong> Lower SBP to &lt; 160 mm Hg before aneurysm is secured (nicardipine, labetalol). Avoid hypotension — may worsen cerebral perfusion.</li>
  <li>Seizure prophylaxis: Levetiracetam for 7 days (controversial)</li>
  <li>Normoglycemia, normothermia, avoid hyponatremia</li>
</ul>

<h3>Definitive Aneurysm Treatment (within 24 hours)</h3>
<h4>Endovascular Coiling (preferred)</h4>
<p>Platinum coils deployed into aneurysm sac to promote thrombosis. <strong>Preferred over surgical clipping</strong> for most posterior circulation aneurysms and patients &gt; 60 years (ISAT trial — better outcomes at 1 year).</p>

<h4>Surgical Clipping</h4>
<p>Craniotomy with placement of titanium clip across aneurysm neck. Preferred for:</p>
<ul>
  <li>Wide-neck aneurysms</li>
  <li>MCA aneurysms</li>
  <li>Large (&gt; 10 mm) aneurysms with mass effect</li>
  <li>Younger patients (more durable than coiling)</li>
</ul>

<h3>Complications (Post-SAH)</h3>

<h4>1. Rebleeding</h4>
<p>Highest risk in first 24 hours (4%). 70% mortality. <strong>Prevented by early aneurysm treatment.</strong> While awaiting treatment, give <strong>antifibrinolytics</strong> (tranexamic acid or aminocaproic acid) for short-term bridge therapy.</p>

<h4>2. Vasospasm and Delayed Cerebral Ischemia (DCI)</h4>
<p>Peak <strong>days 4–14</strong>. Symptomatic vasospasm affects ~30% of patients; can cause ischemic stroke. <strong>Diagnosis:</strong> New neurologic deficit + angiographic vasospasm. <strong>Treatment:</strong></p>
<ul>
  <li><strong>Nimodipine 60 mg PO q4h × 21 days</strong> — reduces poor outcomes by ~33% (mechanism may be neuroprotective, not vasodilatory)</li>
  <li><strong>Induced hypertension</strong> (after aneurysm secured) — norepinephrine to maintain SBP 160–200</li>
  <li>Intra-arterial verapamil or balloon angioplasty for refractory cases</li>
  <li>Maintain euvolemia; avoid hypervolemia (does not improve outcomes, increases complications)</li>
</ul>

<h4>3. Hydrocephalus</h4>
<p>Communicating hydrocephalus from blood obstructing arachnoid granulations. Treat with <strong>external ventricular drain (EVD)</strong>; ~20% require permanent ventriculoperitoneal shunt.</p>

<h4>4. Hyponatremia</h4>
<p><strong>Cerebral salt wasting</strong> (CSW) — natriuresis from elevated BNP/ANP. Differentiate from SIADH (CSW has volume depletion; SIADH has euvolemia/hypervolemia). Treat with hypertonic saline, fludrocortisone; avoid fluid restriction (worsens vasospasm).</p>

<h4>5. Cardiac Complications</h4>
<p>Surge of catecholamines causes <strong>takotsubo cardiomyopathy</strong>, ST changes, troponin elevation, arrhythmias. Usually transient; supportive care.</p>

<h2>Hunt & Hess Grading</h2>
<table>
  <thead><tr><th>Grade</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Asymptomatic, mild headache, slight nuchal rigidity</td></tr>
    <tr><td>2</td><td>Moderate-severe headache, nuchal rigidity, no neurologic deficit other than CN palsy</td></tr>
    <tr><td>3</td><td>Drowsy, minimal neurologic deficit</td></tr>
    <tr><td>4</td><td>Stupor, moderate-severe hemiparesis</td></tr>
    <tr><td>5</td><td>Deep coma, decerebrate posturing</td></tr>
  </tbody>
</table>

<h2>Prognosis</h2>
<p>Overall mortality ~30% (10–15% die before reaching hospital). Among survivors, ~30% have moderate-severe disability. Good prognostic factors: young age, low Hunt & Hess grade, small aneurysm, anterior circulation, no vasospasm. <strong>Nimodipine and early aneurysm treatment</strong> have significantly improved outcomes over the last 2 decades.</p>
`,
  },
  "art-cirrhosis": {
    id: "art-cirrhosis",
    title: "Cirrhosis & Portal Hypertension",
    specialty: "Gastroenterology",
    system: "Hepatobiliary",
    readTimeMin: 9,
    tags: ["liver", "chronic"],
    html: `
<h1>Cirrhosis and Portal Hypertension</h1>
<p><strong>Cirrhosis</strong> is the end-stage of chronic liver disease, characterized histologically by fibrosis and regenerative nodules that distort the hepatic architecture. It is <strong>irreversible</strong> but progression can be slowed by treating the underlying cause.</p>

<h2>Etiology</h2>
<ul>
  <li><strong>Alcohol-related liver disease</strong> (most common in West)</li>
  <li><strong>Non-alcoholic fatty liver disease (NAFLD/NASH)</strong> — increasingly common with obesity epidemic; now leading cause of cirrhosis in younger adults</li>
  <li><strong>Chronic viral hepatitis</strong> — HBV, HCV</li>
  <li><strong>Autoimmune hepatitis</strong></li>
  <li><strong>Primary biliary cholangitis (PBC)</strong></li>
  <li><strong>Primary sclerosing cholangitis (PSC)</strong> (associated with IBD)</li>
  <li><strong>Hemochromatosis</strong> (hereditary iron overload)</li>
  <li><strong>Wilson disease</strong> (copper overload, &lt; 40 years)</li>
  <li><strong>Alpha-1 antitrypsin deficiency</strong></li>
  <li><strong>Vascular:</strong> Budd-Chiari syndrome (hepatic vein thrombosis), chronic right heart failure ("cardiac cirrhosis")</li>
  <li><strong>Drug-induced</strong> — methotrexate, amiodarone, chronic vitamin A</li>
</ul>

<h2>Pathophysiology</h2>
<p>Chronic liver injury activates hepatic stellate cells (Ito cells), which transform from quiescent vitamin A-storing cells into <strong>myofibroblasts</strong>. These produce collagen (type I and III) in the space of Disse, forming fibrous septa. Hepatocyte necrosis triggers regenerative nodules. The combined fibrosis + nodularity distorts hepatic architecture, causing:</p>
<ul>
  <li><strong>Intrahepatic shunting</strong> → decreased functional hepatocyte mass → impaired synthesis (albumin, clotting factors) and detoxification (ammonia, drugs)</li>
  <li><strong>Increased intrahepatic vascular resistance</strong> → portal hypertension</li>
</ul>

<h2>Portal Hypertension</h2>
<p>Defined as <strong>hepatic venous pressure gradient (HVPG) &gt; 5 mm Hg</strong>. Clinically significant portal hypertension at &gt; 10 mm Hg (varices form), bleeding risk at &gt; 12 mm Hg, ascites at &gt; 12 mm Hg.</p>

<h3>Causes by Site</h3>
<ul>
  <li><strong>Pre-hepatic:</strong> Portal vein thrombosis, splenic vein thrombosis</li>
  <li><strong>Intrahepatic (most common):</strong> Cirrhosis, schistosomiasis (worldwide most common)</li>
  <li><strong>Post-hepatic:</strong> Right heart failure, constrictive pericarditis, Budd-Chiari syndrome</li>
</ul>

<h2>Clinical Manifestations</h2>

<h3>Stigmata of Chronic Liver Disease</h3>
<ul>
  <li>Palmar erythema</li>
  <li>Spider angiomata (central arteriole with radiating vessels)</li>
  <li>Jaundice (conjugated hyperbilirubinemia)</li>
  <li>Gynecomastia, testicular atrophy (altered estrogen/testosterone metabolism)</li>
  <li>Caput medusae (recanalized umbilical vein)</li>
  <li>Cruveilhier-Baumgarten murmur (epigastric venous hum)</li>
  <li>Asterixis ("liver flap") — metabolic encephalopathy</li>
  <li>Fetor hepaticus (musty breath from dimethyl sulfide)</li>
  <li>Dupuytren contracture (alcohol-related)</li>
  <li>Clubbing (hypoxemia from portopulmonary hypertension or hepatopulmonary syndrome)</li>
</ul>

<h3>Complications of Portal Hypertension</h3>

<h4>1. Varices</h4>
<p>Portosystemic collaterals form at sites of venous anastomosis:</p>
<ul>
  <li><strong>Esophageal varices</strong> (most clinically significant) — left gastric vein → azygos</li>
  <li><strong>Gastric varices</strong> — short gastric veins</li>
  <li><strong>Rectal varices</strong> — superior rectal (portal) → middle/inferior rectal (systemic)</li>
  <li><strong>Caput medusae</strong> — recanalized umbilical vein</li>
  <li><strong>Retroperitoneal</strong> — clinically silent</li>
</ul>

<p><strong>Variceal bleeding:</strong> 30% 6-week mortality per episode. Treatment:</p>
<ul>
  <li>Acute: ABCs, transfuse to Hgb ~7 (over-transfusion raises portal pressure), <strong>octreotide infusion</strong> (vasoconstricts splanchnic vessels), <strong>band ligation</strong> (preferred endoscopic therapy)</li>
  <li>Antibiotics: <strong>Ceftriaxone x 7 days</strong> — reduces bacterial infections (which occur in 50% of variceal bleeders) and mortality</li>
  <li>TIPS (transjugular intrahepatic portosystemic shunt) if refractory</li>
  <li>Balloon tamponade (Blakemore tube) as bridge only</li>
</ul>

<p><strong>Primary prophylaxis:</strong> Non-selective beta-blocker (propranolol, nadolol) or carvedilol if medium/large varices. <strong>Secondary prophylaxis:</strong> Beta-blocker + endoscopic band ligation.</p>

<h4>2. Ascites</h4>
<p>Sinusoidal portal hypertension + splanchnic vasodilation → decreased effective arterial blood volume → RAAS activation → sodium and water retention. <strong>SAAG (serum-ascites albumin gradient) ≥ 1.1 g/dL</strong> confirms portal hypertension (vs. peritoneal carcinomatosis, TB).</p>

<p>Treatment:</p>
<ul>
  <li>Sodium restriction (&lt; 2 g/day)</li>
  <li>Spironolactone + furosemide (100:40 ratio to maintain normokalemia)</li>
  <li>Fluid restriction only if hyponatremia (Na &lt; 120–125)</li>
  <li>Refractory ascites: <strong>TIPS</strong>, liver transplant evaluation, large-volume paracentesis with albumin (8 g/L removed if &gt; 5 L)</li>
</ul>

<h4>3. Spontaneous Bacterial Peritonitis (SBP)</h4>
<p>Infection of ascitic fluid without obvious source. Diagnostic criteria: <strong>ascitic PMN ≥ 250 cells/mm³</strong>. Typical organisms: <em>E. coli, Klebsiella, S. pneumoniae</em>. <strong>Treatment:</strong> Cefotaxime 2 g IV q8h × 5 days. <strong>Secondary prophylaxis:</strong> Norfloxacin or TMP-SMX daily indefinitely.</p>

<h4>4. Hepatic Encephalopathy (HE)</h4>
<p>Neuropsychiatric syndrome from accumulation of neurotoxins (especially <strong>ammonia</strong>) that bypass hepatic clearance. Triggers: infection, GI bleed, constipation, electrolyte disturbance, sedatives, TIPS, excessive protein intake.</p>

<p><strong>West Haven Classification:</strong></p>
<ul>
  <li>Grade 1: Mild confusion, sleep disturbance, anxiety</li>
  <li>Grade 2: Lethargy, disorientation, asterixis</li>
  <li>Grade 3: Somnolence but arousable, marked confusion</li>
  <li>Grade 4: Coma</li>
</ul>

<p>Treatment:</p>
<ul>
  <li>Identify and treat precipitating factor (most important!)</li>
  <li><strong>Lactulose 30 mL PO q1–2h until 2–3 soft bowel movements/day, then titrate</strong> — converts NH₃ (absorbable) to NH₄⁺ (charged, excreted in stool)</li>
  <li><strong>Rifaximin 550 mg BID</strong> — add for recurrent HE; gut-selective antibiotic reduces ammonia-producing bacteria</li>
  <li>Avoid benzodiazepines (use propofol/haloperidol if sedation needed)</li>
</ul>

<h4>5. Hepatorenal Syndrome (HRS)</h4>
<p>Functional renal failure in cirrhosis — kidneys are histologically normal. Type 1 (rapid, AKI within 2 weeks, creatinine doubling to &gt; 2.5 mg/dL): 80% mortality at 2 weeks. Type 2 (slow, refractory ascites): median survival 6 months.</p>

<p>Treatment:</p>
<ul>
  <li>Octreotide + midodrine + albumin (splanchnic vasoconstriction)</li>
  <li>Terlipressin (vasopressin V1 agonist) + albumin — recently FDA-approved</li>
  <li><strong>Liver transplantation</strong> is definitive therapy</li>
</ul>

<h4>6. Hepatopulmonary Syndrome (HPS)</h4>
<p>Triad: liver disease + arterial deoxygenation + intrapulmonary vascular dilation. Causes <strong>platypnea-orthodeoxia</strong> (dyspnea and hypoxia worse when sitting upright, better when supine — opposite of orthopnea). Diagnosis: contrast echo showing delayed bubbles in left heart. Treatment: O₂; definitive = liver transplant.</p>

<h4>7. Portopulmonary Hypertension</h4>
<p>Pulmonary arterial hypertension in setting of portal hypertension. Mean PAP &gt; 25 mm Hg. Different management from HPS — treat with pulmonary hypertension therapy; transplant contraindicated if mPAP &gt; 45.</p>

<h4>8. Hepatocellular Carcinoma (HCC)</h4>
<p>Annual incidence in cirrhosis: 1–8%. <strong>Surveillance:</strong> Ultrasound ± AFP every 6 months. Treatment: resection, ablation (RFA), TACE, liver transplant (Milan criteria: 1 lesion ≤ 5 cm or 3 lesions ≤ 3 cm each).</p>

<h2>Child-Pugh Score</h2>
<p>Estimates severity and prognosis. Parameters: bilirubin, albumin, INR, ascites, encephalopathy.</p>
<table>
  <thead><tr><th>Score</th><th>Class</th><th>1-year survival</th><th>2-year survival</th></tr></thead>
  <tbody>
    <tr><td>5–6</td><td>A</td><td>100%</td><td>85%</td></tr>
    <tr><td>7–9</td><td>B</td><td>80%</td><td>60%</td></tr>
    <tr><td>10–15</td><td>C</td><td>45%</td><td>35%</td></tr>
  </tbody>
</table>

<h2>MELD-Na Score</h2>
<p>Model for End-stage Liver Disease. Better predicts 90-day mortality. Uses bilirubin, INR, creatinine, sodium. <strong>Prioritizes liver transplant allocation</strong> in US. Score &gt; 15 generally indicates transplant benefit.</p>

<h2>Management</h2>
<ul>
  <li>Treat underlying cause (antivirals for HBV/HCV, alcohol abstinence, weight loss for NASH, phlebotomy for hemochromatosis, chelation for Wilson)</li>
  <li>Avoid hepatotoxic medications and alcohol</li>
  <li>Vaccinations (HAV, HBV, influenza, pneumococcal)</li>
  <li>Screen for HCC and varices</li>
  <li>Nutritional support (1.2–1.5 g/kg protein; sarcopenia is common)</li>
  <li>Evaluate for liver transplant</li>
</ul>

<h2>Prognosis</h2>
<p>Compensated cirrhosis: median survival &gt; 12 years. Decompensated cirrhosis (ascites, variceal bleed, HE, jaundice): median survival ~1.5–2 years without transplant. Liver transplant 5-year survival ~75%.</p>
`,
  },
};

/** Flatten TOC into a list of articles (for search). */
export function listAllArticles(): Article[] {
  return Object.values(ARTICLES);
}

/** Search articles by title / specialty / tags. */
export function searchArticles(query: string): Article[] {
  const q = query.trim().toLowerCase();
  if (!q) return listAllArticles().slice(0, 8);
  return listAllArticles().filter((a) => {
    const hay = (a.title + " " + a.specialty + " " + (a.tags ?? []).join(" ")).toLowerCase();
    return hay.includes(q);
  });
}
